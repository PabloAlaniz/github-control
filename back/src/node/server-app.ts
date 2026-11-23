/**
 * Node composition root: decides, per request, whether the instance is
 * configured (main app) or still needs the first-run wizard (setup app), and
 * serves the built frontend. Kept free of `listen()` so it can be tested.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import app from '../index';
import '../infrastructure/storage/node';
import type { AppConfig } from '../config';
import { randomSecret } from '../lib/password';
import {
  ensureSecrets, loadConfigFile, mergeValues, resolveConfig, saveConfigFile,
} from './config-store';
import { createSetupApp, verifyGithubToken } from './setup-app';
import { createSettingsStore } from './settings';
import { demoConfig, demoMode, demoResetMinutes, loadDemoData, readDemoData } from './demo';
import { CLIENT_IP_HEADER } from '../routes/auth';
import { createStorage } from '../infrastructure/storage';
import { getSyncStatus, isSyncDue, startFullSync } from '../services/full-sync.service';
import { runScheduledChecks } from '../services/service-check.service';
import { evaluateAlerts, sendDueDigests } from '../services/alert.service';
import { sqliteAvailable } from '../infrastructure/storage/sql/sqlite-client';

const DEFAULT_SYNC_INTERVAL_HOURS = 24;
/** How often the server checks whether a sync is due. */
const SYNC_CHECK_MINUTES = 10;
/** How often the server health-checks the registered services, unless SERVICE_CHECK_MINUTES says otherwise. */
const DEFAULT_SERVICE_CHECK_MINUTES = 15;

/** Minutes between service checks: a whole number from 1 minute to a day. */
export function serviceCheckMinutes(raw: string | undefined): number {
  const value = Number(raw?.trim() || DEFAULT_SERVICE_CHECK_MINUTES);
  return Number.isInteger(value) && value >= 1 && value <= 1440 ? value : DEFAULT_SERVICE_CHECK_MINUTES;
}

export interface ServerOptions {
  env: Record<string, string | undefined>;
  /** Holds config.json and, for the file drivers, the data itself. */
  dataDir: string;
  /** Built frontend (front/dist). Optional: the API works without it. */
  staticDir?: string;
  verifyGithubToken?: (token: string) => Promise<string>;
  /** Run full syncs on a schedule (and right after setup). Off unless asked for. */
  autoSync?: boolean;
  /** The dataset served when `DEMO` is set (docs/demo/demo-data.json). */
  demoDataPath?: string;
  log?: (message: string) => void;
}

export function createServerApp(options: ServerOptions) {
  const log = options.log ?? console.log;

  const demo = demoMode(options.env);
  return demo ? createDemoApp(options, demo, log) : createConfiguredApp(options, log);
}

/** Demo mode: fictional data in memory. Reads no configuration and writes nothing to disk. */
function createDemoApp(options: ServerOptions, mode: 'true' | 'readonly', log: (message: string) => void) {
  const { env } = options;
  if (!options.demoDataPath) throw new Error('Demo mode needs the demo dataset: set DEMO_DATA to its path.');
  const file = readDemoData(options.demoDataPath);
  const resetMinutes = demoResetMinutes(env);
  const config = demoConfig(mode, resetMinutes);
  const storage = createStorage(config);

  // The alerts are derived from the dataset by the real rules; a demo has no channels to tell.
  const load = () => loadDemoData(storage, file).then(() => evaluateAlerts({ config, storage }, { notify: false }));
  let ready: Promise<unknown> = load();
  if (resetMinutes > 0) {
    setInterval(() => {
      ready = load().catch((error) => log(`Demo reset failed: ${error.message}`));
    }, resetMinutes * 60_000).unref();
  }
  log(`Demo mode (${mode === 'readonly' ? 'read-only' : 'editable'}): fictional data in memory, `
    + (resetMinutes > 0 ? `reloaded every ${resetMinutes} minutes.` : 'never reloaded.'));

  return withFrontend(options, async (request) => {
    await ready;
    return app.fetch(request, config);
  });
}

function createConfiguredApp(options: ServerOptions, log: (message: string) => void) {
  const { env, dataDir } = options;

  let config: AppConfig | null = null;
  let setupApp: Hono | null = null;

  const load = () => {
    const resolved = resolveConfig(env, loadConfigFile(dataDir), dataDir);
    if (resolved.missing.length > 0) return resolved;
    ensureSecrets(env, dataDir);
    config = resolveConfig(env, loadConfigFile(dataDir), dataDir).config;
    config.settings = createSettingsStore({
      env, dataDir, config, verifyGithubToken: options.verifyGithubToken ?? verifyGithubToken,
    });
    setupApp = null;
    return resolved;
  };

  /** Starts a full sync when the data is older than the configured interval. */
  const syncIfDue = async (trigger: string) => {
    if (!options.autoSync || !config) return;
    try {
      const ctx = { config, storage: createStorage(config) };
      const intervalHours = Number(config.SYNC_INTERVAL_HOURS ?? DEFAULT_SYNC_INTERVAL_HOURS);
      const { latest } = await ctx.storage.repos.getCacheStatus();
      if (!isSyncDue(latest, intervalHours) || getSyncStatus(ctx).running) return;
      log(`Starting ${trigger} sync...`);
      const summary = await startFullSync(ctx, { trigger }).finished;
      log(summary.error
        ? `Sync failed: ${summary.error}`
        : `Sync finished: ${summary.repos.synced}/${summary.repos.total} repos, ${summary.repos.failed} failed.`);
    } catch (error: any) {
      log(`Sync check failed: ${error.message}`);
    }
  };

  /** Health-checks every active service and records the result in the uptime history. */
  const checkServices = async () => {
    if (!options.autoSync || !config) return;
    try {
      const ctx = { config, storage: createStorage(config) };
      await runScheduledChecks(ctx);
      await sendDueDigests(ctx);
    } catch (error: any) {
      log(`Service checks failed: ${error.message}`);
    }
  };

  const { missing } = load();
  if (config) {
    log(`Storage: ${(config as AppConfig).STORAGE_DRIVER}`);
  } else {
    const setupCode = randomSecret(9);
    const provided = mergeValues(env, loadConfigFile(dataDir));

    setupApp = createSetupApp({
      setupCode,
      provided,
      verifyGithubToken: options.verifyGithubToken ?? verifyGithubToken,
      sqliteAvailable: sqliteAvailable(),
      complete(values) {
        saveConfigFile(dataDir, values);
        load();
        log('Setup complete.');
        void syncIfDue('setup');
      },
    });
    log(`Setup required (missing: ${missing.join(', ')}).`);
    log(`Open the app in a browser and enter this setup code: ${setupCode}`);
  }

  if (options.autoSync) {
    void syncIfDue('schedule');
    setInterval(() => void syncIfDue('schedule'), SYNC_CHECK_MINUTES * 60_000).unref();
    const checkMinutes = serviceCheckMinutes(mergeValues(env, loadConfigFile(dataDir)).SERVICE_CHECK_MINUTES);
    setInterval(() => void checkServices(), checkMinutes * 60_000).unref();
  }

  return withFrontend(options, (request) => (config ? app.fetch(request, config) : setupApp!.fetch(request)));
}

/** Routes `/api/*` to `api` and serves the built frontend for everything else. */
function withFrontend(options: ServerOptions, api: (request: Request) => Response | Promise<Response>) {
  const { env, staticDir } = options;
  const root = new Hono();

  root.all('/api/*', (c) => {
    // Identify the client by its socket address (or the proxy's word for it when
    // TRUST_PROXY is on); whatever the client sent in that header is discarded.
    const headers = new Headers(c.req.raw.headers);
    const socketAddress = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
      ?.incoming?.socket?.remoteAddress;
    const forwarded = env.TRUST_PROXY === 'true' ? headers.get('x-forwarded-for')?.split(',')[0].trim() : undefined;
    headers.set(CLIENT_IP_HEADER, forwarded || socketAddress || 'local');
    headers.delete('cf-connecting-ip');
    const request = new Request(c.req.raw, { headers });

    return api(request);
  });

  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    const indexHtml = readFileSync(join(staticDir, 'index.html'), 'utf8');
    root.use('*', serveStatic({ root: staticDir }));
    root.get('*', (c) => c.html(indexHtml)); // SPA fallback
  } else {
    root.get('*', (c) => c.json({ message: 'API only: the frontend build was not found', staticDir }, 404));
  }

  return root;
}
