import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn().mockResolvedValue([
    { full_name: 'acme/api', owner: 'acme', name: 'api', is_private: false, is_archived: false },
  ]),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
}));

import { createServerApp } from '@back/node/server-app';
import { loadConfigFile, resolveConfig } from '@back/node/config-store';
import { hashPassword, verifyPassword, constantTimeEqual } from '@back/lib/password';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ghc-server-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Starts a server and captures the setup code it logs. */
function start(dataDir: string, env: Record<string, string> = {}, staticDir?: string) {
  const logs: string[] = [];
  const verifyGithubToken = vi.fn(async (token: string) => {
    if (token === 'bad') throw new Error('invalid or expired token');
    return 'octocat';
  });
  const app = createServerApp({ env, dataDir, staticDir, verifyGithubToken, log: (m) => logs.push(m) });
  const setupCode = logs.join('\n').match(/setup code: (\S+)/)?.[1];
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { app, logs, setupCode, verifyGithubToken, post };
}

const answers = (setupCode: string | undefined, extra: Record<string, unknown> = {}) => ({
  setupCode,
  storage: { driver: 'json' },
  github: { token: 'ghp_good', orgs: ['acme-org'] },
  admin: { username: 'admin', password: 'correct horse' },
  ...extra,
});

describe('node server: first-run setup', () => {
  it('starts in setup mode when nothing is configured', async () => {
    const { app, setupCode, logs } = start(tempDir());

    expect(setupCode).toBeTruthy();
    expect(logs.join('\n')).toMatch(/Setup required \(missing: GITHUB_TOKEN, AUTH_USERNAME, AUTH_PASSWORD\)/);

    const status = await (await app.request('/api/setup/status')).json();
    expect(status).toMatchObject({ configured: false, needs: { storage: true, github: true, admin: true } });
    expect(status.storageOptions.map((o: any) => o.id)).toEqual(['sqlite', 'json', 'csv']);

    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', setupRequired: true });

    const blocked = await app.request('/api/repos');
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ setupRequired: true });
  });

  it('rejects a wrong setup code, invalid answers and an unusable GitHub token', async () => {
    const dataDir = tempDir();
    const { post, setupCode } = start(dataDir);

    expect((await post('/api/setup', answers('nope'))).status).toBe(403);
    expect((await post('/api/setup', answers(setupCode, { admin: { username: 'admin', password: 'short' } }))).status).toBe(400);
    expect((await post('/api/setup', { setupCode })).status).toBe(400);
    expect((await post('/api/setup', answers(setupCode, { github: { token: 'x', orgs: ['bad org!'] } }))).status).toBe(400);

    const rejected = await post('/api/setup', answers(setupCode, { github: { token: 'bad' } }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toMatch(/GitHub rejected the token/);

    expect(loadConfigFile(dataDir)).toEqual({});
  });

  it('completes setup, stores a hashed password and serves the app without a restart', async () => {
    const dataDir = tempDir();
    const { app, post, setupCode } = start(dataDir);

    const done = await post('/api/setup', answers(setupCode));
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, githubLogin: 'octocat' });

    const file = loadConfigFile(dataDir);
    expect(file).toMatchObject({
      STORAGE_DRIVER: 'json', GITHUB_TOKEN: 'ghp_good', GITHUB_ORGS: 'acme-org', AUTH_USERNAME: 'admin',
    });
    expect(file.AUTH_PASSWORD).toBeUndefined();
    expect(file.AUTH_PASSWORD_HASH).toMatch(/^pbkdf2-sha256\$/);
    expect(readFileSync(join(dataDir, 'config.json'), 'utf8')).not.toContain('correct horse');
    expect(file.JWT_SECRET!.length).toBeGreaterThan(30);
    expect(file.API_KEY!.length).toBeGreaterThan(30);
    expect(statSync(join(dataDir, 'config.json')).mode & 0o777).toBe(0o600);

    expect(await (await app.request('/api/setup/status')).json()).toEqual({ configured: true, authRequired: true });
    expect((await post('/api/setup', answers(setupCode))).status).toBe(401); // setup API is gone

    expect((await app.request('/api/repos')).status).toBe(401);
    expect((await post('/api/auth/login', { username: 'admin', password: 'wrong password' })).status).toBe(401);
    expect((await post('/api/auth/login', { username: 'nobody', password: 'correct horse' })).status).toBe(401);

    const login = await post('/api/auth/login', { username: 'admin', password: 'correct horse' });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${(await login.json()).token}` };

    // Real flow against the JSON file store: sync from GitHub, then read back.
    expect((await post('/api/repos/refresh', {}, auth)).status).toBe(200);
    const repos = await (await app.request('/api/repos', { headers: auth })).json();
    expect(repos.map((r: any) => r.full_name)).toEqual(['acme/api']);
    expect(JSON.parse(readFileSync(join(dataDir, 'storage', 'repos.json'), 'utf8'))[0].full_name).toBe('acme/api');

    // The generated API key works for agents and CI.
    expect((await app.request('/api/repos', { headers: { Authorization: `Bearer ${file.API_KEY}` } })).status).toBe(200);
  });

  it('stays configured, with its data, after a restart', async () => {
    const dataDir = tempDir();
    const first = start(dataDir);
    await first.post('/api/setup', answers(first.setupCode, { storage: { driver: 'csv' } }));
    const login = await first.post('/api/auth/login', { username: 'admin', password: 'correct horse' });
    const auth = { Authorization: `Bearer ${(await login.json()).token}` };
    await first.post('/api/repos/refresh', {}, auth);

    const second = start(dataDir);
    expect(second.setupCode).toBeUndefined();
    expect(second.logs).toContain('Storage: csv');
    const repos = await (await second.app.request('/api/repos', { headers: auth })).json(); // same JWT secret
    expect(repos.map((r: any) => r.full_name)).toEqual(['acme/api']);
    expect(readFileSync(join(dataDir, 'storage', 'repos.csv'), 'utf8')).toContain('acme/api');
  });

  it('only asks for what the environment does not provide', async () => {
    const dataDir = tempDir();
    const { app, post, setupCode, verifyGithubToken } = start(dataDir, { GITHUB_TOKEN: 'ghp_env', STORAGE_DRIVER: 'csv' });

    const status = await (await app.request('/api/setup/status')).json();
    expect(status.needs).toEqual({ storage: false, github: false, admin: true });

    const done = await post('/api/setup', { setupCode, admin: { username: 'admin', password: 'correct horse' } });
    expect(done.status).toBe(200);
    expect(verifyGithubToken).not.toHaveBeenCalled();
    expect(loadConfigFile(dataDir).GITHUB_TOKEN).toBeUndefined(); // env-provided secrets are not copied to disk
  });
});

describe('node server: settings', () => {
  async function configured(env: Record<string, string> = {}) {
    const dataDir = tempDir();
    const server = start(dataDir, env);
    await server.post('/api/setup', answers(server.setupCode, env.GITHUB_TOKEN ? { github: undefined } : {}));
    const login = await server.post('/api/auth/login', { username: 'admin', password: 'correct horse' });
    const auth = { Authorization: `Bearer ${(await login.json()).token}` };
    const patch = (body: unknown) => server.app.request('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body),
    });
    const read = async () => (await server.app.request('/api/settings', { headers: auth })).json();
    return { ...server, dataDir, auth, patch, read };
  }

  it('shows the current settings without exposing secrets', async () => {
    const { read, app } = await configured();
    const settings = await read();
    expect(settings).toEqual({
      editable: true, storageDriver: 'json', username: 'admin', githubTokenSet: true,
      githubOrgs: ['acme-org'], syncIntervalHours: 24, publicBadges: false, publicStatus: false, webhookSecretSet: false, locked: [],
      repoBaseline: expect.any(Array),
    });
    // Unset baseline: the defaults are enforced, the rest of the catalog is not.
    expect(settings.repoBaseline).toContainEqual({ key: 'delete_branch_on_merge', label: expect.any(String), expected: true });
    expect(settings.repoBaseline).toContainEqual({ key: 'has_issues', label: expect.any(String), expected: null });
    expect(JSON.stringify(settings)).not.toContain('ghp_good');
    expect((await app.request('/api/settings')).status).toBe(401);
  });

  it('applies changes immediately and keeps them across a restart', async () => {
    const { patch, read, dataDir, verifyGithubToken, app } = await configured();

    const res = await patch({ githubToken: 'ghp_new', githubOrgs: ['one', 'two'], syncIntervalHours: 6, publicBadges: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ githubOrgs: ['one', 'two'], syncIntervalHours: 6, publicBadges: true });
    expect(verifyGithubToken).toHaveBeenCalledWith('ghp_new');
    expect(loadConfigFile(dataDir)).toMatchObject({
      GITHUB_TOKEN: 'ghp_new', GITHUB_ORGS: 'one,two', SYNC_INTERVAL_HOURS: '6', PUBLIC_BADGES: 'true',
    });
    // Live: badges answer now (404 "not found" for an unknown repo, instead of "disabled").
    expect(await (await app.request('/api/badges/acme/none/stars.svg')).json()).toEqual({ error: 'Badge not found' });

    expect((await patch({ githubOrgs: [] })).status).toBe(200);
    expect((await read()).githubOrgs).toEqual([]);

    const restarted = start(dataDir);
    const login = await restarted.post('/api/auth/login', { username: 'admin', password: 'correct horse' });
    const again = await (await restarted.app.request('/api/settings', {
      headers: { Authorization: `Bearer ${(await login.json()).token}` },
    })).json();
    expect(again).toMatchObject({ githubOrgs: [], syncIntervalHours: 6, publicBadges: true });
  });

  it('stores the repo settings baseline, including an empty one', async () => {
    const { patch, read, dataDir } = await configured();
    const expected = async () => Object.fromEntries(
      (await read()).repoBaseline.filter((o: any) => o.expected !== null).map((o: any) => [o.key, o.expected]),
    );

    const res = await patch({ repoBaseline: { has_issues: false, delete_branch_on_merge: true } });
    expect(res.status).toBe(200);
    expect(await expected()).toEqual({ has_issues: false, delete_branch_on_merge: true });
    expect(JSON.parse(loadConfigFile(dataDir).REPO_BASELINE!)).toEqual({ has_issues: false, delete_branch_on_merge: true });

    // Empty means "enforce nothing", which is different from never having chosen (the defaults).
    expect((await patch({ repoBaseline: {} })).status).toBe(200);
    expect(await expected()).toEqual({});

    const unknown = await patch({ repoBaseline: { visibility: true } });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain('visibility');
    expect((await patch({ repoBaseline: { has_wiki: 'yes' } })).status).toBe(400);
  });

  it('changes the password only with the current one', async () => {
    const { patch, post } = await configured();

    const wrong = await patch({ password: { current: 'nope', next: 'a new password' } });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe('The current password is not correct');

    expect((await patch({ password: { current: 'correct horse', next: 'a new password' } })).status).toBe(200);
    expect((await post('/api/auth/login', { username: 'admin', password: 'correct horse' })).status).toBe(401);
    expect((await post('/api/auth/login', { username: 'admin', password: 'a new password' })).status).toBe(200);
  });

  it('rejects invalid values, unknown fields and unusable tokens, changing nothing', async () => {
    const { patch, read, dataDir } = await configured();
    const before = loadConfigFile(dataDir);

    expect((await patch({ syncIntervalHours: -1 })).status).toBe(400);
    expect((await patch({ githubOrgs: ['bad org!'] })).status).toBe(400);
    expect((await patch({ STORAGE_DRIVER: 'csv' })).status).toBe(400);
    expect((await patch({ password: { current: 'correct horse', next: 'short' } })).status).toBe(400);
    const badToken = await patch({ githubToken: 'bad', syncIntervalHours: 1 });
    expect(badToken.status).toBe(400);
    expect((await badToken.json()).error).toMatch(/GitHub rejected the token/);

    expect(loadConfigFile(dataDir)).toEqual(before);
    expect((await read()).syncIntervalHours).toBe(24);
  });

  it('locks what the environment provides', async () => {
    const { patch, read } = await configured({ GITHUB_TOKEN: 'ghp_env', SYNC_INTERVAL_HOURS: '12' });
    expect(await read()).toMatchObject({ syncIntervalHours: 12, locked: ['githubToken', 'syncIntervalHours'] });

    const res = await patch({ syncIntervalHours: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/environment variable.*syncIntervalHours/);
    expect((await patch({ publicBadges: true })).status).toBe(200);
  });
});

describe('node server: sqlite storage', () => {
  it('creates the database on first use and keeps data across restarts', async () => {
    const dataDir = tempDir();
    const first = start(dataDir);
    expect((await first.post('/api/setup', answers(first.setupCode, { storage: { driver: 'sqlite' } }))).status).toBe(200);
    const login = await first.post('/api/auth/login', { username: 'admin', password: 'correct horse' });
    const auth = { Authorization: `Bearer ${(await login.json()).token}` };
    expect((await first.post('/api/repos/refresh', {}, auth)).status).toBe(200);
    expect((await first.post('/api/groups', { name: 'Web' }, auth)).status).toBe(200);
    expect(statSync(join(dataDir, 'github-control.db')).size).toBeGreaterThan(0);

    const second = start(dataDir);
    expect(second.logs).toContain('Storage: sqlite');
    const repos = await (await second.app.request('/api/repos', { headers: auth })).json();
    expect(repos.map((r: any) => r.full_name)).toEqual(['acme/api']);
    const groups = await (await second.app.request('/api/groups', { headers: auth })).json();
    expect(groups.map((g: any) => [g.slug, g.repo_count])).toEqual([['web', 0]]);
  });
});

describe('node server: configuration from the environment', () => {
  const env = { GITHUB_TOKEN: 'ghp_env', AUTH_USERNAME: 'admin', AUTH_PASSWORD: 'env password' };

  it('skips the wizard and generates the secrets it was not given', async () => {
    const dataDir = tempDir();
    const { app, post, setupCode, logs } = start(dataDir, env);

    expect(setupCode).toBeUndefined();
    expect(logs).toContain('Storage: json');
    expect(await (await app.request('/api/setup/status')).json()).toEqual({ configured: true, authRequired: true });
    expect((await post('/api/auth/login', { username: 'admin', password: 'env password' })).status).toBe(200);
    expect(Object.keys(loadConfigFile(dataDir)).sort()).toEqual(['API_KEY', 'JWT_SECRET']);
  });

  it('tells the frontend when sign-in is turned off', async () => {
    const { app } = start(tempDir(), { GITHUB_TOKEN: 'x', DISABLE_AUTH: 'true' });
    expect(await (await app.request('/api/setup/status')).json()).toEqual({ configured: true, authRequired: false });
    expect((await app.request('/api/repos')).status).toBe(200);
  });

  it('lets environment variables override the config file', () => {
    const dataDir = tempDir();
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ GITHUB_TOKEN: 'from-file', AUTH_USERNAME: 'file-user' }));
    const { config, missing } = resolveConfig({ GITHUB_TOKEN: 'from-env', DISABLE_AUTH: 'true' }, loadConfigFile(dataDir), dataDir);
    expect(missing).toEqual([]);
    expect(config).toMatchObject({
      GITHUB_TOKEN: 'from-env', AUTH_USERNAME: 'file-user', STORAGE_DRIVER: 'json',
      STORAGE_PATH: join(dataDir, 'storage'), ENVIRONMENT: 'production',
    });
  });

  it('picks postgres when a database URL is present and requires one when asked for', () => {
    expect(resolveConfig({ ...env, DATABASE_URL: 'postgresql://x' }, {}, '/data').config.STORAGE_DRIVER).toBe('postgres');
    expect(resolveConfig({ ...env, STORAGE_DRIVER: 'postgres' }, {}, '/data').missing).toEqual(['DATABASE_URL']);
  });

  it('serves the built frontend with a fallback for client-side routes', async () => {
    const staticDir = tempDir();
    writeFileSync(join(staticDir, 'index.html'), '<html>app shell</html>');
    writeFileSync(join(staticDir, 'app.js'), 'console.log(1)');
    const { app } = start(tempDir(), env, staticDir);

    expect(await (await app.request('/app.js')).text()).toBe('console.log(1)');
    expect(await (await app.request('/metrics/acme/api')).text()).toContain('app shell');
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('answers API-only when there is no frontend build', async () => {
    const { app } = start(tempDir(), env, join(tempDir(), 'missing'));
    expect((await app.request('/')).status).toBe(404);
  });
});

describe('password hashing', () => {
  it('verifies the right password and nothing else', async () => {
    const hash = await hashPassword('s3cret password');
    expect(hash).not.toContain('s3cret');
    expect(await verifyPassword('s3cret password', hash)).toBe(true);
    expect(await verifyPassword('s3cret passwor', hash)).toBe(false);
    expect(await hashPassword('s3cret password')).not.toBe(hash); // salted
  });

  it('rejects malformed or tampered hashes', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$99999999$AAAA$AAAA')).toBe(false);
    expect(await verifyPassword('x', 'md5$1$AAAA$AAAA')).toBe(false);
  });

  it('compares strings of any length in constant-time fashion', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
