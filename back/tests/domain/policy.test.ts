import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS, buildPolicy, globToRegExp, parsePolicyDocument, policyBaseline, resolvePolicy, runCustomChecks, serializePolicy,
} from '@back/domain/policy';
import { computeHealthScore } from '@back/lib/analyzers/healthScore';

const YAML = `
version: 1
baseline:
  delete_branch_on_merge: true
  has_wiki: false
health:
  weights:
    tests: 40
    freshness: 0
  checks:
    - id: codeowners
      label: CODEOWNERS file
      weight: 6
      files: [CODEOWNERS, .github/CODEOWNERS]
    - id: no-env
      label: No .env committed
      forbidden: ['**/.env']
      only: public
alerts:
  stale_days: 30
signals:
  openssf_scorecard: true
`;

describe('policy document', () => {
  it('reads a complete document', () => {
    const { document, errors } = parsePolicyDocument(YAML);
    expect(errors).toEqual([]);
    expect(buildPolicy(document!)).toEqual({
      baseline: { delete_branch_on_merge: true, has_wiki: false },
      health: {
        weights: { ...DEFAULT_WEIGHTS, tests: 40, freshness: 0, custom: 11 },
        checks: [
          { id: 'codeowners', label: 'CODEOWNERS file', weight: 6, files: ['CODEOWNERS', '.github/CODEOWNERS'] },
          { id: 'no-env', label: 'No .env committed', weight: 5, forbidden: ['**/.env'], only: 'public' },
        ],
      },
      alerts: { staleDays: 30, healthBelow: 40 },
      signals: { scorecard: true },
    });
  });

  it('accepts JSON and an empty document', () => {
    expect(parsePolicyDocument('{"alerts": {"health_below": 55}}')).toEqual({ document: { alerts: { health_below: 55 } }, errors: [] });
    expect(parsePolicyDocument('  \n')).toEqual({ document: {}, errors: [] });
    expect(parsePolicyDocument('# only a comment')).toEqual({ document: {}, errors: [] });
  });

  it.each([
    ['baseline: [1', /Not valid YAML/],
    ['- a\n- b', /must be a mapping/],
    ['basline: {}', /basline/i],
    ['baseline: { has_wiki: "no" }', /baseline\.has_wiki/],
    ['baseline: { allow_forking: true }', /baseline\.allow_forking: not a setting/],
    ['health: { weights: { speed: 5 } }', /speed/],
    ['health: { weights: { ci: -1 } }', /health\.weights\.ci/],
    ['health: { checks: [{ id: "Bad Id", label: x, files: [a] }] }', /health\.checks\.0\.id/],
    ['health: { checks: [{ id: a, label: x }] }', /either "files" or "forbidden"/],
    ['health: { checks: [{ id: a, label: x, files: [a], forbidden: [b] }] }', /either "files" or "forbidden"/],
    ['health: { checks: [{ id: a, label: x, files: [a] }, { id: a, label: y, files: [b] }] }', /"a" is used more than once/],
    ['alerts: { stale_days: 1.5 }', /alerts\.stale_days/],
    ['version: 2', /version/],
  ])('rejects %s', (text, message) => {
    const { document, errors } = parsePolicyDocument(text);
    expect(document).toBeNull();
    expect(errors.join('\n')).toMatch(message);
  });

  it('falls back to the single-purpose settings for sections it leaves out', () => {
    const legacy = { REPO_BASELINE: '{"has_wiki":true}', ALERT_STALE_DAYS: '14', ALERT_HEALTH_BELOW: '70' };
    expect(buildPolicy({}, legacy)).toMatchObject({ baseline: { has_wiki: true }, alerts: { staleDays: 14, healthBelow: 70 } });
    expect(buildPolicy({ baseline: {}, alerts: { health_below: 10 } }, legacy)).toMatchObject({
      baseline: {}, alerts: { staleDays: 14, healthBelow: 10 },
    });
  });

  it('with nothing configured is the built-in behaviour', () => {
    const policy = resolvePolicy({});
    expect(policy.health).toEqual({ weights: { ...DEFAULT_WEIGHTS, custom: 0 }, checks: [] });
    expect(policy.alerts).toEqual({ staleDays: 90, healthBelow: 40 });
    expect(policy.signals.scorecard).toBe(false);
    expect(Object.keys(policy.baseline).length).toBeGreaterThan(0);
  });

  it('ignores a broken document instead of failing', () => {
    expect(resolvePolicy({ POLICY: 'baseline: [1', ALERT_STALE_DAYS: '7' }).alerts.staleDays).toBe(7);
  });

  it('writes itself out completely, and reads back the same', () => {
    const policy = buildPolicy(parsePolicyDocument(YAML).document!);
    const text = serializePolicy(policy);
    expect(text).toContain('openssf_scorecard: true');
    expect(buildPolicy(parsePolicyDocument(text).document!)).toEqual(policy);
  });

  it('labels the settings of its baseline', () => {
    expect(policyBaseline(buildPolicy({ baseline: { has_wiki: false } }))).toEqual({ has_wiki: { expected: false, label: 'Wiki' } });
  });
});

describe('custom checks', () => {
  it('matches paths with * and **', () => {
    expect(globToRegExp('CODEOWNERS').test('CODEOWNERS')).toBe(true);
    expect(globToRegExp('CODEOWNERS').test('docs/CODEOWNERS')).toBe(false);
    expect(globToRegExp('**/.env').test('.env')).toBe(true);
    expect(globToRegExp('**/.env').test('apps/api/.env')).toBe(true);
    expect(globToRegExp('**/.env').test('apps/api/.env.example')).toBe(false);
    expect(globToRegExp('docs/*.md').test('docs/guide.md')).toBe(true);
    expect(globToRegExp('docs/*.md').test('docs/a/guide.md')).toBe(false);
    expect(globToRegExp('.github/workflows/**').test('.github/workflows/ci.yml')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(globToRegExp('readme.md').test('README.md')).toBe(true);
  });

  it('passes "files" when one exists and "forbidden" when none does', () => {
    const { checks } = buildPolicy(parsePolicyDocument(YAML).document!).health;
    const run = (paths: string[], isPrivate = false) => runCustomChecks(checks, { paths, isPrivate });

    expect(run(['.github/CODEOWNERS', 'src/a.ts'])).toEqual([{ id: 'codeowners', passed: true }, { id: 'no-env', passed: true }]);
    expect(run(['src/.env'])).toEqual([{ id: 'codeowners', passed: false }, { id: 'no-env', passed: false }]);
    // "only: public" does not apply to a private repo.
    expect(run(['src/.env'], true)[1]).toEqual({ id: 'no-env', passed: null });
  });
});

describe('health score under a policy', () => {
  const input = {
    hasCi: true, hasTests: true, hasUnitTests: true, hasReadme: true, readmeLines: 60, hasLintConfig: true,
    hasGitignore: true, lastCommitAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
  };
  const policy = (text: string) => buildPolicy(parsePolicyDocument(text).document!).health;

  it('is unchanged by the default weights', () => {
    const plain = computeHealthScore(input);
    const withDefaults = computeHealthScore(input, policy(''));
    expect(withDefaults.score).toBe(plain.score);
    expect(withDefaults.breakdown.tests.weight).toBe(25);
    expect(withDefaults.breakdown.custom).toBeUndefined();
  });

  it('counts each category for its weight, relative to the others', () => {
    const plain = computeHealthScore(input).score;
    // Freshness earned nothing (last commit over a year ago): ignoring it raises the score.
    const noFreshness = computeHealthScore(input, policy('health: { weights: { freshness: 0 } }')).score;
    expect(noFreshness).toBeGreaterThan(plain);
    // Only CI counts, and it is fully met.
    expect(computeHealthScore(input, policy('health: { weights: { tests: 0, docs: 0, quality: 0, hygiene: 0, freshness: 0 } }')).score).toBe(100);
    expect(computeHealthScore(input, policy('health: { weights: { ci: 0, tests: 0, docs: 0, quality: 0, hygiene: 0, freshness: 0 } }')).score).toBe(0);
  });

  it('adds the custom checks once they have run for the repo', () => {
    const health = policy(YAML);
    const before = computeHealthScore(input, health);
    expect(before.breakdown.custom!.checks.map((c) => [c.key, c.passed])).toEqual([['custom:codeowners', null], ['custom:no-env', null]]);

    const passing = computeHealthScore({ ...input, custom: [{ id: 'codeowners', passed: true }, { id: 'no-env', passed: true }] }, health);
    const failing = computeHealthScore({ ...input, custom: [{ id: 'codeowners', passed: false }, { id: 'no-env', passed: false }] }, health);
    expect(passing.score).toBeGreaterThan(before.score);
    expect(failing.score).toBeLessThan(before.score);
    expect(passing.breakdown.custom).toMatchObject({ score: 11, max: 11, weight: 11 });
  });

  it('leaves out a check that does not apply to the repo', () => {
    const result = computeHealthScore({ ...input, custom: [{ id: 'codeowners', passed: true }, { id: 'no-env', passed: null }] }, policy(YAML));
    expect(result.breakdown.custom).toMatchObject({ score: 6, max: 6 });
  });
});
