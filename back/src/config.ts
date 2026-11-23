import type { SettingsStore } from './application/ports/settings';

/**
 * Runtime configuration, independent of where it comes from.
 *
 * On Cloudflare Workers this is the bindings object (vars + secrets). The
 * Node entrypoint will build the same shape from env vars, a config file or
 * the first-run wizard. Nothing below the composition root should read
 * `process.env` or care about the source.
 */
export type StorageDriver = 'postgres' | 'sqlite' | 'json' | 'csv' | 'memory';

export type AppConfig = {
  /** Which storage adapter to use. Defaults to 'postgres'. */
  STORAGE_DRIVER?: StorageDriver;
  /** Connection string for SQL drivers. */
  DATABASE_URL: string;
  /** Directory for the file drivers (json, csv) or database file for sqlite. Node only. */
  STORAGE_PATH?: string;
  GITHUB_TOKEN: string;
  /** Comma-separated organizations to sync in addition to the user's own repos. */
  GITHUB_ORGS?: string;
  CI_COVERAGE_TOKEN?: string;
  API_KEY: string;
  ENVIRONMENT: string;
  AUTH_USERNAME: string;
  /** Plain-text password (legacy / env-var setups). Prefer AUTH_PASSWORD_HASH. */
  AUTH_PASSWORD?: string;
  /** Password hash produced by lib/password (what the setup wizard stores). */
  AUTH_PASSWORD_HASH?: string;
  JWT_SECRET: string;
  /** 'true' skips auth entirely (local development only). */
  DISABLE_AUTH?: string | boolean;
  ANTHROPIC_API_KEY?: string;
  /** 'true' serves unauthenticated SVG badges for public repos at /api/badges. Off by default. */
  PUBLIC_BADGES?: string;
  /** 'true' serves the unauthenticated status page of the registered services (/status, /api/status). Off by default. */
  PUBLIC_STATUS?: string;
  /** Present when settings can be changed at runtime (Node server). Not a stored value. */
  settings?: SettingsStore;
  /** JSON object `{ setting: expected }`: the repo settings baseline. Unset uses the defaults. */
  REPO_BASELINE?: string;
  /** Hours between automatic full syncs on the Node server. '0' disables. Default 24. */
  SYNC_INTERVAL_HOURS?: string;
  /** Minutes between scheduled service checks on the Node server. Default 15. */
  SERVICE_CHECK_MINUTES?: string;
  /** Days without commits after which a high or medium priority repo raises an alert. '0' turns it off. Default 90. */
  ALERT_STALE_DAYS?: string;
  /** Health score under which a repo raises an alert. '0' turns it off. Default 40. */
  ALERT_HEALTH_BELOW?: string;
  /** Who "me" is in the inbox, instead of asking GitHub. Set by demo mode. */
  VIEWER_LOGIN?: string;
  /** Set by the Node server's demo mode: 'true' (local edits allowed) or 'readonly'. See node/demo.ts. */
  DEMO?: 'true' | 'readonly';
  /** Minutes between reloads of the demo dataset ('0' never reloads). */
  DEMO_RESET_MINUTES?: string;
};
