import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

// Mock @octokit/rest at the Octokit level — real analyzers will run
const mockGetContent = vi.fn();
const mockGetReadme = vi.fn();
const mockGet = vi.fn();
const mockGetTree = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () { return {
    repos: {
      getContent: mockGetContent,
      getReadme: mockGetReadme,
      get: mockGet,
    },
    git: {
      getTree: mockGetTree,
    },
  }; }),
}));

// Mock only DB client
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: vi.fn(() => Object.assign(vi.fn(), { transaction: vi.fn() })),
}));

import app from '@back/index';

function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  return app.request(path, { ...options, headers }, mockEnv);
}

function mockRepoGet(language = 'TypeScript') {
  mockGet.mockResolvedValue({
    data: {
      size: 1024, default_branch: 'main', topics: [], license: null,
      homepage: null, fork: false, parent: null, has_issues: true,
      has_projects: true, has_wiki: true, has_pages: false,
      has_discussions: false, subscribers_count: 1, is_template: false,
      language, stargazers_count: 0, forks_count: 0, watchers_count: 0,
      open_issues_count: 0, private: false, archived: false,
      pushed_at: null, created_at: null, updated_at: null,
      description: null, has_discussions: false,
    },
  });
}

describe('health sync integration (real analyzers pipeline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly detects a large README through the full chain', async () => {
    mockQueryOne.mockResolvedValue({ language: 'TypeScript' });
    mockQuery.mockResolvedValue([]);

    mockRepoGet();
    // Tree includes README.md so the analyzer detects it
    mockGetTree.mockResolvedValue({ data: { tree: [{ path: 'src/index.ts' }, { path: 'README.md' }] } });

    // getRepoReadme is called to supplement line count in API mode
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: documentation content`);
    const encoded = Buffer.from(lines.join('\n')).toString('base64');
    mockGetReadme.mockResolvedValue({ data: { content: encoded, sha: 'sha200' } });

    const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.health.hasReadme).toBe(true);
    expect(body.health.readmeLines).toBe(200);
    expect(body.health.docsQuality).toBe('good');
  });

  it('returns excellent for a 400-line README', async () => {
    mockQueryOne.mockResolvedValue({ language: 'Python' });
    mockQuery.mockResolvedValue([]);

    mockRepoGet('Python');
    mockGetTree.mockResolvedValue({ data: { tree: [{ path: 'main.py' }, { path: 'README.md' }] } });

    const lines = Array.from({ length: 400 }, (_, i) => `Line ${i + 1}`);
    const encoded = Buffer.from(lines.join('\n')).toString('base64');
    mockGetReadme.mockResolvedValue({ data: { content: encoded, sha: 'sha400' } });

    const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.health.readmeLines).toBe(400);
    expect(body.health.docsQuality).toBe('excellent');
  });

  it('propagates rate limit errors with correct status code', async () => {
    mockQueryOne.mockResolvedValue({ language: 'TypeScript' });

    // repos.get succeeds but getTree hits rate limit
    mockRepoGet();
    const error: any = new Error('API rate limit exceeded');
    error.status = 403;
    mockGetTree.mockRejectedValue(error);

    const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('rate limit');
    // DB update should NOT have been called — no false data saved
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propagates 401 auth errors with correct status code', async () => {
    mockQueryOne.mockResolvedValue({ language: 'TypeScript' });
    const error: any = new Error('Bad credentials');
    error.status = 401;
    mockGet.mockRejectedValue(error);

    const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toContain('Bad credentials');
  });
});
