/**
 * Alert rules: which conditions currently need attention, given what the
 * storage knows. Pure: no storage or HTTP imports.
 *
 * A condition has a stable `key`. The alert service compares the conditions
 * that hold now with the alerts that are open and derives what happened:
 * a condition appeared (opened), got worse (its `level` went up) or went away
 * (resolved).
 */
import { computeHealthScore, repoRowToHealthInput } from '../lib/analyzers/healthScore';
import { resolvePolicy, type AlertRule, type HealthPolicy, type PolicyConfig } from './policy';

export const ALERT_KINDS = ['ci_failing', 'service_down', 'security', 'repo_stale', 'health_low', 'custom'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  ci_failing: 'CI failing',
  service_down: 'Service down',
  security: 'Security alerts',
  repo_stale: 'Repo went stale',
  health_low: 'Low health score',
  custom: 'Policy rule',
};

/** Kinds whose end is worth a message of its own ("back to normal"). */
export const RECOVERY_KINDS: readonly string[] = ['ci_failing', 'service_down'];

export function isAlertKind(value: string): value is AlertKind {
  return (ALERT_KINDS as readonly string[]).includes(value);
}

export interface AlertOptions {
  /** Days without commits after which a prioritized repo is stale. 0 turns the rule off. */
  staleDays: number;
  /** Health score under which a repo is reported. 0 turns the rule off. */
  healthBelow: number;
  /** How the health score is computed (weights, custom checks). Unset = the built-in score. */
  health?: HealthPolicy;
  /** The policy's own alert rules. */
  rules?: AlertRule[];
}

export const DEFAULT_ALERT_OPTIONS: AlertOptions = { staleDays: 90, healthBelow: 40 };

/** Options from the policy in force (or the `ALERT_STALE_DAYS` and `ALERT_HEALTH_BELOW` settings). */
export function resolveAlertOptions(config: PolicyConfig): AlertOptions {
  const policy = resolvePolicy(config);
  return { staleDays: policy.alerts.staleDays, healthBelow: policy.alerts.healthBelow, rules: policy.alerts.rules, health: policy.health };
}

export interface Condition {
  key: string;
  kind: AlertKind;
  entity: string;
  title: string;
  detail: Record<string, unknown>;
  url: string | null;
  level: number;
}

export interface ConditionInput {
  /** Rows of `repos`. Archived, deleted and paused repos are ignored. */
  repos: Record<string, any>[];
  /** Rows of `services`. Inactive services are ignored. */
  services: Record<string, any>[];
  /** Signal data per repo and kind, as `groupSignals` returns it. */
  signals: Map<string, Record<string, Record<string, any>>>;
  options: AlertOptions;
  now: Date;
}

const DAY_MS = 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Why a rule's condition holds for a repo, in a few words, or null when it
 * does not (or when the data it needs was never synced).
 */
export function ruleFinding(rule: AlertRule, repo: Record<string, any>, signals: Record<string, Record<string, any>>, now: Date): string | null {
  const { when } = rule;
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

  if (when.check !== undefined) {
    const result = (signals.policy?.checks ?? []).find((check: any) => check.id === when.check);
    return result?.passed === false ? `check "${result.label ?? when.check}" fails` : null;
  }
  if (when.coverage_below !== undefined) {
    const coverage = number(repo.test_coverage);
    return coverage !== null && coverage < Number(when.coverage_below) ? `coverage is ${coverage}%` : null;
  }
  if (when.ci_success_below !== undefined) {
    const rate = number(signals.ci?.successRate);
    return rate !== null && rate < Number(when.ci_success_below) ? `CI passes ${rate}% of the time` : null;
  }
  if (when.unreleased_commits_over !== undefined) {
    const commits = number(signals.release?.unreleasedCommits);
    return commits !== null && commits > Number(when.unreleased_commits_over) ? `${commits} commits not released` : null;
  }
  if (when.settings_drift_over !== undefined) {
    const drift = number(signals.config?.drift);
    return drift !== null && drift > Number(when.settings_drift_over) ? `${drift} settings out of line` : null;
  }
  if (when.scorecard_below !== undefined) {
    const score = number(signals.scorecard?.score);
    return score !== null && score < Number(when.scorecard_below) ? `OpenSSF Scorecard is ${score}` : null;
  }
  if (when.eol_runtime) {
    const today = now.toISOString().slice(0, 10);
    const past = (signals.dependencies?.runtimes ?? []).filter((runtime: any) => typeof runtime.eolDate === 'string' && runtime.eolDate < today);
    return past.length > 0 ? `${past.map((runtime: any) => `${runtime.name} ${runtime.release ?? runtime.version}`).join(', ')} past end of life` : null;
  }
  return null;
}

function ruleApplies(rule: AlertRule, repo: Record<string, any>): boolean {
  if (rule.only && (rule.only === 'private') !== (repo.is_private === true)) return false;
  return !rule.priority || rule.priority.includes(repo.priority ?? 'none');
}

function repoConditions(repo: Record<string, any>, input: ConditionInput): Condition[] {
  const { options, now } = input;
  const fullName: string = repo.full_name;
  const repoUrl = `https://github.com/${fullName}`;
  const signals = input.signals.get(fullName) ?? {};
  const found: Condition[] = [];

  if (repo.ci_status === 'failure') {
    found.push({
      key: `ci_failing:${fullName}`, kind: 'ci_failing', entity: fullName,
      title: `CI is failing on ${fullName}`,
      detail: { branch: repo.default_branch ?? null },
      url: repo.ci_status_url || `${repoUrl}/actions`, level: 0,
    });
  }

  const severities = signals.security?.bySeverity;
  const critical = Number(severities?.critical) || 0;
  const high = Number(severities?.high) || 0;
  if (critical + high > 0) {
    const parts = [critical && `${critical} critical`, high && `${high} high`].filter(Boolean).join(', ');
    found.push({
      key: `security:${fullName}`, kind: 'security', entity: fullName,
      title: `${plural(critical + high, 'serious security alert')} on ${fullName} (${parts})`,
      detail: { critical, high, top: (signals.security?.top ?? []).slice(0, 3).map((a: any) => a.title) },
      url: `${repoUrl}/security`,
      // Goes up when an alert is added, and by more when it is a critical one.
      level: critical * 1000 + high,
    });
  }

  const prioritized = repo.priority === 'high' || repo.priority === 'medium';
  if (options.staleDays > 0 && prioritized && repo.last_commit_at) {
    const days = Math.floor((now.getTime() - new Date(repo.last_commit_at).getTime()) / DAY_MS);
    if (days >= options.staleDays) {
      found.push({
        key: `repo_stale:${fullName}`, kind: 'repo_stale', entity: fullName,
        title: `${fullName} has had no commits for ${days} days`,
        detail: { lastCommitAt: repo.last_commit_at, priority: repo.priority },
        url: repoUrl, level: 0,
      });
    }
  }

  // Only repos whose health was actually checked: an unchecked repo scores low for lack of data.
  if (options.healthBelow > 0 && repo.last_health_check) {
    const { score, grade } = computeHealthScore(repoRowToHealthInput({ ...repo, signals }), options.health);
    if (score < options.healthBelow) {
      found.push({
        key: `health_low:${fullName}`, kind: 'health_low', entity: fullName,
        title: `Health score of ${fullName} is ${score} (${grade}), below ${options.healthBelow}`,
        detail: { score, grade, threshold: options.healthBelow },
        url: repoUrl, level: 0,
      });
    }
  }

  for (const rule of options.rules ?? []) {
    if (!ruleApplies(rule, repo)) continue;
    const finding = ruleFinding(rule, repo, signals, now);
    if (!finding) continue;
    found.push({
      key: `rule:${rule.id}:${fullName}`, kind: 'custom', entity: fullName,
      title: `${rule.label}: ${fullName} (${finding})`,
      detail: { rule: rule.id, finding },
      url: repoUrl, level: 0,
    });
  }

  return found;
}

/** Every condition that holds right now, ordered by key. */
export function evaluateConditions(input: ConditionInput): Condition[] {
  const found: Condition[] = [];

  for (const repo of input.repos) {
    if (repo.is_archived || repo.is_deleted || repo.priority === 'paused') continue;
    found.push(...repoConditions(repo, input));
  }

  for (const service of input.services) {
    if (service.is_active === false || service.last_check_status !== 'down') continue;
    found.push({
      key: `service_down:${service.slug}`, kind: 'service_down', entity: service.slug,
      title: `${service.name ?? service.slug} is down`,
      detail: { httpCode: service.last_check_http_code ?? null, repo: service.source_repo_full_name ?? null },
      url: service.url ?? null, level: 0,
    });
  }

  return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export type AlertEventType = 'opened' | 'worsened' | 'resolved';

export interface OpenAlertLike { id: number; key: string; kind: string; level: number; title: string; url: string | null }

export interface AlertPlan {
  open: Condition[];
  /** Open alerts whose text or level changed; `worsened` when the level went up. */
  update: { id: number; condition: Condition; worsened: boolean }[];
  resolve: OpenAlertLike[];
}

/** What to do so the open alerts match the conditions that hold. */
export function planAlerts(conditions: Condition[], openAlerts: OpenAlertLike[]): AlertPlan {
  const byKey = new Map(openAlerts.map((alert) => [alert.key, alert]));
  const holding = new Set(conditions.map((condition) => condition.key));
  const plan: AlertPlan = { open: [], update: [], resolve: [] };

  for (const condition of conditions) {
    const alert = byKey.get(condition.key);
    if (!alert) plan.open.push(condition);
    else if (alert.level !== condition.level || alert.title !== condition.title || alert.url !== condition.url) {
      plan.update.push({ id: alert.id, condition, worsened: condition.level > alert.level });
    }
  }
  plan.resolve = openAlerts.filter((alert) => !holding.has(alert.key));
  return plan;
}
