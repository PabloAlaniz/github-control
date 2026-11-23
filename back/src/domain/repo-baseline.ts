/**
 * Repo settings baseline: the value each GitHub repo setting is expected to
 * have. Pure: no storage or HTTP imports.
 *
 * `BASELINE_SETTINGS` is the catalog of settings the app knows how to check
 * and change (fields of `PATCH /repos/{owner}/{repo}`), with the value used
 * when nothing is configured. The operator's choice is the `REPO_BASELINE`
 * setting: a JSON object `{ setting: expected }` listing only the settings to
 * enforce.
 */
export interface BaselineSetting {
  key: string;
  label: string;
  /** Expected value when no baseline is configured. */
  default: boolean;
}

export const BASELINE_SETTINGS: BaselineSetting[] = [
  { key: 'delete_branch_on_merge', label: 'Delete head branches on merge', default: true },
  { key: 'allow_squash_merge', label: 'Allow squash merging', default: true },
  { key: 'allow_merge_commit', label: 'Allow merge commits', default: false },
  { key: 'allow_rebase_merge', label: 'Allow rebase merging', default: true },
  { key: 'allow_auto_merge', label: 'Allow auto-merge', default: false },
  { key: 'allow_update_branch', label: 'Suggest updating pull request branches', default: true },
  { key: 'has_issues', label: 'Issues', default: true },
  { key: 'has_projects', label: 'Projects', default: false },
  { key: 'has_wiki', label: 'Wiki', default: false },
];

/** Settings enforced when the operator has not chosen any. */
const DEFAULT_KEYS = ['delete_branch_on_merge', 'allow_squash_merge', 'allow_merge_commit', 'allow_update_branch', 'has_wiki'];

export type Baseline = Record<string, { expected: boolean; label: string }>;

export function isBaselineKey(key: string): boolean {
  return BASELINE_SETTINGS.some((setting) => setting.key === key);
}

export function defaultBaselineValues(): Record<string, boolean> {
  return Object.fromEntries(
    BASELINE_SETTINGS.filter((s) => DEFAULT_KEYS.includes(s.key)).map((s) => [s.key, s.default]),
  );
}

/** The configured `{ setting: expected }` map: unknown keys and non-boolean values are dropped. */
export function baselineValues(raw: string | undefined): Record<string, boolean> {
  if (raw === undefined || raw.trim() === '') return defaultBaselineValues();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaultBaselineValues();
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) => isBaselineKey(key) && typeof value === 'boolean'),
    ) as Record<string, boolean>;
  } catch {
    return defaultBaselineValues();
  }
}

/** The baseline to enforce, from the `REPO_BASELINE` setting (or the defaults). */
export function resolveBaseline(raw: string | undefined): Baseline {
  const values = baselineValues(raw);
  return Object.fromEntries(
    BASELINE_SETTINGS.filter((s) => s.key in values).map((s) => [s.key, { expected: values[s.key], label: s.label }]),
  );
}
