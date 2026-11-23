import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
  getViewerLogin: vi.fn().mockResolvedValue('alice'),
}));
vi.mock('@back/lib/github/repos', async (original) => ({ ...(await original() as object), getViewerLogin: vi.fn().mockResolvedValue('alice') }));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';

let env: any;
let storage: Storage;
let nextId = 1;

const post = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${mockEnv.API_KEY}` }) =>
  app.request('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }, env);
const rpc = async (method: string, params?: unknown) => (await post({ jsonrpc: '2.0', id: nextId++, method, params })).json() as Promise<any>;
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const { result } = await rpc('tools/call', { name, arguments: args });
  return { isError: result.isError, text: result.content[0].text as string, data: result.isError ? null : JSON.parse(result.content[0].text) };
};

describe('MCP server', () => {
  beforeEach(async () => {
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([
      repoRecord('acme/api', { description: 'Payments API', language: 'Go' }), repoRecord('acme/web', { language: 'TypeScript' }),
    ]);
    await storage.meta.patchRepoMeta('acme/api', { priority: 'high', has_ci: true });
    await storage.meta.patchRepoMeta('acme/web', { has_ci: false });
    await storage.health.updateCiStatus('acme/api', { ci_status: 'failure', ci_status_url: null, ci_status_run_at: null });
    await storage.signals.upsertSignal('acme/api', 'inbox', {
      prs: 1, issues: 1, items: [
        { type: 'pr', number: 7, title: 'Add refunds', url: 'u', author: 'bob', authorIsBot: false, labels: [], assignees: [], requestedReviewers: ['alice'], draft: false, comments: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', headRef: 'r', headSha: 'abc' },
        { type: 'issue', number: 3, title: 'Timeouts', url: 'u', author: 'carol', authorIsBot: false, labels: [], assignees: [], requestedReviewers: [], draft: false, comments: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', headRef: null, headSha: null },
      ],
    });
    await storage.signals.upsertSignal('acme/api', 'standards', { passed: 2, total: 4, checks: [] });
  });

  describe('protocol', () => {
    it('initializes with the version the client asked for, when it knows it', async () => {
      const { result } = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
      expect(result).toMatchObject({
        protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'github-control' },
      });
      expect(typeof result.instructions).toBe('string');
      expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18');
    });

    it('answers ping, and accepts notifications without a body', async () => {
      expect(await rpc('ping')).toEqual({ jsonrpc: '2.0', id: expect.any(Number), result: {} });
      const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe('');
    });

    it('lists its tools with a schema and a read-only hint', async () => {
      const { tools } = (await rpc('tools/list')).result;
      expect(tools.map((tool: any) => tool.name)).toEqual([
        'list_repos', 'get_repo', 'list_alerts', 'get_inbox', 'list_dependencies', 'list_services', 'get_policy', 'plan_policy', 'update_repo',
      ]);
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.description.length).toBeGreaterThan(20);
      }
      expect(tools.filter((tool: any) => !tool.annotations.readOnlyHint).map((tool: any) => tool.name)).toEqual(['update_repo']);
    });

    it('answers a batch, leaving out the notifications in it', async () => {
      const res = await post([
        { jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'b', method: 'nope' },
      ]);
      const answers = await res.json() as any[];
      expect(answers.map((answer) => answer.id)).toEqual(['a', 'b']);
      expect(answers[1].error).toMatchObject({ code: -32601 });
      expect((await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }])).status).toBe(202);
    });

    it('reports malformed requests the JSON-RPC way', async () => {
      expect((await (await post('{')).json() as any).error.code).toBe(-32700);
      expect((await (await post({ id: 1, method: 'ping' })).json() as any).error.code).toBe(-32600);
      expect((await (await post([])).json() as any).error.code).toBe(-32600);
      expect((await rpc('tools/call', { name: 'drop_database' })).error).toMatchObject({ code: -32602 });
      expect((await rpc('tools/call', { name: 'list_repos', arguments: [] })).error).toMatchObject({ code: -32602 });
    });

    it('has no stream to offer and requires the API key', async () => {
      const get = await app.request('/api/mcp', { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
      expect(get.status).toBe(405);
      expect(get.headers.get('Allow')).toBe('POST');
      expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {})).status).toBe(401);
      expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer wrong' })).status).toBe(401);
    });
  });

  describe('tools', () => {
    it('list_repos filters and summarizes', async () => {
      const all = await call('list_repos');
      expect(all.data.total).toBe(2);
      expect(all.data.repos[0]).toEqual(expect.objectContaining({ repo: expect.any(String), health: { score: expect.any(Number), grade: expect.any(String) } }));

      expect((await call('list_repos', { ci: 'failing' })).data.repos.map((r: any) => r.repo)).toEqual(['acme/api']);
      expect((await call('list_repos', { ci: 'missing' })).data.repos.map((r: any) => r.repo)).toEqual(['acme/web']);
      expect((await call('list_repos', { priority: 'none' })).data.repos.map((r: any) => r.repo)).toEqual(['acme/web']);
      expect((await call('list_repos', { language: 'go' })).data.repos.map((r: any) => r.repo)).toEqual(['acme/api']);
      expect((await call('list_repos', { search: 'payments' })).data.repos.map((r: any) => r.repo)).toEqual(['acme/api']);
      expect((await call('list_repos', { max_health: -1 })).data.total).toBe(0);
      expect((await call('list_repos', { limit: 1 })).data).toMatchObject({ total: 2, repos: [expect.anything()] });
    });

    it('get_repo joins details, health breakdown and signals, without the inbox', async () => {
      const { data } = await call('get_repo', { repo: 'acme/api' });
      expect(data).toMatchObject({ full_name: 'acme/api', priority: 'high', health: { score: expect.any(Number), breakdown: expect.any(Object) } });
      expect(Object.keys(data.signals)).toEqual(['standards']);
    });

    it('reports a bad argument or an unknown repo as a tool error the model can read', async () => {
      for (const repo of ['../etc', 'acme/..', 'acme', 'a/b/c', 'acme/a b']) {
        expect(await call('get_repo', { repo })).toMatchObject({ isError: true, text: '"repo" must be "owner/name"' });
      }
      expect(await call('get_repo', { repo: 'acme/nope' })).toMatchObject({ isError: true, text: 'Repo not found' });
      expect(await call('update_repo', { repo: 'acme/api' })).toMatchObject({ isError: true, text: expect.stringContaining('at least one') });
    });

    it('get_inbox filters by type, repo and requested reviewer', async () => {
      expect((await call('get_inbox')).data).toMatchObject({ viewer: 'alice', total: 2 });
      expect((await call('get_inbox', { type: 'issue' })).data.items.map((i: any) => i.number)).toEqual([3]);
      expect((await call('get_inbox', { review_requested_from: 'alice' })).data.items.map((i: any) => i.number)).toEqual([7]);
      expect((await call('get_inbox', { repo: 'acme/web' })).data.total).toBe(0);
    });

    it('reads alerts, dependencies, services and the policy', async () => {
      await app.request('/api/alerts/evaluate', { method: 'POST', headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
      expect((await call('list_alerts')).data).toMatchObject({ open: 1, alerts: [expect.objectContaining({ key: 'ci_failing:acme/api' })] });
      expect((await call('list_dependencies')).data).toMatchObject({ packages: [], runtimes: [] });
      expect((await call('list_services')).data).toEqual([]);
      expect((await call('get_policy')).data).toMatchObject({ source: 'default', yaml: expect.stringContaining('version: 1') });
    });

    it('plan_policy returns the plan, or the errors of an invalid document, as its result', async () => {
      expect((await call('plan_policy', { yaml: 'alerts: { stale_days: 5 }' })).data).toMatchObject({
        valid: true, changes: [{ section: 'alerts', key: 'stale_days', from: 90, to: 5 }],
      });
      expect((await call('plan_policy', { yaml: 'nope: 1' })).data).toMatchObject({ valid: false, errors: [expect.any(String)] });
      expect((await call('plan_policy', {})).isError).toBe(true);
    });

    it('update_repo changes the dashboard and is logged as an agent', async () => {
      const res = await post(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_repo', arguments: { repo: 'acme/web', priority: 'low', notes: 'Looks abandoned', ignored: 1 } } },
        { Authorization: `Bearer ${mockEnv.API_KEY}`, 'X-Actor-Name': 'triage-bot' },
      );
      expect(JSON.parse((await res.json() as any).result.content[0].text)).toEqual({ repo: 'acme/web', updated: ['priority', 'notes'] });

      expect(await storage.repos.getRepo('acme/web')).toMatchObject({ priority: 'low', notes: 'Looks abandoned' });
      const [entry] = await storage.activity.listActivities({ limit: 5, offset: 0 }) as any[];
      expect(entry).toMatchObject({ action: 'meta.notes', actor_type: 'agent', actor_name: 'triage-bot' });
    });

    it('cannot do what the instance refuses over HTTP', async () => {
      env.DEMO = 'readonly';
      expect(await call('update_repo', { repo: 'acme/web', priority: 'low' })).toMatchObject({ isError: true, text: expect.stringContaining('demo') });
      expect((await call('list_repos')).data.total).toBe(2);
    });
  });
});
