/**
 * Settings an operator can change while the app runs. Provided by runtimes
 * that own their configuration (the Node server); absent where configuration
 * is fixed at deploy time (Cloudflare Workers).
 */
export type SettingName = 'githubToken' | 'githubOrgs' | 'syncIntervalHours' | 'publicBadges' | 'publicStatus' | 'repoBaseline' | 'policy' | 'password';

/** One repo setting the baseline can enforce. `expected` is null when it is not enforced. */
export interface BaselineOption {
  key: string;
  label: string;
  expected: boolean | null;
}

export interface SettingsView {
  storageDriver: string;
  username: string | null;
  githubTokenSet: boolean;
  githubOrgs: string[];
  syncIntervalHours: number;
  publicBadges: boolean;
  publicStatus: boolean;
  /** Every repo setting the app can check, with the value expected of it (if any). */
  repoBaseline: BaselineOption[];
  /** Settings fixed by an environment variable: shown, but not editable. */
  locked: SettingName[];
}

export interface SettingsPatch {
  githubToken?: string;
  githubOrgs?: string[];
  syncIntervalHours?: number;
  publicBadges?: boolean;
  publicStatus?: boolean;
  /** `{ setting: expected }` for the settings to enforce; settings left out are not checked. */
  repoBaseline?: Record<string, boolean>;
  /** The policy document (YAML), already validated. Empty removes it. */
  policy?: string;
  password?: { current: string; next: string };
}

/** Thrown for a change the caller can fix (wrong password, locked setting, bad token). */
export class SettingsError extends Error {}

export interface SettingsStore {
  read(): SettingsView;
  /** Validates and applies the changes, persists them, and returns the new view. */
  update(patch: SettingsPatch): Promise<SettingsView>;
}
