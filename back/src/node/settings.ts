/**
 * Runtime-editable settings for the Node server. Changes are written to
 * `<dataDir>/config.json` and applied to the live configuration object in
 * place, so nothing has to restart. A setting given by an environment
 * variable is locked: the environment always wins.
 */
import type { AppConfig } from '../config';
import {
  SettingsError, type SettingName, type SettingsPatch, type SettingsStore, type SettingsView,
} from '../application/ports/settings';
import { configuredOrgs } from '../lib/github/repos';
import { BASELINE_SETTINGS, baselineValues, isBaselineKey } from '../domain/repo-baseline';
import { parsePolicyDocument, resolvePolicy } from '../domain/policy';
import { constantTimeEqual, hashPassword, verifyPassword } from '../lib/password';
import { saveConfigFile, type ConfigValues } from './config-store';

const DEFAULT_SYNC_INTERVAL_HOURS = 24;

/** Environment variables that, when set, lock a setting. */
const ENV_KEYS: Record<SettingName, string[]> = {
  githubToken: ['GITHUB_TOKEN'],
  githubOrgs: ['GITHUB_ORGS'],
  syncIntervalHours: ['SYNC_INTERVAL_HOURS'],
  publicBadges: ['PUBLIC_BADGES'],
  publicStatus: ['PUBLIC_STATUS'],
  repoBaseline: ['REPO_BASELINE'],
  policy: ['POLICY', 'POLICY_FILE'],
  password: ['AUTH_PASSWORD', 'AUTH_PASSWORD_HASH', 'DISABLE_AUTH'],
};

/** The catalog of repo settings with the value the configured baseline expects of each. */
export function baselineOptions(raw: string | undefined) {
  const values = baselineValues(raw);
  return BASELINE_SETTINGS.map(({ key, label }) => ({ key, label, expected: key in values ? values[key] : null }));
}

export interface SettingsDeps {
  env: Record<string, string | undefined>;
  dataDir: string;
  /** The live configuration; updated in place. */
  config: AppConfig;
  verifyGithubToken: (token: string) => Promise<string>;
}

export function createSettingsStore({ env, dataDir, config, verifyGithubToken }: SettingsDeps): SettingsStore {
  const lockedByEnv = (Object.keys(ENV_KEYS) as SettingName[])
    .filter((name) => ENV_KEYS[name].some((key) => !!env[key]?.trim()));
  /** A policy that sets the baseline takes it out of the settings form. */
  const policySetsBaseline = () => !!parsePolicyDocument(config.POLICY ?? '').document?.baseline;
  const lockedNow = (): SettingName[] => (
    policySetsBaseline() && !lockedByEnv.includes('repoBaseline') ? [...lockedByEnv, 'repoBaseline'] : lockedByEnv
  );

  const read = (): SettingsView => ({
    storageDriver: config.STORAGE_DRIVER ?? 'postgres',
    username: config.AUTH_USERNAME ?? null,
    githubTokenSet: !!config.GITHUB_TOKEN,
    githubOrgs: configuredOrgs(config),
    syncIntervalHours: Number(config.SYNC_INTERVAL_HOURS ?? DEFAULT_SYNC_INTERVAL_HOURS),
    publicBadges: config.PUBLIC_BADGES === 'true',
    publicStatus: config.PUBLIC_STATUS === 'true',
    repoBaseline: baselineOptions(JSON.stringify(resolvePolicy(config).baseline)),
    locked: lockedNow(),
  });

  return {
    read,

    async update(patch: SettingsPatch) {
      const requested = (Object.keys(patch) as SettingName[]).filter((name) => patch[name] !== undefined);
      const locked = lockedNow();
      const blocked = requested.filter((name) => locked.includes(name));
      if (blocked.length > 0) {
        throw new SettingsError(`Set by an environment variable or by the policy, and cannot be changed here: ${blocked.join(', ')}`);
      }

      const values: ConfigValues = {};

      if (patch.githubToken !== undefined) {
        try {
          await verifyGithubToken(patch.githubToken);
        } catch (error: any) {
          throw new SettingsError(`GitHub rejected the token: ${error.message}`);
        }
        values.GITHUB_TOKEN = patch.githubToken;
      }
      if (patch.githubOrgs !== undefined) values.GITHUB_ORGS = patch.githubOrgs.join(',');
      if (patch.syncIntervalHours !== undefined) values.SYNC_INTERVAL_HOURS = String(patch.syncIntervalHours);
      if (patch.publicBadges !== undefined) values.PUBLIC_BADGES = String(patch.publicBadges);
      if (patch.publicStatus !== undefined) values.PUBLIC_STATUS = String(patch.publicStatus);
      if (patch.repoBaseline !== undefined) {
        const unknown = Object.keys(patch.repoBaseline).filter((key) => !isBaselineKey(key));
        if (unknown.length > 0) throw new SettingsError(`Not a repo setting the baseline can enforce: ${unknown.join(', ')}`);
        // Stored even when empty: '{}' means "enforce nothing", unlike an unset value (the defaults).
        values.REPO_BASELINE = JSON.stringify(patch.repoBaseline);
      }

      if (patch.policy !== undefined) {
        const { errors } = parsePolicyDocument(patch.policy);
        if (errors.length > 0) throw new SettingsError(`Not a valid policy: ${errors.join('; ')}`);
        values.POLICY = patch.policy.trim() ? patch.policy : '';
        config.POLICY_SOURCE = patch.policy.trim() ? 'saved' : 'default';
      }

      if (patch.password !== undefined) {
        const currentOk = config.AUTH_PASSWORD_HASH
          ? await verifyPassword(patch.password.current, config.AUTH_PASSWORD_HASH)
          : !!config.AUTH_PASSWORD && constantTimeEqual(patch.password.current, config.AUTH_PASSWORD);
        if (!currentOk) throw new SettingsError('The current password is not correct');
        values.AUTH_PASSWORD_HASH = await hashPassword(patch.password.next);
      }

      if (Object.keys(values).length > 0) {
        saveConfigFile(dataDir, values);
        Object.assign(config, values);
        // An empty value means "unset" (e.g. no organizations).
        for (const [key, value] of Object.entries(values)) {
          if (value === '') delete (config as Record<string, unknown>)[key];
        }
      }
      return read();
    },
  };
}
