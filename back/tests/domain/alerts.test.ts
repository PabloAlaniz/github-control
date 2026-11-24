import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_OPTIONS, evaluateConditions, planAlerts, resolveAlertOptions, type Condition,
} from '@back/domain/alerts';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const repo = (name: string, extra: Record<string, unknown> = {}) => ({
  full_name: `acme/${name}`, default_branch: 'main', is_archived: false, is_deleted: false,
  priority: null, ci_status: 'success', ci_status_url: null, last_commit_at: daysAgo(1), last_health_check: null,
  ...extra,
});

const evaluate = (input: {
  repos?: Record<string, any>[]; services?: Record<string, any>[];
  signals?: Record<string, Record<string, any>>; options?: Partial<typeof DEFAULT_ALERT_OPTIONS>;
}) => evaluateConditions({
  repos: input.repos ?? [], services: input.services ?? [],
  signals: new Map(Object.entries(input.signals ?? {})),
  options: { ...DEFAULT_ALERT_OPTIONS, ...input.options }, now: NOW,
});

describe('alert rules', () => {
  it('reports nothing when everything is fine', () => {
    expect(evaluate({
      repos: [repo('api')],
      services: [{ slug: 'web', name: 'Web', is_active: true, last_check_status: 'healthy' }],
    })).toEqual([]);
  });

  it('reports failing CI with a link to the run', () => {
    const [condition] = evaluate({
      repos: [repo('api', { ci_status: 'failure', ci_status_url: 'https://github.com/acme/api/actions/runs/1' })],
    });
    expect(condition).toMatchObject({
      key: 'ci_failing:acme/api', kind: 'ci_failing', entity: 'acme/api',
      title: 'CI is failing on acme/api', url: 'https://github.com/acme/api/actions/runs/1', level: 0,
    });
    expect(evaluate({ repos: [repo('api', { ci_status: 'failure' })] })[0].url).toBe('https://github.com/acme/api/actions');
    expect(evaluate({ repos: [repo('api', { ci_status: 'in_progress' })] })).toEqual([]);
  });

  it('reports critical and high security alerts, and gets worse as they grow', () => {
    const security = (critical: number, high: number, medium = 0) =>
      ({ 'acme/api': { security: { bySeverity: { critical, high, medium, low: 0 }, top: [{ title: 'lodash: prototype pollution' }] } } });

    expect(evaluate({ repos: [repo('api')], signals: security(0, 0, 7) })).toEqual([]);

    const [one] = evaluate({ repos: [repo('api')], signals: security(0, 1) });
    expect(one).toMatchObject({
      key: 'security:acme/api', title: '1 serious security alert on acme/api (1 high)',
      detail: { critical: 0, high: 1, top: ['lodash: prototype pollution'] }, url: 'https://github.com/acme/api/security',
    });
    const [more] = evaluate({ repos: [repo('api')], signals: security(0, 2) });
    const [critical] = evaluate({ repos: [repo('api')], signals: security(1, 0) });
    expect(more.level).toBeGreaterThan(one.level);
    expect(critical.level).toBeGreaterThan(more.level);
    expect(critical.title).toBe('1 serious security alert on acme/api (1 critical)');
  });

  it('reports stale repos only when they have a high or medium priority', () => {
    const repos = [
      repo('high', { priority: 'high', last_commit_at: daysAgo(120) }),
      repo('medium', { priority: 'medium', last_commit_at: daysAgo(90) }),
      repo('recent', { priority: 'high', last_commit_at: daysAgo(89) }),
      repo('low', { priority: 'low', last_commit_at: daysAgo(400) }),
      repo('none', { last_commit_at: daysAgo(400) }),
      repo('empty', { priority: 'high', last_commit_at: null }),
    ];
    expect(evaluate({ repos }).map((c) => c.key)).toEqual(['repo_stale:acme/high', 'repo_stale:acme/medium']);
    expect(evaluate({ repos })[0].title).toBe('acme/high has had no commits for 120 days');
    expect(evaluate({ repos, options: { staleDays: 0 } })).toEqual([]);
    expect(evaluate({ repos, options: { staleDays: 100 } }).map((c) => c.entity)).toEqual(['acme/high']);
  });

  it('reports a low health score only for repos whose health was checked', () => {
    const bare = { has_ci: false, has_tests: false, has_readme: false, has_gitignore: false, last_commit_at: daysAgo(500) };
    const repos = [repo('checked', { ...bare, last_health_check: daysAgo(1) }), repo('unchecked', bare)];

    const found = evaluate({ repos });
    expect(found.map((c) => c.key)).toEqual(['health_low:acme/checked']);
    expect(found[0].detail).toMatchObject({ threshold: 40, score: expect.any(Number), grade: expect.any(String) });
    expect(found[0].title).toMatch(/^Health score of acme\/checked is \d+ \([A-F]\), below 40$/);
    expect(evaluate({ repos, options: { healthBelow: 0 } })).toEqual([]);
  });

  it('ignores archived, deleted and paused repos', () => {
    const failing = { ci_status: 'failure' };
    expect(evaluate({
      repos: [
        repo('archived', { ...failing, is_archived: true }),
        repo('deleted', { ...failing, is_deleted: true }),
        repo('paused', { ...failing, priority: 'paused' }),
      ],
    })).toEqual([]);
  });

  it('reports active services that are down', () => {
    const services = [
      { slug: 'api', name: 'API', url: 'https://api.test', is_active: true, last_check_status: 'down', last_check_http_code: 503, source_repo_full_name: 'acme/api' },
      { slug: 'slow', name: 'Slow', is_active: true, last_check_status: 'degraded' },
      { slug: 'off', name: 'Off', is_active: false, last_check_status: 'down' },
      { slug: 'new', name: 'New', is_active: true, last_check_status: null },
    ];
    expect(evaluate({ services })).toEqual([{
      key: 'service_down:api', kind: 'service_down', entity: 'api', title: 'API is down',
      detail: { httpCode: 503, repo: 'acme/api' }, url: 'https://api.test', level: 0,
    }]);
  });

  it('orders conditions by key', () => {
    const keys = evaluate({
      repos: [repo('b', { ci_status: 'failure' }), repo('a', { ci_status: 'failure' })],
      services: [{ slug: 'api', name: 'API', is_active: true, last_check_status: 'down' }],
    }).map((c) => c.key);
    expect(keys).toEqual(['ci_failing:acme/a', 'ci_failing:acme/b', 'service_down:api']);
  });
});

describe('policy rules', () => {
  const rule = (when: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'r', label: 'Rule', when, ...extra }) as any;
  const run = (rules: any[], repos: Record<string, any>[], signals: Record<string, Record<string, any>> = {}) =>
    evaluateConditions({
      repos, services: [], signals: new Map(Object.entries(signals)), now: NOW,
      options: { staleDays: 0, healthBelow: 0, rules },
    });

  it('opens an alert per repo where the condition holds, saying why', () => {
    const repos = [repo('low', { test_coverage: 41 }), repo('fine', { test_coverage: 90 }), repo('unknown', { test_coverage: null })];
    expect(run([rule({ coverage_below: 60 }, { id: 'low-coverage', label: 'Coverage under 60%' })], repos)).toEqual([{
      key: 'rule:low-coverage:acme/low', kind: 'custom', entity: 'acme/low',
      title: 'Coverage under 60%: acme/low (coverage is 41%)',
      detail: { rule: 'low-coverage', finding: 'coverage is 41%' }, url: 'https://github.com/acme/low', level: 0,
    }]);
  });

  it.each([
    [{ check: 'codeowners' }, { policy: { checks: [{ id: 'codeowners', label: 'CODEOWNERS file', passed: false }] } }, 'check "CODEOWNERS file" fails'],
    [{ ci_success_below: 80 }, { ci: { successRate: 71 } }, 'CI passes 71% of the time'],
    [{ unreleased_commits_over: 20 }, { release: { unreleasedCommits: 41 } }, '41 commits not released'],
    [{ settings_drift_over: 0 }, { config: { drift: 2 } }, '2 settings out of line'],
    [{ scorecard_below: 5 }, { scorecard: { score: 3.2 } }, 'OpenSSF Scorecard is 3.2'],
    [{ vulnerabilities_over: 0 }, { vulnerabilities: { total: 1 } }, '1 known vulnerability in pinned dependencies'],
    [{ vulnerabilities_over: 2 }, { vulnerabilities: { total: 5 } }, '5 known vulnerabilities in pinned dependencies'],
    [{ eol_runtime: true }, { dependencies: { runtimes: [{ name: 'node', release: '18', eolDate: '2025-04-30' }, { name: 'python', release: '3.12', eolDate: '2028-10-31' }] } }, 'node 18 past end of life'],
  ])('%o holds when the signal says so', (when, signals, finding) => {
    const [condition] = run([rule(when)], [repo('api')], { 'acme/api': signals as any });
    expect(condition.detail.finding).toBe(finding);
  });

  it.each([
    [{ check: 'codeowners' }, { policy: { checks: [{ id: 'codeowners', passed: true }] } }],
    [{ check: 'codeowners' }, { policy: { checks: [{ id: 'codeowners', passed: null }] } }],
    [{ check: 'codeowners' }, {}],
    [{ ci_success_below: 80 }, { ci: { successRate: 80 } }],
    [{ ci_success_below: 80 }, { ci: { available: false } }],
    [{ unreleased_commits_over: 20 }, { release: { unreleasedCommits: 20 } }],
    [{ settings_drift_over: 0 }, { config: { drift: 0 } }],
    [{ scorecard_below: 5 }, { scorecard: { available: false } }],
    [{ vulnerabilities_over: 0 }, { vulnerabilities: { enabled: false } }],
    [{ vulnerabilities_over: 0 }, { vulnerabilities: { total: 0 } }],
    [{ eol_runtime: true }, { dependencies: { runtimes: [{ name: 'go', release: '1', eolDate: null }] } }],
  ])('%o stays quiet when it does not hold or was never synced', (when, signals) => {
    expect(run([rule(when)], [repo('api')], { 'acme/api': signals as any })).toEqual([]);
  });

  it('follows the scope of the rule', () => {
    const repos = [
      repo('high', { test_coverage: 10, priority: 'high' }), repo('low', { test_coverage: 10, priority: 'low' }),
      repo('none', { test_coverage: 10 }), repo('private', { test_coverage: 10, priority: 'high', is_private: true }),
    ];
    const entities = (extra: Record<string, unknown>) => run([rule({ coverage_below: 60 }, extra)], repos).map((c) => c.entity);

    expect(entities({})).toHaveLength(4);
    expect(entities({ priority: ['high'] })).toEqual(['acme/high', 'acme/private']);
    expect(entities({ priority: ['none', 'low'] })).toEqual(['acme/low', 'acme/none']);
    expect(entities({ only: 'private' })).toEqual(['acme/private']);
    expect(entities({ only: 'public', priority: ['high'] })).toEqual(['acme/high']);
  });

  it('skips archived and paused repos like every other alert', () => {
    expect(run([rule({ coverage_below: 60 })], [repo('old', { test_coverage: 1, is_archived: true }), repo('paused', { test_coverage: 1, priority: 'paused' })])).toEqual([]);
  });
});

describe('alert options', () => {
  it('uses the defaults unless a valid value is configured', () => {
    expect(resolveAlertOptions({})).toMatchObject({ staleDays: 90, healthBelow: 40 });
    expect(resolveAlertOptions({ ALERT_STALE_DAYS: '30', ALERT_HEALTH_BELOW: '0' })).toMatchObject({ staleDays: 30, healthBelow: 0 });
    expect(resolveAlertOptions({ ALERT_STALE_DAYS: 'soon', ALERT_HEALTH_BELOW: '150' })).toMatchObject({ staleDays: 90, healthBelow: 40 });
    expect(resolveAlertOptions({ ALERT_STALE_DAYS: ' ', ALERT_HEALTH_BELOW: '-1' })).toMatchObject({ staleDays: 90, healthBelow: 40 });
  });
});

describe('planAlerts', () => {
  const condition = (key: string, extra: Partial<Condition> = {}): Condition => ({
    key, kind: 'security', entity: 'acme/api', title: `Title ${key}`, detail: {}, url: null, level: 0, ...extra,
  });
  const open = (id: number, key: string, extra: Record<string, unknown> = {}) =>
    ({ id, key, kind: 'security', level: 0, title: `Title ${key}`, url: null, ...extra });

  it('opens what is new, resolves what is gone and leaves the rest alone', () => {
    const plan = planAlerts([condition('a'), condition('b')], [open(1, 'b'), open(2, 'c')]);
    expect(plan.open.map((c) => c.key)).toEqual(['a']);
    expect(plan.update).toEqual([]);
    expect(plan.resolve.map((a) => a.id)).toEqual([2]);
  });

  it('marks an open alert as worsened only when its level goes up', () => {
    const worse = planAlerts([condition('a', { level: 2 })], [open(1, 'a', { level: 1 })]);
    expect(worse.update).toEqual([{ id: 1, condition: expect.objectContaining({ level: 2 }), worsened: true }]);

    const better = planAlerts([condition('a', { level: 1 })], [open(1, 'a', { level: 2 })]);
    expect(better.update[0].worsened).toBe(false);

    const reworded = planAlerts([condition('a', { title: 'New words' })], [open(1, 'a')]);
    expect(reworded.update[0]).toMatchObject({ id: 1, worsened: false });
  });
});
