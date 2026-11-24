/**
 * MCP server (Model Context Protocol, Streamable HTTP transport) at /api/mcp.
 *
 * It lets an agent use the dashboard as tools: every tool is a request to the
 * app's own HTTP API, made with the caller's credentials, so a tool can do
 * exactly what that caller could do over HTTP and nothing else (a demo
 * instance stays as restricted here as anywhere).
 *
 * The transport is the stateless subset: one JSON-RPC message (or batch) per
 * POST, answered as JSON. There are no sessions and no server-initiated
 * messages, so GET (the SSE stream) answers 405.
 */
import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';

const SERVER_INFO = { name: 'github-control', version: '0.2.0' };
/** Protocol revisions this server speaks, newest first. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Json = Record<string, any>;
/** Calls the app's own API as the current caller and returns the parsed body. */
type Api = (method: string, path: string, body?: unknown) => Promise<{ ok: boolean; status: number; body: any }>;

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  /** Hint for clients: true when the tool changes nothing. */
  readOnly: boolean;
  run(args: Json, api: Api): Promise<unknown>;
}

class ToolError extends Error {}

const repoArg = { type: 'string', description: 'Repository as "owner/name"' };

/** `owner/name`, where neither part is made of dots only: it goes into a URL path. */
const REPO_NAME = /^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/;

function repoPath(value: unknown): string {
  if (typeof value !== 'string' || !REPO_NAME.test(value)) throw new ToolError('"repo" must be "owner/name"');
  return value;
}

/** The API's answer, or a tool error carrying what the API said. */
async function ask(api: Api, method: string, path: string, body?: unknown): Promise<any> {
  const res = await api(method, path, body);
  if (!res.ok) throw new ToolError(res.body?.error ?? `The API answered HTTP ${res.status}`);
  return res.body;
}

const repoSummary = (repo: Json) => ({
  repo: repo.full_name,
  description: repo.description ?? null,
  language: repo.language ?? null,
  private: repo.is_private,
  priority: repo.priority ?? null,
  stars: repo.stars,
  health: repo.health_score ? { score: repo.health_score.score, grade: repo.health_score.grade } : null,
  ci: repo.ci_status ?? null,
  coverage: repo.test_coverage ?? null,
  last_commit_at: repo.last_commit_at ?? null,
  next_action: repo.next_action ?? null,
});

export const TOOLS: Tool[] = [
  {
    name: 'list_repos',
    description: 'List the tracked repositories with their health score, CI status, priority and last commit. Archived and paused repos are left out. Use the filters to narrow the list.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Text to look for in the name or description' },
        priority: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
        language: { type: 'string', description: 'Main language, e.g. "TypeScript"' },
        ci: { type: 'string', enum: ['failing', 'passing', 'missing'], description: 'failing/passing: latest run; missing: no CI configured' },
        max_health: { type: 'number', description: 'Only repos whose health score is at most this (0-100)' },
        limit: { type: 'number', description: 'Maximum number of repos to return (default 50)' },
      },
    },
    async run(args, api) {
      const repos: Json[] = await ask(api, 'GET', '/api/repos');
      const search = typeof args.search === 'string' ? args.search.toLowerCase() : '';
      const matches = repos.filter((repo) => {
        if (search && !`${repo.full_name} ${repo.description ?? ''}`.toLowerCase().includes(search)) return false;
        if (args.priority && (repo.priority ?? 'none') !== args.priority) return false;
        if (args.language && String(repo.language ?? '').toLowerCase() !== String(args.language).toLowerCase()) return false;
        if (args.ci === 'failing' && repo.ci_status !== 'failure') return false;
        if (args.ci === 'passing' && repo.ci_status !== 'success') return false;
        if (args.ci === 'missing' && repo.has_ci !== false) return false;
        if (typeof args.max_health === 'number' && !((repo.health_score?.score ?? 101) <= args.max_health)) return false;
        return true;
      });
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
      return { total: matches.length, repos: matches.slice(0, limit).map(repoSummary) };
    },
  },
  {
    name: 'get_repo',
    description: 'Everything known about one repository: metadata, notes, the health score with its breakdown, and the cached signals (standards, security alerts, CI reliability, release, branches, settings drift, dependencies).',
    readOnly: true,
    inputSchema: { type: 'object', properties: { repo: repoArg }, required: ['repo'] },
    async run(args, api) {
      const repo = repoPath(args.repo);
      const [details, health, signals] = await Promise.all([
        ask(api, 'GET', `/api/repos/${repo}`),
        ask(api, 'GET', `/api/repos/${repo}/health-score`),
        ask(api, 'GET', `/api/repos/${repo}/signals`),
      ]);
      // The inbox has its own tool and can be long.
      const { inbox: _inbox, ...rest } = signals.signals ?? {};
      return { ...details, health, signals: rest };
    },
  },
  {
    name: 'list_alerts',
    description: 'Alerts about the repositories and services: failing CI, services down, serious security alerts, stale repos, low health scores. Open ones by default.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'resolved', 'all'] } } },
    async run(args, api) {
      const status = ['open', 'resolved', 'all'].includes(args.status) ? args.status : 'open';
      const { alerts, open } = await ask(api, 'GET', `/api/alerts?status=${status}`);
      return { open, alerts };
    },
  },
  {
    name: 'get_inbox',
    description: 'Open pull requests and issues across all repositories, most recently updated first. "viewer" is the GitHub account the dashboard uses.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['pr', 'issue'] },
        repo: repoArg,
        review_requested_from: { type: 'string', description: 'GitHub login whose review was requested' },
        limit: { type: 'number', description: 'Maximum number of items (default 50)' },
      },
    },
    async run(args, api) {
      const inbox = await ask(api, 'GET', '/api/inbox');
      const items = (inbox.items as Json[]).filter((item) => (
        (!args.type || item.type === args.type)
        && (!args.repo || item.repo === args.repo)
        && (!args.review_requested_from || item.requestedReviewers.includes(args.review_requested_from))
      ));
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
      return { viewer: inbox.viewer, total: items.length, read_at: inbox.oldestCheck, items: items.slice(0, limit) };
    },
  },
  {
    name: 'list_dependencies',
    description: 'Which repositories use each package and at what version, where major versions diverge, and runtimes past their end of life.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'string', description: 'Only packages whose name contains this' },
        divergent_only: { type: 'boolean', description: 'Only packages used at more than one major version' },
      },
    },
    async run(args, api) {
      const inventory = await ask(api, 'GET', '/api/dependencies');
      const name = typeof args.package === 'string' ? args.package.toLowerCase() : '';
      const packages = (inventory.packages as Json[]).filter((pkg) => (
        (!name || pkg.name.toLowerCase().includes(name)) && (!args.divergent_only || pkg.divergent)
      ));
      return { repos_synced: inventory.repos_synced, packages: packages.slice(0, 200), runtimes: inventory.runtimes };
    },
  },
  {
    name: 'list_services',
    description: 'The deployed services behind the repositories with their current state and 30-day uptime.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    async run(_args, api) {
      const [services, uptime] = await Promise.all([ask(api, 'GET', '/api/services'), ask(api, 'GET', '/api/services/uptime')]);
      const list: Json[] = Array.isArray(services) ? services : services.services ?? [];
      return list.map((service) => ({
        slug: service.slug, name: service.name, url: service.url, repo: service.source_repo_full_name ?? null,
        status: service.last_check_status ?? 'unknown', checked_at: service.last_check_at ?? null,
        uptime_pct: uptime.services?.[service.slug]?.uptimePct ?? null,
        incidents: uptime.services?.[service.slug]?.incidents ?? 0,
      }));
    },
  },
  {
    name: 'search_code',
    description: 'Search the code of the tracked repositories on GitHub and get the files and lines that match. Unlike the other tools this asks GitHub live, which allows about 10 searches a minute. Supports GitHub code search qualifiers such as path:, extension: and filename:.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, e.g. "createStorage" or "TODO path:src"' },
        repo: repoArg,
        language: { type: 'string', description: 'Only files in this language, e.g. "typescript"' },
      },
      required: ['query'],
    },
    async run(args, api) {
      if (typeof args.query !== 'string' || !args.query.trim()) throw new ToolError('"query" must be the words to look for');
      const params = new URLSearchParams({ q: args.query });
      if (args.repo) params.set('repo', repoPath(args.repo));
      if (typeof args.language === 'string' && args.language) params.set('language', args.language);
      return ask(api, 'GET', `/api/search/code?${params}`);
    },
  },
  {
    name: 'get_policy',
    description: 'The policy in force as YAML: the repo settings baseline, health score weights and custom checks, and alert thresholds.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    async run(_args, api) {
      const { source, editable, yaml, errors } = await ask(api, 'GET', '/api/policy');
      return { source, editable, yaml, errors };
    },
  },
  {
    name: 'plan_policy',
    description: 'Dry run of a new policy document: validates it and reports what it changes and how scores, settings drift and alerts would move. Changes nothing.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { yaml: { type: 'string', description: 'The policy document' } }, required: ['yaml'] },
    async run(args, api) {
      if (typeof args.yaml !== 'string') throw new ToolError('"yaml" must be the policy document as text');
      // An invalid document is a result, not a failure: the errors are the answer.
      return (await api('POST', '/api/policy/plan', { yaml: args.yaml })).body;
    },
  },
  {
    name: 'update_repo',
    description: 'Record a decision about a repository in the dashboard: its priority, the next action, or notes. Changes the dashboard only, never GitHub.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        repo: repoArg,
        priority: { type: 'string', enum: ['high', 'medium', 'low', 'paused'] },
        next_action: { type: 'string', maxLength: 500 },
        notes: { type: 'string', maxLength: 5000 },
      },
      required: ['repo'],
    },
    async run(args, api) {
      const repo = repoPath(args.repo);
      const updates: Json = {};
      for (const field of ['priority', 'next_action', 'notes']) {
        if (typeof args[field] === 'string') updates[field] = args[field];
      }
      if (Object.keys(updates).length === 0) throw new ToolError('Give at least one of: priority, next_action, notes');
      await ask(api, 'PATCH', `/api/meta/${repo}`, updates);
      return { repo, updated: Object.keys(updates) };
    },
  },
];

const describeTool = ({ name, description, inputSchema, readOnly }: Tool) => ({
  name, description, inputSchema,
  // search_code is the one tool that reaches outside the dashboard's own data.
  annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: name === 'search_code' },
});

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Answers one JSON-RPC message. Returns null for a notification (which gets no answer). */
export async function handleMessage(message: any, api: Api): Promise<Json | null> {
  if (message === null || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id, -32600, 'Invalid request');
  }
  const { id, method, params } = message;
  if (id === undefined) return null;
  const result = (value: unknown) => ({ jsonrpc: '2.0', id, result: value });

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return result({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'GitHub Control: a dashboard over all of the user\'s GitHub repositories. Tools read what it already knows (health, CI, alerts, pull requests, dependencies, services) without querying GitHub; only search_code asks GitHub live.',
      });
    }
    case 'ping':
      return result({});
    case 'tools/list':
      return result({ tools: TOOLS.map(describeTool) });
    case 'tools/call': {
      const tool = TOOLS.find((candidate) => candidate.name === params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      const args = params?.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'Tool arguments must be an object');
      try {
        const value = await tool.run(args, api);
        return result({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: false });
      } catch (error: any) {
        // Failures of the tool itself are reported in the result, so the model can read them and adjust.
        const text = error instanceof ToolError ? error.message : `The tool failed: ${error?.message ?? 'unknown error'}`;
        return result({ content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** `forward` sends a request to the app itself; the MCP routes are mounted on that same app. */
export function createMcpRoutes(forward: (request: Request, env: HttpEnv['Bindings']) => Response | Promise<Response>) {
  const routes = new Hono<HttpEnv>();

  routes.post('/', async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'Parse error'), 400);
    }

    const origin = new URL(c.req.url).origin;
    const authorization = c.req.header('Authorization');
    const api: Api = async (method, path, body) => {
      const res = await forward(new Request(`${origin}${path}`, {
        method,
        headers: {
          ...(authorization && { Authorization: authorization }),
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          'X-Actor-Type': 'agent', 'X-Actor-Name': c.req.header('X-Actor-Name') || 'mcp',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), c.env);
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
    };

    if (Array.isArray(payload)) {
      if (payload.length === 0) return c.json(rpcError(null, -32600, 'Invalid request'), 400);
      const answers = (await Promise.all(payload.map((message) => handleMessage(message, api)))).filter(Boolean);
      return answers.length > 0 ? c.json(answers) : c.body(null, 202);
    }
    const answer = await handleMessage(payload, api);
    return answer ? c.json(answer) : c.body(null, 202);
  });

  // No server-to-client stream and no sessions to close.
  routes.on(['GET', 'DELETE'], '/', (c) => c.json(rpcError(null, -32000, 'Method not allowed'), 405, { Allow: 'POST' }));

  return routes;
}
