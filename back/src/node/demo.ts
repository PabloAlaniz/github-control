/**
 * Demo mode for the Node server (`DEMO=true`): a bundled fictional dataset
 * served from memory, with no GitHub token, no sign-in and nothing written to
 * disk. The data is reloaded on a timer, so whatever a visitor changes goes
 * away and the dates always end today.
 *
 *   DEMO=true       visitors can edit local data (notes, groups, priorities...)
 *   DEMO=readonly   nothing can be changed; meant for a public instance
 */
import { readFileSync } from 'node:fs';
import type { AppConfig } from '../config';
import type { Storage } from '../application/ports/storage';
import { rebaseDates } from '../infrastructure/storage/rebase-dates';
import { randomSecret } from '../lib/password';

export type DemoMode = 'true' | 'readonly';

export const DEFAULT_DEMO_RESET_MINUTES = 60;

export function demoMode(env: Record<string, string | undefined>): DemoMode | null {
  const value = env.DEMO?.trim().toLowerCase();
  return value === 'true' || value === 'readonly' ? value : null;
}

/** Minutes between reloads of the dataset. `0` never reloads. */
export function demoResetMinutes(env: Record<string, string | undefined>): number {
  const value = Number(env.DEMO_RESET_MINUTES?.trim() || DEFAULT_DEMO_RESET_MINUTES);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DEMO_RESET_MINUTES;
}

/** A complete configuration that needs nothing from the environment or the data directory. */
export function demoConfig(mode: DemoMode, resetMinutes: number): AppConfig {
  return {
    ENVIRONMENT: 'demo',
    STORAGE_DRIVER: 'memory',
    DATABASE_URL: '',
    GITHUB_TOKEN: 'demo',
    AUTH_USERNAME: 'demo',
    DISABLE_AUTH: 'true',
    // Never shown or stored: sign-in is off, these only keep the app's invariants.
    API_KEY: randomSecret(),
    JWT_SECRET: randomSecret(),
    SYNC_INTERVAL_HOURS: '0',
    VIEWER_LOGIN: 'alice',
    // The public surfaces are part of what the demo shows.
    PUBLIC_BADGES: 'true',
    PUBLIC_STATUS: 'true',
    DEMO: mode,
    DEMO_RESET_MINUTES: String(resetMinutes),
  };
}

interface ExportFile {
  version: number;
  exported_at: string;
  data: Record<string, Record<string, unknown>[]>;
}

export function readDemoData(path: string): ExportFile {
  let file: ExportFile;
  try {
    file = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error: any) {
    throw new Error(`Demo mode needs the demo dataset, but ${path} could not be read (${error.message}). Set DEMO_DATA to its path.`);
  }
  if (file?.version !== 1 || typeof file.data !== 'object' || file.data === null) {
    throw new Error(`${path} is not a GitHub Control export`);
  }
  return file;
}

/** Replaces everything in `storage` with a fresh copy of the dataset, its dates moved to end today. */
export async function loadDemoData(storage: Storage, file: ExportFile, now = new Date()): Promise<void> {
  const data = structuredClone(file.data);
  rebaseDates(data, file.exported_at, now);
  await storage.admin.importAll(data);
}
