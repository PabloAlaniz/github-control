/**
 * The policy: what is expected of every repo, in one document that can be kept
 * under version control.
 *
 *   version: 1
 *   baseline:                 # repo settings every repo must have
 *     delete_branch_on_merge: true
 *   health:
 *     weights:                # how much each category counts (relative)
 *       tests: 40
 *     checks:                 # checks of your own, counted in the health score
 *       - id: codeowners
 *         label: CODEOWNERS file
 *         weight: 5
 *         files: [CODEOWNERS, .github/CODEOWNERS]
 *   alerts:
 *     stale_days: 90
 *     health_below: 40
 *     rules:                  # alerts of your own
 *       - id: low-coverage
 *         label: Coverage under 60%
 *         when: { coverage_below: 60 }
 *         priority: [high]
 *   signals:
 *     openssf_scorecard: true
 *     known_vulnerabilities: true
 *
 * Every section is optional: what a document leaves out keeps its default (or
 * the older single-purpose settings REPO_BASELINE, ALERT_STALE_DAYS and
 * ALERT_HEALTH_BELOW). Pure: no storage or HTTP imports.
 */
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { BASELINE_SETTINGS, baselineValues, isBaselineKey, type Baseline } from './repo-baseline';

export const HEALTH_CATEGORIES = ['ci', 'tests', 'docs', 'quality', 'hygiene', 'freshness'] as const;
export type HealthCategoryName = (typeof HEALTH_CATEGORIES)[number];

/** Points of each built-in category when nothing is configured; they add up to 100. */
export const DEFAULT_WEIGHTS: Record<HealthCategoryName, number> = {
  ci: 15, tests: 25, docs: 15, quality: 15, hygiene: 10, freshness: 20,
};

export interface CustomCheck {
  id: string;
  label: string;
  /** Points within the "custom" category. */
  weight: number;
  /** Passes when at least one of these paths exists (`*` and `**` allowed). */
  files?: string[];
  /** Passes when none of these paths exists. */
  forbidden?: string[];
  /** Limits the check to public or to private repos. */
  only?: 'public' | 'private';
}

/** The conditions a rule can watch. A rule has exactly one. */
export const RULE_CONDITIONS = [
  'check', 'coverage_below', 'ci_success_below', 'unreleased_commits_over', 'settings_drift_over', 'scorecard_below', 'eol_runtime', 'vulnerabilities_over',
] as const;
export type RuleCondition = (typeof RULE_CONDITIONS)[number];

/** An alert rule of the policy: opens an alert for each repo where its condition holds. */
export interface AlertRule {
  id: string;
  label: string;
  /** Exactly one condition, e.g. `{ coverage_below: 60 }` or `{ check: 'codeowners' }`. */
  when: Partial<Record<RuleCondition, number | string | boolean>>;
  /** Only repos with one of these priorities ("none" for repos without one). */
  priority?: ('high' | 'medium' | 'low' | 'none')[];
  only?: 'public' | 'private';
}

export interface HealthPolicy {
  /** Relative weight per category. `custom` is the weight of the custom checks as a whole. */
  weights: Record<HealthCategoryName | 'custom', number>;
  checks: CustomCheck[];
}

export interface Policy {
  /** `{ setting: expected }` for the repo settings to enforce. */
  baseline: Record<string, boolean>;
  health: HealthPolicy;
  alerts: { staleDays: number; healthBelow: number; rules: AlertRule[] };
  signals: { scorecard: boolean; vulnerabilities: boolean };
}

const weight = z.number().min(0).max(1000);

const CheckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'id must be lowercase letters, digits, "-" or "_" (max 40)'),
  label: z.string().trim().min(1).max(80),
  weight: weight.default(5),
  files: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  forbidden: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  only: z.enum(['public', 'private']).optional(),
}).strict().refine((check) => !!check.files !== !!check.forbidden, 'a check needs either "files" or "forbidden"');

const percent = z.number().min(0).max(100);
const count = z.number().int().min(0).max(100000);

const RuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'id must be lowercase letters, digits, "-" or "_" (max 40)'),
  label: z.string().trim().min(1).max(80),
  when: z.object({
    check: z.string().min(1).max(40),
    coverage_below: percent,
    ci_success_below: percent,
    unreleased_commits_over: count,
    settings_drift_over: count,
    scorecard_below: z.number().min(0).max(10),
    eol_runtime: z.literal(true),
    vulnerabilities_over: count,
  }).partial().strict().refine((when) => Object.keys(when).length === 1, 'a rule needs exactly one condition'),
  priority: z.array(z.enum(['high', 'medium', 'low', 'none'])).min(1).max(4).optional(),
  only: z.enum(['public', 'private']).optional(),
}).strict();

const DocumentSchema = z.object({
  version: z.literal(1).optional(),
  baseline: z.record(z.string(), z.boolean()).optional(),
  health: z.object({
    weights: z.object({
      ci: weight, tests: weight, docs: weight, quality: weight, hygiene: weight, freshness: weight, custom: weight,
    }).partial().strict().optional(),
    checks: z.array(CheckSchema).max(30).optional(),
  }).strict().optional(),
  alerts: z.object({
    stale_days: z.number().int().min(0).max(3650),
    health_below: z.number().int().min(0).max(100),
    rules: z.array(RuleSchema).max(30),
  }).partial().strict().optional(),
  signals: z.object({ openssf_scorecard: z.boolean(), known_vulnerabilities: z.boolean() }).partial().strict().optional(),
}).strict();

export type PolicyDocument = z.infer<typeof DocumentSchema>;

export interface ParsedPolicy {
  document: PolicyDocument | null;
  /** Why the text is not a usable policy; empty when it is. */
  errors: string[];
}

/** Reads a policy document written in YAML (JSON is YAML too). */
export function parsePolicyDocument(text: string): ParsedPolicy {
  if (!text.trim()) return { document: {}, errors: [] };
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error: any) {
    return { document: null, errors: [`Not valid YAML: ${String(error?.message ?? error).split('\n')[0]}`] };
  }
  if (raw === null || raw === undefined) return { document: {}, errors: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { document: null, errors: ['The policy must be a mapping of sections'] };

  const parsed = DocumentSchema.safeParse(raw);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  const document = parsed.success ? parsed.data : null;
  for (const key of Object.keys(document?.baseline ?? {})) {
    if (!isBaselineKey(key)) {
      errors.push(`baseline.${key}: not a setting the baseline can enforce (${BASELINE_SETTINGS.map((s) => s.key).join(', ')})`);
    }
  }
  const ids = (document?.health?.checks ?? []).map((check) => check.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    errors.push(`health.checks: the id "${id}" is used more than once`);
  }
  const rules = document?.alerts?.rules ?? [];
  const ruleIds = rules.map((rule) => rule.id);
  for (const id of new Set(ruleIds.filter((id, index) => ruleIds.indexOf(id) !== index))) {
    errors.push(`alerts.rules: the id "${id}" is used more than once`);
  }
  for (const rule of rules) {
    if (rule.when.check !== undefined && !ids.includes(rule.when.check)) {
      errors.push(`alerts.rules.${rule.id}: there is no check "${rule.when.check}" in health.checks`);
    }
  }
  return errors.length > 0 ? { document: null, errors } : { document, errors };
}

/** What the older single-purpose settings say, used for the sections a document leaves out. */
export interface LegacySettings {
  REPO_BASELINE?: string;
  ALERT_STALE_DAYS?: string;
  ALERT_HEALTH_BELOW?: string;
}

const numberOr = (raw: string | undefined, fallback: number, max: number) => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= max ? Math.floor(value) : fallback;
};

/** The complete policy: the document where it speaks, the defaults elsewhere. */
export function buildPolicy(document: PolicyDocument, legacy: LegacySettings = {}): Policy {
  const checks = (document.health?.checks ?? []) as CustomCheck[];
  const customTotal = checks.reduce((sum, check) => sum + check.weight, 0);
  return {
    baseline: document.baseline ?? baselineValues(legacy.REPO_BASELINE),
    health: {
      // Unless told otherwise, custom checks count for what their own weights add up to.
      weights: { ...DEFAULT_WEIGHTS, custom: customTotal, ...document.health?.weights },
      checks,
    },
    alerts: {
      staleDays: document.alerts?.stale_days ?? numberOr(legacy.ALERT_STALE_DAYS, 90, 3650),
      healthBelow: document.alerts?.health_below ?? numberOr(legacy.ALERT_HEALTH_BELOW, 40, 100),
      rules: (document.alerts?.rules ?? []) as AlertRule[],
    },
    signals: { scorecard: document.signals?.openssf_scorecard ?? false, vulnerabilities: document.signals?.known_vulnerabilities ?? false },
  };
}

export interface PolicyConfig extends LegacySettings {
  /** The policy document (YAML). */
  POLICY?: string;
}

let cached: { key: string; policy: Policy } | null = null;

/**
 * The policy in force for a configuration. A document that does not parse is
 * ignored (the defaults apply): a typo must not take the dashboard down.
 */
export function resolvePolicy(config: PolicyConfig): Policy {
  const key = [config.POLICY, config.REPO_BASELINE, config.ALERT_STALE_DAYS, config.ALERT_HEALTH_BELOW].join('\u0000');
  if (cached?.key === key) return cached.policy;
  const { document } = parsePolicyDocument(config.POLICY ?? '');
  const policy = buildPolicy(document ?? {}, config);
  cached = { key, policy };
  return policy;
}

/** The settings baseline of a policy, with the label of each setting. */
export function policyBaseline(policy: Policy): Baseline {
  return Object.fromEntries(
    BASELINE_SETTINGS.filter((s) => s.key in policy.baseline).map((s) => [s.key, { expected: policy.baseline[s.key], label: s.label }]),
  );
}

/** The policy as a complete document, every section written out. */
export function serializePolicy(policy: Policy): string {
  return stringify({
    version: 1,
    baseline: policy.baseline,
    health: {
      weights: policy.health.weights,
      checks: policy.health.checks,
    },
    alerts: { stale_days: policy.alerts.staleDays, health_below: policy.alerts.healthBelow, rules: policy.alerts.rules },
    signals: { openssf_scorecard: policy.signals.scorecard, known_vulnerabilities: policy.signals.vulnerabilities },
  });
}

// ── Custom checks ───────────────────────────────────

/** `docs/**\/*.md` style patterns: `*` stays within a path segment, `**` crosses them. */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      // `**/` also matches no directory at all.
      if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
    } else if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

export interface CustomCheckResult {
  id: string;
  /** null = does not apply to this repo. */
  passed: boolean | null;
}

/** Runs the custom checks against a repo's file paths. Pure. */
export function runCustomChecks(checks: CustomCheck[], repo: { paths: string[]; isPrivate: boolean }): CustomCheckResult[] {
  return checks.map((check) => {
    if (check.only && (check.only === 'private') !== repo.isPrivate) return { id: check.id, passed: null };
    const patterns = (check.files ?? check.forbidden ?? []).map(globToRegExp);
    const found = repo.paths.some((path) => patterns.some((pattern) => pattern.test(path)));
    return { id: check.id, passed: check.files ? found : !found };
  });
}
