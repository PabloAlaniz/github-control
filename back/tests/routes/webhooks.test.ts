import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));
const issuesList = vi.fn();
const getLatestRelease = vi.fn();
const octokitRequest = vi.fn();
vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({
    issues: { listForRepo: issuesList },
    pulls: { list: vi.fn().mockResolvedValue({ data: [] }) },
    repos: { getLatestRelease, listTags: vi.fn().mockResolvedValue({ data: [] }), get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }) },
    request: octokitRequest,
    graphql: vi.fn().mockResolvedValue(null),
  }),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { planWebhook, verifySignature } from '@back/lib/github/webhook';

const SECRET = 'a-long-webhook-secret-123';
let env: any;
let storage: Storage;

const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const deliver = (event: string, payload: unknown, options: { signature?: string | null; config?: any } = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = options.signature === undefined ? sign(body) : options.signature;
  return app.request('/api/webhooks/github', {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': event, ...(signature && { 'X-Hub-Signature-256': signature }) },
  }, options.config ?? env);
};
const repository = { full_name: 'acme/api', default_branch: 'main' };
const run = (extra: Record<string, unknown> = {}) => ({
  action: 'completed', repository,
  workflow_run: { status: 'completed', conclusion: 'failure', head_branch: 'main', html_url: 'https://github.com/acme/api/actions/runs/9', run_started_at: '2026-01-01T00:00:00Z', ...extra },
});

describe('webhook signature', () => {
  it('accepts only the HMAC of the exact body under the secret', async () => {
    const body = '{"a":1}';
    expect(await verifySignature(SECRET, body, sign(body))).toBe(true);
    expect(await verifySignature(SECRET, '{"a":2}', sign(body))).toBe(false);
    expect(await verifySignature(SECRET, body, sign(body, 'another-secret'))).toBe(false);
    expect(await verifySignature(SECRET, body, sign(body).replace('sha256=', 'sha1='))).toBe(false);
    expect(await verifySignature(SECRET, body, undefined)).toBe(false);
    expect(await verifySignature('', body, sign(body, ''))).toBe(false);
  });
});

describe('webhook signature: GitHub\'s documented example', () => {
  it('matches the value in GitHub\'s documentation for validating deliveries', async () => {
    const signature = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    expect(await verifySignature("It's a Secret to Everybody", 'Hello, World!', signature)).toBe(true);
  });
});

describe('what a delivery means', () => {
  it('takes the CI status of the default branch from a workflow run', () => {
    expect(planWebhook('workflow_run', run())).toEqual({
      repo: 'acme/api', signals: ['ci'],
      ci: { ci_status: 'failure', ci_status_url: 'https://github.com/acme/api/actions/runs/9', ci_status_run_at: '2026-01-01T00:00:00Z' },
    });
    expect(planWebhook('workflow_run', run({ status: 'in_progress', conclusion: null }))).toMatchObject({ ci: { ci_status: 'in_progress' }, signals: [] });
    expect(planWebhook('workflow_run', run({ conclusion: null }))!.ci!.ci_status).toBe('neutral');
    expect(planWebhook('workflow_run', run({ head_branch: 'feature/x' }))).toBeNull();
  });

  it.each([
    ['pull_request', { action: 'opened' }, ['inbox']],
    ['pull_request', { action: 'closed' }, ['inbox', 'branches']],
    ['pull_request_review', { action: 'submitted' }, ['inbox']],
    ['issues', { action: 'opened' }, ['inbox']],
    ['check_suite', { action: 'completed', check_suite: { pull_requests: [{ number: 1 }] } }, ['inbox']],
    ['release', { action: 'published' }, ['release']],
    ['dependabot_alert', { action: 'created' }, ['security']],
    ['code_scanning_alert', { action: 'created' }, ['security']],
    ['secret_scanning_alert', { action: 'created' }, ['security']],
    ['repository', { action: 'edited' }, ['standards', 'config']],
    ['branch_protection_rule', { action: 'created' }, ['standards', 'config']],
  ])('%s %o refreshes %o', (event, payload, signals) => {
    expect(planWebhook(event, { ...payload, repository })).toEqual({ repo: 'acme/api', signals });
  });

  it('ignores what does not change the dashboard', () => {
    expect(planWebhook('star', { action: 'created', repository })).toBeNull();
    expect(planWebhook('check_suite', { action: 'completed', check_suite: { pull_requests: [] }, repository })).toBeNull();
    expect(planWebhook('check_suite', { action: 'requested', check_suite: { pull_requests: [{}] }, repository })).toBeNull();
    expect(planWebhook('pull_request', { action: 'opened' })).toBeNull();
    expect(planWebhook('pull_request', null)).toBeNull();
  });
});

describe('POST /api/webhooks/github', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ({ env, storage } = memoryEnv({ GITHUB_WEBHOOK_SECRET: SECRET }));
    await storage.repos.refreshFromGitHub([repoRecord('acme/api')]);
    issuesList.mockResolvedValue({ data: [{ number: 5, title: 'New bug', html_url: 'u', user: { login: 'bob' }, labels: [], assignees: [], comments: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] });
    octokitRequest.mockResolvedValue({ data: [] });
  });

  it('does not exist until a secret is configured', async () => {
    const off = memoryEnv();
    expect((await deliver('ping', {}, { config: off.env })).status).toBe(404);
  });

  it('refuses a delivery that is unsigned or signed with another secret', async () => {
    expect((await deliver('workflow_run', run(), { signature: null })).status).toBe(401);
    expect((await deliver('workflow_run', run(), { signature: sign(JSON.stringify(run()), 'wrong-secret-wrong-secret') })).status).toBe(401);
    expect((await storage.repos.getRepo('acme/api'))!.ci_status ?? null).toBeNull();
  });

  it('answers the ping GitHub sends when the webhook is created', async () => {
    const res = await deliver('ping', { zen: 'Keep it logically awesome.' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pong: true });
  });

  it('records a failed run at once and opens the alert, without asking for an API key', async () => {
    octokitRequest.mockResolvedValue({ data: { workflow_runs: [] } });
    const res = await deliver('workflow_run', run());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, handled: true, repo: 'acme/api', ci: 'failure' });

    expect(await storage.repos.getRepo('acme/api')).toMatchObject({ ci_status: 'failure', ci_status_url: 'https://github.com/acme/api/actions/runs/9' });
    expect((await storage.alerts.listAlerts({ status: 'open' })).map((alert) => alert.key)).toEqual(['ci_failing:acme/api']);

    // The run that fixes it resolves the alert just as fast.
    await deliver('workflow_run', run({ conclusion: 'success' }));
    expect(await storage.alerts.listAlerts({ status: 'open' })).toEqual([]);
  });

  it('refreshes the inbox when an issue or pull request changes', async () => {
    expect(await (await deliver('issues', { action: 'opened', repository })).json()).toMatchObject({ handled: true, signals: ['inbox'] });
    const [signal] = await storage.signals.getRepoSignals('acme/api');
    expect(signal).toMatchObject({ kind: 'inbox', data: { issues: 1, items: [expect.objectContaining({ number: 5, title: 'New bug' })] } });
  });

  it('reads a signal once for a burst of deliveries about the same repo', async () => {
    await deliver('issues', { action: 'opened', repository });
    await deliver('issues', { action: 'labeled', repository });
    const third = await (await deliver('pull_request', { action: 'opened', repository })).json();
    expect(issuesList).toHaveBeenCalledTimes(1);
    expect(third).toMatchObject({ handled: true, signals: [] });
  });

  it('acknowledges deliveries it does nothing with, so GitHub does not mark the webhook as failing', async () => {
    const other = await deliver('issues', { action: 'opened', repository: { full_name: 'acme/not-tracked', default_branch: 'main' } });
    expect(other.status).toBe(202);
    expect(await other.json()).toMatchObject({ handled: false, reason: 'unknown_repo' });

    const star = await deliver('star', { action: 'created', repository });
    expect(await star.json()).toMatchObject({ handled: false, reason: 'ignored_event' });
    expect(issuesList).not.toHaveBeenCalled();
  });

  it('rejects a signed body that is not JSON', async () => {
    expect((await deliver('issues', 'not json')).status).toBe(400);
  });

  it('tells signed-in clients how to set the webhook up, without the secret', async () => {
    expect((await app.request('/api/webhooks', {}, env)).status).toBe(401);
    const res = await app.request('/api/webhooks', { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
    const body = await res.json() as any;
    expect(body).toMatchObject({ enabled: true, path: '/api/webhooks/github' });
    expect(body.events).toContain('workflow_run');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});
