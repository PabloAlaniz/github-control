import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn().mockResolvedValue([]), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import { createServerApp } from '@back/node/server-app';
import { loadConfigFile } from '@back/node/config-store';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function start(env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ghc-hooks-'));
  dirs.push(dataDir);
  const app = createServerApp({ env: { GITHUB_TOKEN: 'x', DISABLE_AUTH: 'true', STORAGE_DRIVER: 'json', ...env }, dataDir, log: () => undefined });
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ping = (secret: string) => {
    const body = JSON.stringify({ zen: 'hi' });
    return app.request('/api/webhooks/github', {
      method: 'POST', body,
      headers: { 'X-GitHub-Event': 'ping', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
    });
  };
  return { dataDir, send, ping };
}

describe('node server: webhook secret', () => {
  const SECRET = 'generated-in-the-settings-page-0123';

  it('turns webhooks on from the settings, without ever returning the secret', async () => {
    const { send, ping, dataDir } = start();
    expect((await ping(SECRET)).status).toBe(404);
    expect(await (await send('GET', '/api/webhooks')).json()).toMatchObject({ enabled: false });

    const saved = await send('PATCH', '/api/settings', { webhookSecret: SECRET });
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(JSON.parse(text).webhookSecretSet).toBe(true);
    expect(text).not.toContain(SECRET);
    expect(loadConfigFile(dataDir).GITHUB_WEBHOOK_SECRET).toBe(SECRET);

    expect((await ping(SECRET)).status).toBe(200);
    expect((await ping('some-other-secret-0123456')).status).toBe(401);
  });

  it('turns them off again with an empty secret, and refuses a short one', async () => {
    const { send, ping } = start();
    expect((await send('PATCH', '/api/settings', { webhookSecret: 'too-short' })).status).toBe(400);

    await send('PATCH', '/api/settings', { webhookSecret: SECRET });
    expect((await send('PATCH', '/api/settings', { webhookSecret: '' })).status).toBe(200);
    expect((await ping(SECRET)).status).toBe(404);
    expect((await (await send('GET', '/api/settings')).json() as any).webhookSecretSet).toBe(false);
  });

  it('is locked when the environment provides the secret', async () => {
    const { send, ping } = start({ GITHUB_WEBHOOK_SECRET: SECRET });
    expect((await ping(SECRET)).status).toBe(200);
    expect((await (await send('GET', '/api/settings')).json() as any).locked).toContain('webhookSecret');
    expect((await send('PATCH', '/api/settings', { webhookSecret: 'another-long-secret-01234' })).status).toBe(400);
  });
});
