/**
 * Where the Node server gets its configuration.
 *
 * Precedence, per setting: environment variable, then `<dataDir>/config.json`
 * (written by the first-run wizard). Environment variables are optional: with
 * none set, the server starts in setup mode and the wizard writes the file.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config';
import { randomSecret } from '../lib/password';

export const CONFIG_FILE = 'config.json';

/** Settings that may come from the environment or from the config file. */
const KEYS = [
  'STORAGE_DRIVER', 'DATABASE_URL', 'STORAGE_PATH',
  'GITHUB_TOKEN', 'GITHUB_ORGS',
  'AUTH_USERNAME', 'AUTH_PASSWORD', 'AUTH_PASSWORD_HASH', 'DISABLE_AUTH',
  'JWT_SECRET', 'API_KEY', 'CI_COVERAGE_TOKEN', 'ANTHROPIC_API_KEY', 'ENVIRONMENT',
  'SYNC_INTERVAL_HOURS', 'PUBLIC_BADGES', 'REPO_BASELINE',
  'SERVICE_CHECK_MINUTES', 'ALERT_STALE_DAYS', 'ALERT_HEALTH_BELOW',
] as const;

export type ConfigValues = Partial<Record<(typeof KEYS)[number], string>>;

export function loadConfigFile(dataDir: string): ConfigValues {
  const path = join(dataDir, CONFIG_FILE);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as ConfigValues;
}

/** Merges `values` into the config file. Owner-only permissions: it holds secrets. */
export function saveConfigFile(dataDir: string, values: ConfigValues): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, CONFIG_FILE);
  const merged = { ...loadConfigFile(dataDir), ...values };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

export interface ResolvedConfig {
  config: AppConfig;
  /** Settings still needed before the app can run. Empty means configured. */
  missing: string[];
}

/** Known settings, taking each from the environment first and the file second. */
export function mergeValues(env: Record<string, string | undefined>, file: ConfigValues): ConfigValues {
  const values: ConfigValues = {};
  for (const key of KEYS) {
    const value = env[key]?.trim() || file[key];
    if (value) values[key] = value;
  }
  return values;
}

export function resolveConfig(
  env: Record<string, string | undefined>,
  file: ConfigValues,
  dataDir: string,
): ResolvedConfig {
  const values = mergeValues(env, file);

  const driver = values.STORAGE_DRIVER || (values.DATABASE_URL ? 'postgres' : 'json');
  const usesFiles = driver === 'json' || driver === 'csv';

  const missing: string[] = [];
  if (!values.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (values.DISABLE_AUTH !== 'true') {
    if (!values.AUTH_USERNAME) missing.push('AUTH_USERNAME');
    if (!values.AUTH_PASSWORD && !values.AUTH_PASSWORD_HASH) missing.push('AUTH_PASSWORD');
  }
  if (driver === 'postgres' && !values.DATABASE_URL) missing.push('DATABASE_URL');

  const defaultPath = driver === 'sqlite' ? join(dataDir, 'github-control.db') : join(dataDir, 'storage');
  const config = {
    ENVIRONMENT: 'production',
    ...values,
    STORAGE_DRIVER: driver,
    ...((usesFiles || driver === 'sqlite') && { STORAGE_PATH: values.STORAGE_PATH || defaultPath }),
  } as AppConfig;

  return { config, missing };
}

/**
 * Generates the signing secret and the API key when nobody provided them,
 * and stores them so sessions and API clients survive a restart.
 */
export function ensureSecrets(
  env: Record<string, string | undefined>,
  dataDir: string,
): void {
  const file = loadConfigFile(dataDir);
  const generated: ConfigValues = {};
  if (!env.JWT_SECRET && !file.JWT_SECRET) generated.JWT_SECRET = randomSecret();
  if (!env.API_KEY && !file.API_KEY) generated.API_KEY = randomSecret();
  if (Object.keys(generated).length > 0) saveConfigFile(dataDir, generated);
}
