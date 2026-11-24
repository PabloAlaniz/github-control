import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn().mockResolvedValue([]), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import { createServerApp } from '@back/node/server-app';
import { loadConfigFile } from '@back/node/config-store';
import { readPolicyFile } from '@back/node/policy-file';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ghc-policy-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const BASE = { GITHUB_TOKEN: 'ghp_x', DISABLE_AUTH: 'true', STORAGE_DRIVER: 'json' };

function start(env: Record<string, string> = {}) {
  const dataDir = tempDir();
  const logs: string[] = [];
  const app = createServerApp({ env: { ...BASE, ...env }, dataDir, log: (m) => logs.push(m) });
  const send = (method: string, path: string, body?: unknown) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, dataDir, logs, send };
}

describe('node server: policy', () => {
  it('saves a policy from the app and puts it in force at once', async () => {
    const { send, dataDir } = start();
    expect(await (await send('GET', '/api/policy')).json()).toMatchObject({ source: 'default', editable: true });

    const yaml = 'alerts:\n  stale_days: 30\nbaseline:\n  has_wiki: false\n';
    const res = await send('PUT', '/api/policy', { yaml });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.applied).toBe(true);
    expect(body.changes).toContainEqual({ section: 'alerts', key: 'stale_days', from: 90, to: 30 });
    expect(body.policy).toMatchObject({ source: 'saved', editable: true, text: yaml });

    expect(loadConfigFile(dataDir).POLICY).toBe(yaml);
    expect((await (await send('GET', '/api/alerts')).json() as any).rules).toEqual({ staleDays: 30, healthBelow: 40, custom: 0 });

    const activity = await (await send('GET', '/api/activity')).json() as any;
    expect(JSON.stringify(activity)).toContain('policy.update');
  });

  it('refuses a document that is not valid and keeps the one in force', async () => {
    const { send } = start();
    await send('PUT', '/api/policy', { yaml: 'alerts: { stale_days: 30 }' });

    const res = await send('PUT', '/api/policy', { yaml: 'alerts: { stale_days: soon }' });
    expect(res.status).toBe(422);
    expect((await res.json() as any).errors[0]).toMatch(/stale_days/);
    expect((await (await send('GET', '/api/alerts')).json() as any).rules.staleDays).toBe(30);
  });

  it('goes back to the defaults when the document is emptied', async () => {
    const { send } = start();
    await send('PUT', '/api/policy', { yaml: 'alerts: { stale_days: 30 }' });
    expect((await send('PUT', '/api/policy', { yaml: '' })).status).toBe(200);
    expect(await (await send('GET', '/api/policy')).json()).toMatchObject({ source: 'default', text: '' });
  });

  it('takes the baseline out of the settings form once the policy sets it', async () => {
    const { send } = start();
    expect((await (await send('GET', '/api/settings')).json() as any).locked).not.toContain('repoBaseline');

    await send('PUT', '/api/policy', { yaml: 'baseline: { has_wiki: true }' });
    const settings = await (await send('GET', '/api/settings')).json() as any;
    expect(settings.locked).toContain('repoBaseline');
    expect(settings.repoBaseline.find((s: any) => s.key === 'has_wiki').expected).toBe(true);
    expect(settings.repoBaseline.find((s: any) => s.key === 'delete_branch_on_merge').expected).toBeNull();
    expect((await send('PATCH', '/api/settings', { repoBaseline: { has_wiki: false } })).status).toBe(400);
  });

  it('cannot be changed from the app when it comes from the environment', async () => {
    const { send } = start({ POLICY: 'alerts: { stale_days: 7 }' });
    expect(await (await send('GET', '/api/policy')).json()).toMatchObject({ source: 'env', editable: false });
    const res = await send('PUT', '/api/policy', { yaml: 'alerts: { stale_days: 30 }' });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toMatch(/POLICY environment variable/);
  });

  it('reads the policy from a file, which then is the only way to change it', async () => {
    const file = join(tempDir(), 'policy.yml');
    writeFileSync(file, 'alerts:\n  health_below: 55\n');
    const { send, logs } = start({ POLICY_FILE: file });

    expect(logs.join('\n')).toMatch(/Policy loaded from/);
    expect(await (await send('GET', '/api/policy')).json()).toMatchObject({ source: 'file', editable: false });
    expect((await (await send('GET', '/api/alerts')).json() as any).rules.healthBelow).toBe(55);

    const res = await send('PUT', '/api/policy', { yaml: 'alerts: { health_below: 10 }' });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toMatch(/change that file/);
  });

  it('ignores a policy file that is missing or not valid, and says so in the log', () => {
    const logs: string[] = [];
    expect(readPolicyFile(join(tempDir(), 'nope.yml'), (m) => logs.push(m))).toBeNull();
    const broken = join(tempDir(), 'policy.yml');
    writeFileSync(broken, 'baseline: { nope: true }');
    expect(readPolicyFile(broken, (m) => logs.push(m))).toBeNull();
    expect(logs[0]).toMatch(/could not be read/);
    expect(logs[1]).toMatch(/not valid and was ignored: baseline\.nope/);
  });
});
