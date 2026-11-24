/**
 * Policy changes, previewed before they are applied: what the new document
 * says differently, and what that would do to the repos, computed from what is
 * already stored (no GitHub calls).
 */
import type { AppContext } from '../application/context';
import { evaluateConditions } from '../domain/alerts';
import { buildPolicy, parsePolicyDocument, resolvePolicy, serializePolicy, type Policy } from '../domain/policy';
import { BASELINE_SETTINGS } from '../domain/repo-baseline';
import { computeHealthScore, repoRowToHealthInput } from '../lib/analyzers/healthScore';
import { groupSignals } from './signal.service';

export interface Change { section: string; key: string; from: unknown; to: unknown }

export interface RepoImpact {
  repo: string;
  scoreBefore: number;
  scoreAfter: number;
  /** Settings that differ from the baseline; null when the repo's settings were never read. */
  driftBefore: number | null;
  driftAfter: number | null;
}

export interface PolicyPlan {
  valid: true;
  /** The new policy, complete, as it would be stored. */
  yaml: string;
  changes: Change[];
  impact: {
    repos: number;
    averageBefore: number | null;
    averageAfter: number | null;
    scoreUp: number;
    scoreDown: number;
    driftBefore: number;
    driftAfter: number;
    alertsBefore: number;
    alertsAfter: number;
    /** The repos whose score or drift changes, biggest score change first. */
    affected: RepoImpact[];
  };
  /** Things only the next sync can tell (new checks, settings never read). */
  notes: string[];
}

export type PlanResult = PolicyPlan | { valid: false; errors: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What `next` says differently from `current`, one entry per value. */
export function diffPolicies(current: Policy, next: Policy): Change[] {
  const changes: Change[] = [];
  const compare = (section: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!same(a[key], b[key])) changes.push({ section, key, from: a[key] ?? null, to: b[key] ?? null });
    }
  };
  const byId = (policy: Policy) => Object.fromEntries(policy.health.checks.map((check) => [check.id, check]));

  compare('baseline', current.baseline, next.baseline);
  compare('health.weights', current.health.weights, next.health.weights);
  compare('health.checks', byId(current), byId(next));
  // Named as in the document, so a change reads like the line that caused it.
  const alerts = (policy: Policy) => ({ stale_days: policy.alerts.staleDays, health_below: policy.alerts.healthBelow });
  compare('alerts', alerts(current), alerts(next));
  const rulesById = (policy: Policy) => Object.fromEntries(policy.alerts.rules.map((rule) => [rule.id, rule]));
  compare('alerts.rules', rulesById(current), rulesById(next));
  const signals = (policy: Policy) => ({ openssf_scorecard: policy.signals.scorecard, known_vulnerabilities: policy.signals.vulnerabilities });
  compare('signals', signals(current), signals(next));
  return changes;
}

const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

function driftUnder(policy: Policy, config: Record<string, any> | undefined): number | null {
  if (!config) return null;
  if (config.applicable === false) return 0;
  const actuals: Record<string, boolean | null> = config.actuals
    ?? Object.fromEntries((config.settings ?? []).map((setting: any) => [setting.key, setting.actual]));
  let drift = 0;
  for (const [key, expected] of Object.entries(policy.baseline)) {
    const actual = actuals[key];
    if (typeof actual === 'boolean' && actual !== expected) drift++;
  }
  return drift;
}

/** Validates `text` and describes what adopting it would change. Changes nothing. */
export async function planPolicy(ctx: AppContext, text: string): Promise<PlanResult> {
  const { document, errors } = parsePolicyDocument(text);
  if (!document) return { valid: false, errors };

  const current = resolvePolicy(ctx.config);
  // Sections the document leaves out fall back to the single-purpose settings, as they will once applied.
  const next = buildPolicy(document, ctx.config);

  const [repos, signalRecords, services] = await Promise.all([
    ctx.storage.repos.listRepos(),
    ctx.storage.signals.listSignals(),
    ctx.storage.services.listServices({}),
  ]);
  const signals = groupSignals(signalRecords, { summary: true });

  const perRepo: RepoImpact[] = repos.map((repo) => {
    const repoSignals = signals.get(repo.full_name) ?? {};
    const input = repoRowToHealthInput({ ...repo, signals: repoSignals });
    return {
      repo: repo.full_name,
      scoreBefore: computeHealthScore(input, current.health).score,
      scoreAfter: computeHealthScore(input, next.health).score,
      driftBefore: driftUnder(current, repoSignals.config),
      driftAfter: driftUnder(next, repoSignals.config),
    };
  });

  const alertCount = (policy: Policy) => evaluateConditions({
    repos, services, signals, now: new Date(),
    options: { staleDays: policy.alerts.staleDays, healthBelow: policy.alerts.healthBelow, rules: policy.alerts.rules, health: policy.health },
  }).length;

  const notes: string[] = [];
  const currentIds = new Set(current.health.checks.map((check) => check.id));
  const added = next.health.checks.filter((check) => !currentIds.has(check.id));
  if (added.length > 0) {
    notes.push(`New checks (${added.map((check) => check.id).join(', ')}) count once each repo is synced again; the scores above do not include them yet.`);
  }
  /** True when no stored `config` signal says what the repo has for this setting. */
  const neverRead = (key: string) => repos.every((repo) => {
    const config = signals.get(repo.full_name)?.config as Record<string, any> | undefined;
    if (!config) return true;
    const known = (value: unknown) => typeof value === 'boolean';
    return !known(config.actuals?.[key]) && !(config.settings ?? []).some((setting: any) => setting.key === key && known(setting.actual));
  });
  const unread = perRepo.length > 0 ? Object.keys(next.baseline).filter(neverRead) : [];
  if (unread.length > 0) notes.push(`Not read from GitHub yet, so drift is unknown until the next sync: ${unread.join(', ')}.`);
  if (next.signals.scorecard && !current.signals.scorecard) {
    notes.push('OpenSSF Scorecard results are fetched at the next sync, for public repos only; their names are sent to api.securityscorecards.dev.');
  }

  if (next.signals.vulnerabilities && !current.signals.vulnerabilities) {
    notes.push('Known vulnerabilities are looked up at the next sync: the names and versions of the packages in each lockfile are sent to api.osv.dev, never the name of a repo.');
  }

  const sum = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return {
    valid: true,
    yaml: serializePolicy(next),
    changes: diffPolicies(current, next),
    impact: {
      repos: perRepo.length,
      averageBefore: average(perRepo.map((r) => r.scoreBefore)),
      averageAfter: average(perRepo.map((r) => r.scoreAfter)),
      scoreUp: perRepo.filter((r) => r.scoreAfter > r.scoreBefore).length,
      scoreDown: perRepo.filter((r) => r.scoreAfter < r.scoreBefore).length,
      driftBefore: sum(perRepo.map((r) => r.driftBefore)),
      driftAfter: sum(perRepo.map((r) => r.driftAfter)),
      alertsBefore: alertCount(current),
      alertsAfter: alertCount(next),
      affected: perRepo
        .filter((r) => r.scoreBefore !== r.scoreAfter || r.driftBefore !== r.driftAfter)
        .sort((a, b) => Math.abs(b.scoreAfter - b.scoreBefore) - Math.abs(a.scoreAfter - a.scoreBefore) || a.repo.localeCompare(b.repo))
        .slice(0, 50),
    },
    notes,
  };
}

/** Where the policy in force comes from, and whether it can be changed from the app. */
export function describePolicy(config: AppContext['config']) {
  const source = config.POLICY_SOURCE ?? (config.POLICY ? 'env' : 'default');
  const { errors } = parsePolicyDocument(config.POLICY ?? '');
  return {
    source,
    editable: !!config.settings && source !== 'file' && source !== 'env',
    /** The document as written (empty when none); `yaml` below is the complete policy it results in. */
    text: config.POLICY ?? '',
    yaml: serializePolicy(resolvePolicy(config)),
    /** Set when the stored document is broken and the defaults are in force instead. */
    errors,
    settings: BASELINE_SETTINGS.map(({ key, label }) => ({ key, label })),
  };
}
