import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { collectPolicy } from '@back/lib/signals/policy';
import { collectScorecard, summarizeScorecard } from '@back/lib/signals/scorecard';
import { diffConfig } from '@back/lib/signals/config';
import { resolveBaseline } from '@back/domain/repo-baseline';

let env: any;
let storage: Storage;
const request = (path: string, init: RequestInit = {}) => app.request(path, {
  ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json', ...init.headers },
}, env);
const plan = async (yaml: string) => {
  const res = await request('/api/policy/plan', { method: 'POST', body: JSON.stringify({ yaml }) });
  return { status: res.status, body: await res.json() as any };
};

describe('policy API', () => {
  beforeEach(async () => {
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([
      repoRecord('acme/api', { last_commit_at: new Date(Date.now() - 400 * 86_400_000).toISOString() }),
      repoRecord('acme/web', { last_commit_at: new Date().toISOString() }),
    ]);
    await storage.meta.patchRepoMeta('acme/api', { has_ci: true, has_tests: true, has_readme: true });
    await storage.meta.patchRepoMeta('acme/web', { has_ci: false, has_readme: true });
    await storage.signals.upsertSignal('acme/api', 'config', diffConfig(
      { delete_branch_on_merge: false, has_wiki: true, allow_merge_commit: false, allow_squash_merge: true, allow_update_branch: true, has_projects: true },
      resolveBaseline(undefined),
    ));
  });

  it('describes the policy in force, complete, even when nothing was configured', async () => {
    const body = await (await request('/api/policy')).json() as any;
    expect(body).toMatchObject({ source: 'default', editable: false, text: '', errors: [] });
    expect(body.yaml).toContain('version: 1');
    expect(body.yaml).toContain('stale_days: 90');
    expect(body.settings).toContainEqual({ key: 'has_wiki', label: 'Wiki' });
  });

  it('reports a stored document that is broken', async () => {
    env.POLICY = 'baseline: { nope: true }';
    const body = await (await request('/api/policy')).json() as any;
    expect(body.source).toBe('env');
    expect(body.errors[0]).toMatch(/baseline\.nope/);
  });

  describe('plan', () => {
    it('finds nothing to change in the policy already in force', async () => {
      const current = (await (await request('/api/policy')).json() as any).yaml;
      const { status, body } = await plan(current);
      expect(status).toBe(200);
      expect(body).toMatchObject({ valid: true, changes: [], notes: [] });
      expect(body.impact).toMatchObject({ repos: 2, scoreUp: 0, scoreDown: 0, affected: [] });
      expect(body.impact.averageBefore).toBe(body.impact.averageAfter);
    });

    it('explains why a document is not valid, and changes nothing', async () => {
      const { status, body } = await plan('health: { weights: { speed: 3 } }');
      expect(status).toBe(422);
      expect(body.valid).toBe(false);
      expect(body.errors.join()).toMatch(/speed/);
    });

    it('shows how new weights move the scores', async () => {
      const { body } = await plan('health: { weights: { freshness: 0 } }');
      expect(body.changes).toEqual([{ section: 'health.weights', key: 'freshness', from: 20, to: 0 }]);

      const api = body.impact.affected.find((r: any) => r.repo === 'acme/api');
      const web = body.impact.affected.find((r: any) => r.repo === 'acme/web');
      // The stale repo no longer loses the freshness points; the fresh one no longer earns them.
      expect(api.scoreAfter).toBeGreaterThan(api.scoreBefore);
      expect(web.scoreAfter).toBeLessThan(web.scoreBefore);
      expect(body.impact).toMatchObject({ scoreUp: 1, scoreDown: 1 });
    });

    it('recomputes settings drift from what was read at the last sync', async () => {
      const { body } = await plan('baseline: { has_projects: false, has_wiki: true }');
      expect(body.changes.map((c: any) => `${c.key}:${c.from}->${c.to}`)).toEqual(expect.arrayContaining([
        'has_projects:null->false', 'has_wiki:false->true', 'delete_branch_on_merge:true->null',
      ]));
      // Before: delete_branch_on_merge and has_wiki drifted. After: only has_projects does.
      expect(body.impact).toMatchObject({ driftBefore: 2, driftAfter: 1 });
      expect(body.impact.affected).toContainEqual(expect.objectContaining({ repo: 'acme/api', driftBefore: 2, driftAfter: 1 }));
      expect(body.notes).toEqual([]);

      // A setting GitHub was never asked about: its drift is unknown until the next sync.
      const unread = await plan('baseline: { allow_auto_merge: false }');
      expect(unread.body.notes).toEqual([expect.stringMatching(/drift is unknown until the next sync: allow_auto_merge/)]);
    });

    it('counts the alerts new thresholds would open', async () => {
      await storage.meta.patchRepoMeta('acme/api', { priority: 'high' });
      const { body } = await plan('alerts: { stale_days: 500 }');
      expect(body.impact.alertsBefore).toBe(1);   // acme/api is stale at 90 days
      expect(body.impact.alertsAfter).toBe(0);
      expect(body.changes).toEqual([{ section: 'alerts', key: 'stale_days', from: 90, to: 500 }]);
    });

    it('says what only the next sync can tell', async () => {
      const { body } = await plan(`
health:
  checks:
    - { id: codeowners, label: CODEOWNERS, files: [CODEOWNERS] }
signals: { openssf_scorecard: true }
`);
      expect(body.notes).toHaveLength(2);
      expect(body.notes[0]).toMatch(/New checks \(codeowners\)/);
      expect(body.notes[1]).toMatch(/securityscorecards/);
      expect(body.changes.map((c: any) => `${c.section}.${c.key}`)).toEqual(['health.weights.custom', 'health.checks.codeowners', 'signals.openssf_scorecard']);
    });

    it('accepts the YAML as plain text too, and refuses anything else', async () => {
      const text = await request('/api/policy/plan', { method: 'POST', body: 'alerts: { health_below: 10 }', headers: { 'Content-Type': 'text/yaml' } });
      expect((await text.json() as any).valid).toBe(true);
      expect((await request('/api/policy/plan', { method: 'POST', body: '{"yml": 1}' })).status).toBe(400);
      expect((await request('/api/policy/plan', { method: 'POST', body: '{' })).status).toBe(400);
      expect((await request('/api/policy/plan', { method: 'POST', body: 'x'.repeat(60_000), headers: { 'Content-Type': 'text/yaml' } })).status).toBe(400);
    });
  });

  it('cannot be changed where the configuration is fixed at deploy time', async () => {
    const res = await request('/api/policy', { method: 'PUT', body: JSON.stringify({ yaml: 'alerts: { stale_days: 5 }' }) });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toMatch(/set the POLICY variable/);
  });

  it('applies to the scores the dashboard shows', async () => {
    const score = async () =>
      (await (await request('/api/repos')).json() as any[]).find((repo) => repo.full_name === 'acme/api').health_score.score;
    const before = await score();
    env.POLICY = 'health: { weights: { freshness: 0 } }';
    expect(await score()).toBeGreaterThan(before);
  });

  it('requires authentication', async () => {
    expect((await app.request('/api/policy', {}, env)).status).toBe(401);
    expect((await app.request('/api/policy/plan', { method: 'POST' }, env)).status).toBe(401);
  });
});

describe('policy signals', () => {
  const ctx = (extra: Record<string, unknown>) => ({
    owner: 'acme', repo: 'api',
    tree: async () => ['.github/CODEOWNERS', 'src/index.ts', 'apps/web/.env'],
    repoInfo: async () => ({ default_branch: 'main', private: false }),
    policy: { checks: [], scorecard: false },
    ...extra,
  }) as any;

  it('runs the custom checks against the repo tree', async () => {
    const checks = [
      { id: 'codeowners', label: 'CODEOWNERS', weight: 5, files: ['CODEOWNERS', '.github/CODEOWNERS'] },
      { id: 'no-env', label: 'No .env', weight: 5, forbidden: ['**/.env'] },
      { id: 'private-only', label: 'Internal docs', weight: 5, files: ['INTERNAL.md'], only: 'private' as const },
    ];
    expect(await collectPolicy(ctx({ policy: { checks, scorecard: false } }))).toEqual({
      checks: [
        { id: 'codeowners', passed: true, label: 'CODEOWNERS' },
        { id: 'no-env', passed: false, label: 'No .env' },
        { id: 'private-only', passed: null, label: 'Internal docs' },
      ],
      passed: 1, total: 2,
    });
  });

  it('does not read the tree when the policy has no checks', async () => {
    const tree = vi.fn();
    expect(await collectPolicy(ctx({ tree }))).toEqual({ checks: [], passed: 0, total: 0 });
    expect(tree).not.toHaveBeenCalled();
  });

  describe('OpenSSF Scorecard', () => {
    const result = {
      date: '2026-01-01T00:00:00Z', score: 7.4,
      checks: [
        { name: 'Code-Review', score: 4, reason: 'few reviews' }, { name: 'Maintained', score: 10, reason: 'active' },
        { name: 'Fuzzing', score: -1, reason: 'not evaluated' }, { name: 'Pinned-Dependencies', score: 0, reason: 'unpinned' },
      ],
    };

    it('keeps the score and the weakest checks', () => {
      const summary = summarizeScorecard(result);
      expect(summary).toMatchObject({ available: true, score: 7.4, date: '2026-01-01T00:00:00Z' });
      expect(summary.weakest.map((c) => c.name)).toEqual(['Pinned-Dependencies', 'Code-Review', 'Maintained']);
      expect(summary.items.find((c) => c.name === 'Fuzzing')!.score).toBeNull();
      expect(summarizeScorecard({})).toMatchObject({ score: null, weakest: [], items: [] });
    });

    it('asks nothing unless the policy turns it on, and never about a private repo', async () => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      try {
        expect(await collectScorecard(ctx({}))).toEqual({ enabled: false });
        expect(await collectScorecard(ctx({
          policy: { checks: [], scorecard: true }, repoInfo: async () => ({ default_branch: 'main', private: true }),
        }))).toEqual({ enabled: true, available: false, reason: 'private' });
        expect(fetcher).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('fetches the result of a public repo and copes with one that was never scanned', async () => {
      const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(result))).mockResolvedValueOnce(new Response('', { status: 404 }));
      vi.stubGlobal('fetch', fetcher);
      try {
        const on = ctx({ policy: { checks: [], scorecard: true } });
        expect(await collectScorecard(on)).toMatchObject({ enabled: true, available: true, score: 7.4 });
        expect(fetcher.mock.calls[0][0]).toBe('https://api.securityscorecards.dev/projects/github.com/acme/api');
        expect(await collectScorecard(on)).toEqual({ enabled: true, available: false, reason: 'not_scanned' });

        fetcher.mockResolvedValueOnce(new Response('', { status: 500 }));
        await expect(collectScorecard(on)).rejects.toThrow(/HTTP 500/);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
