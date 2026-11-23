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

describe('alert options', () => {
  it('uses the defaults unless a valid value is configured', () => {
    expect(resolveAlertOptions({})).toEqual({ staleDays: 90, healthBelow: 40 });
    expect(resolveAlertOptions({ ALERT_STALE_DAYS: '30', ALERT_HEALTH_BELOW: '0' })).toEqual({ staleDays: 30, healthBelow: 0 });
    expect(resolveAlertOptions({ ALERT_STALE_DAYS: 'soon', ALERT_HEALTH_BELOW: '150' })).toEqual({ staleDays: 90, healthBelow: 40 });
    expect(resolveAlertOptions({ ALERT_STALE_DAYS: ' ', ALERT_HEALTH_BELOW: '-1' })).toEqual({ staleDays: 90, healthBelow: 40 });
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
