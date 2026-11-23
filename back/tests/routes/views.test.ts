import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

// Mock GitHub lib (required because index.ts imports it)
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import { createStorage } from '@back/infrastructure/storage';
import type { Storage } from '@back/application/ports/storage';

// Routes run against the real in-memory adapter: no SQL mocks.
let env: any;
let storage: Storage;

async function view(name: string) {
  const res = await app.request(`/api/views/${name}`, {
    headers: { Authorization: `Bearer ${mockEnv.API_KEY}` },
  }, env);
  expect(res.status).toBe(200);
  return (await res.json()).repos as any[];
}

const repo = (name: string) => ({ full_name: `acme/${name}`, owner: 'acme', name, is_private: false, is_archived: false });
const names = (rows: any[]) => rows.map((r) => r.full_name);

describe('views routes', () => {
  beforeEach(async () => {
    env = { ...mockEnv, STORAGE_DRIVER: 'memory' };
    storage = createStorage(env);
    await storage.repos.refreshFromGitHub([
      repo('ready'), repo('rough'), repo('untouched'), repo('paused'), repo('gone'),
      { ...repo('archived'), is_archived: true },
    ]);
    await storage.repos.refreshFromGitHub([
      repo('ready'), repo('rough'), repo('untouched'), repo('paused'),
      { ...repo('archived'), is_archived: true },
    ]); // 'gone' is now soft-deleted

    await storage.meta.patchRepoMeta('acme/ready', {
      priority: 'high', next_action: 'release', has_ci: true, has_tests: true, has_readme: true,
      has_roadmap: true, docs_quality: 'good', last_health_check: '2026-02-01T00:00:00Z',
      last_docs_check: '2026-02-01T00:00:00Z', stack: 'node',
    });
    await storage.meta.patchRepoMeta('acme/rough', {
      priority: 'low', has_ci: false, has_tests: false, has_readme: false,
      docs_quality: 'missing', last_health_check: '2026-01-01T00:00:00Z',
    });
    await storage.meta.patchRepoMeta('acme/paused', { priority: 'paused', next_action: 'later' });
    await storage.meta.patchRepoMeta('acme/archived', { priority: 'high', next_action: 'never' });
    await storage.meta.patchRepoMeta('acme/gone', { priority: 'high', next_action: 'never' });

    const group = await storage.groups.createGroup('web', 'web');
    await storage.groups.addRepoToGroup((await storage.groups.getRepoId('acme/ready'))!.id, group!.id);
  });

  it('never includes archived, deleted or paused repos', async () => {
    for (const name of ['backlog', 'health', 'needs-ci', 'needs-tests', 'needs-docs', 'almost-done', 'needs-roadmap']) {
      const listed = names(await view(name));
      expect(listed).not.toContain('acme/archived');
      expect(listed).not.toContain('acme/gone');
      expect(listed).not.toContain('acme/paused');
    }
  });

  it('health: every active repo, never-checked first, with its groups', async () => {
    const rows = await view('health');
    expect(names(rows)).toEqual(['acme/untouched', 'acme/rough', 'acme/ready']);
    expect(rows[2]).toEqual({
      full_name: 'acme/ready', has_ci: true, has_tests: true, test_coverage: null, has_readme: true,
      readme_lines: null, has_gitignore: null, has_roadmap: true, stack: 'node', production_urls: {},
      last_health_check: '2026-02-01T00:00:00.000Z', docs_quality: 'good', docs_file_count: 0, groups: ['web'],
    });
  });

  it('needs-ci and needs-tests: repos where the flag is false or unknown', async () => {
    const ci = await view('needs-ci');
    expect(names(ci)).toEqual(['acme/untouched', 'acme/rough']);
    expect(Object.keys(ci[0])).toEqual(['full_name', 'owner', 'name', 'stack', 'last_health_check']);

    const tests = await view('needs-tests');
    expect(names(tests)).toEqual(['acme/untouched', 'acme/rough']);
    expect(Object.keys(tests[0])).toEqual(['full_name', 'owner', 'name', 'stack', 'test_coverage', 'last_health_check']);
  });

  it('needs-docs: no README, weak docs or docs never assessed', async () => {
    const rows = await view('needs-docs');
    expect(names(rows).sort()).toEqual(['acme/rough', 'acme/untouched']);
    expect(Object.keys(rows[0])).toEqual(
      ['full_name', 'owner', 'name', 'readme_lines', 'docs_quality', 'docs_file_count', 'last_docs_check'],
    );
  });

  it('needs-roadmap: ordered by priority, then least recently checked', async () => {
    const rows = await view('needs-roadmap');
    expect(names(rows)).toEqual(['acme/rough', 'acme/untouched']);
    expect(rows[0].priority).toBe('low');
  });

  it('almost-done: high priority repos that have a next action', async () => {
    expect(await view('almost-done')).toEqual([{
      full_name: 'acme/ready', owner: 'acme', name: 'ready',
      priority: 'high', next_action: 'release', blockers: [],
    }]);
  });

  it('backlog: prioritized repos, highest priority first', async () => {
    const rows = await view('backlog');
    expect(names(rows)).toEqual(['acme/ready', 'acme/rough']);
    expect(rows[0]).toEqual({
      full_name: 'acme/ready', priority: 'high', next_action: 'release', blockers: [],
      has_ci: true, has_tests: true, stack: 'node', groups: ['web'],
    });
  });

  it('returns an empty list when nothing matches', async () => {
    env = { ...mockEnv, STORAGE_DRIVER: 'memory' };
    expect(await view('backlog')).toEqual([]);
  });
});
