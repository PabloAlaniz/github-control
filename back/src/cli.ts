/**
 * Command line tools for a self-hosted instance (Node only).
 *
 *   node dist/cli.mjs migrate
 *   node dist/cli.mjs storage copy --from <target> --to <target>
 *   node dist/cli.mjs storage export --out backup.json [--from <target>]
 *   node dist/cli.mjs storage import --in backup.json [--to <target>] [--rebase-dates true]
 *
 * A <target> is `current` (the instance's configured storage, the default),
 * or `<driver>:<location>`:
 *   sqlite:./data/github-control.db     json:./data/storage     csv:./data/storage
 *   postgres:postgresql://user:pass@host/db
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig, StorageDriver } from './config';
import type { Storage } from './application/ports/storage';
import { createStorage } from './infrastructure/storage';
import { COLLECTIONS, columnType, type CollectionName } from './infrastructure/storage/schema';
import './infrastructure/storage/node';
import { loadConfigFile, resolveConfig } from './node/config-store';

const USAGE = `Usage:
  migrate                                        Apply pending schema migrations (sqlite, postgres)
  storage copy --from <target> --to <target>     Copy all data from one storage to another
  storage export --out <file> [--from <target>]  Write all data to a JSON file
  storage import --in <file> [--to <target>]     Replace all data with a JSON file
      [--rebase-dates true]                      ...shifting its dates so the export date becomes today (demo data)

<target>: current | sqlite:<file> | json:<dir> | csv:<dir> | postgres:<url>`;

const DRIVERS: StorageDriver[] = ['sqlite', 'json', 'csv', 'postgres'];

export interface CliIo {
  env: Record<string, string | undefined>;
  log: (message: string) => void;
}

function currentConfig(io: CliIo): AppConfig {
  const dataDir = resolve(io.env.DATA_DIR || './data');
  return resolveConfig(io.env, loadConfigFile(dataDir), dataDir).config;
}

/** Turns a target (`current`, `sqlite:./x.db`, ...) into a storage. */
export function openTarget(target: string, io: CliIo): { storage: Storage; label: string } {
  if (target === 'current') {
    const config = currentConfig(io);
    return { storage: createStorage(config), label: `current (${config.STORAGE_DRIVER})` };
  }
  const separator = target.indexOf(':');
  const driver = target.slice(0, separator) as StorageDriver;
  const location = target.slice(separator + 1);
  if (separator < 1 || !DRIVERS.includes(driver) || !location) {
    throw new Error(`Invalid storage target "${target}". Expected: current | sqlite:<file> | json:<dir> | csv:<dir> | postgres:<url>`);
  }
  const config = (driver === 'postgres'
    ? { STORAGE_DRIVER: driver, DATABASE_URL: location }
    : { STORAGE_DRIVER: driver, STORAGE_PATH: resolve(location) }) as AppConfig;
  return { storage: createStorage(config), label: driver === 'postgres' ? 'postgres' : `${driver}:${resolve(location)}` };
}

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`Unexpected argument "${args[i]}"`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    out[args[i].slice(2)] = value;
    i++;
  }
  return out;
}

function countRecords(dump: Record<string, unknown[]>): string {
  const total = Object.values(dump).reduce((sum, rows) => sum + rows.length, 0);
  const parts = Object.entries(dump).filter(([, rows]) => rows.length > 0).map(([name, rows]) => `${name}: ${rows.length}`);
  return `${total} records${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/** Shifts every date and timestamp by whole days so that `exportedAt` lands on today. */
export function rebaseDates(data: Record<string, Record<string, unknown>[]>, exportedAt: string, now = new Date()): void {
  const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.round((utcDay(now) - utcDay(new Date(exportedAt))) / 86_400_000);
  if (!Number.isFinite(days) || days === 0) return;
  for (const [collection, rows] of Object.entries(data)) {
    if (!(collection in COLLECTIONS)) continue;
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== 'string') continue;
        const type = columnType(collection as CollectionName, column);
        if (type !== 'timestamp' && type !== 'date') continue;
        const shifted = new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
        row[column] = type === 'date' ? shifted.slice(0, 10) : shifted;
      }
    }
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<void> {
  const [command, sub, ...rest] = argv;

  if (command === 'migrate') {
    const { storage, label } = openTarget('current', io);
    // The SQL drivers migrate on first use; any read triggers it.
    await storage.repos.getCacheStatus();
    io.log(`Schema is up to date: ${label}`);
    return;
  }

  if (command === 'storage' && sub === 'copy') {
    const { from, to } = flags(rest);
    if (!from || !to) throw new Error('storage copy needs --from and --to');
    if (from === to) throw new Error('--from and --to are the same storage');
    const source = openTarget(from, io);
    const destination = openTarget(to, io);
    const dump = await source.storage.admin.exportAll();
    await destination.storage.admin.importAll(dump);
    io.log(`Copied ${countRecords(dump)}`);
    io.log(`  from ${source.label}`);
    io.log(`  to   ${destination.label}`);
    io.log('To use the new storage, set STORAGE_DRIVER (and STORAGE_PATH or DATABASE_URL) and restart.');
    return;
  }

  if (command === 'storage' && sub === 'export') {
    const { out, from = 'current' } = flags(rest);
    if (!out) throw new Error('storage export needs --out <file>');
    const source = openTarget(from, io);
    const dump = await source.storage.admin.exportAll();
    writeFileSync(resolve(out), `${JSON.stringify({ version: 1, exported_at: new Date().toISOString(), data: dump }, null, 2)}\n`, { mode: 0o600 });
    io.log(`Exported ${countRecords(dump)} from ${source.label} to ${resolve(out)}`);
    return;
  }

  if (command === 'storage' && sub === 'import') {
    const { in: input, to = 'current', 'rebase-dates': rebase } = flags(rest);
    if (!input) throw new Error('storage import needs --in <file>');
    const file = JSON.parse(readFileSync(resolve(input), 'utf8'));
    if (file?.version !== 1 || typeof file.data !== 'object' || file.data === null) {
      throw new Error(`${input} is not a GitHub Control export`);
    }
    if (rebase === 'true') rebaseDates(file.data, file.exported_at);
    const destination = openTarget(to, io);
    await destination.storage.admin.importAll(file.data);
    io.log(`Imported ${countRecords(file.data)} into ${destination.label}`);
    return;
  }

  throw new Error(command ? `Unknown command "${[command, sub].filter(Boolean).join(' ')}"\n\n${USAGE}` : USAGE);
}
