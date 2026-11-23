import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openTarget, rebaseDates, runCli } from '@back/cli';
import { json, populateEverything } from '../contract/storage-contract';

const root = mkdtempSync(join(tmpdir(), 'ghc-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;
const tempDir = () => join(root, `d${counter++}`);

function cli(env: Record<string, string> = {}) {
  const lines: string[] = [];
  const io = { env, log: (m: string) => lines.push(m) };
  return { io, lines, run: (...argv: string[]) => runCli(argv, io) };
}

describe('cli: storage copy', () => {
  it('copies a JSON storage into a new SQLite database', async () => {
    const jsonDir = tempDir();
    const dbFile = join(tempDir(), 'app.db');
    const { io, lines, run } = cli();
    const source = openTarget(`json:${jsonDir}`, io).storage;
    await populateEverything(source);

    await run('storage', 'copy', '--from', `json:${jsonDir}`, '--to', `sqlite:${dbFile}`);

    expect(lines[0]).toMatch(/^Copied 15 records \(repos: 2, groups: 1, repo_groups: 1, services: 1, repo_apps: 1/);
    expect(lines.join('\n')).toContain('set STORAGE_DRIVER');
    const copy = openTarget(`sqlite:${dbFile}`, io).storage;
    expect(json(await copy.admin.exportAll())).toEqual(json(await source.admin.exportAll()));
    expect((await copy.repos.getRepo('acme/plain'))!.groups).toEqual(['web']);
  });

  it('rejects bad targets and missing flags', async () => {
    const { run } = cli();
    await expect(run('storage', 'copy', '--from', 'json:/tmp/x')).rejects.toThrow('needs --from and --to');
    await expect(run('storage', 'copy', '--from', 'mongo:x', '--to', 'json:/tmp/x')).rejects.toThrow('Invalid storage target');
    await expect(run('storage', 'copy', '--from', 'sqlite:', '--to', 'json:/tmp/x')).rejects.toThrow('Invalid storage target');
    await expect(run('storage', 'copy', '--from', 'json:/tmp/x', '--to', 'json:/tmp/x')).rejects.toThrow('same storage');
    await expect(run('storage', 'copy', '--from')).rejects.toThrow('Missing value for --from');
    await expect(run('storage', 'copy', 'oops')).rejects.toThrow('Unexpected argument');
  });
});

describe('cli: storage export / import', () => {
  it('writes a backup file and restores it into another storage', async () => {
    const dataDir = tempDir();
    const backup = join(root, 'backup.json');
    // "current" = the instance configured through DATA_DIR (defaults to JSON files).
    const { io, lines, run } = cli({ DATA_DIR: dataDir, GITHUB_TOKEN: 'x', DISABLE_AUTH: 'true' });
    const current = openTarget('current', io).storage;
    await populateEverything(current);

    await run('storage', 'export', '--out', backup);
    expect(lines[0]).toMatch(/^Exported 15 records .* from current \(json\) to /);

    const file = JSON.parse(readFileSync(backup, 'utf8'));
    expect(file.version).toBe(1);
    expect(file.data.repos).toHaveLength(2);

    const restoredDir = tempDir();
    await run('storage', 'import', '--in', backup, '--to', `csv:${restoredDir}`);
    expect(lines.at(-1)).toMatch(/^Imported 15 records .* into csv:/);
    const restored = openTarget(`csv:${restoredDir}`, io).storage;
    expect(json(await restored.admin.exportAll())).toEqual(json(await current.admin.exportAll()));
  });

  it('refuses files that are not exports', async () => {
    const dir = tempDir();
    const { io, run } = cli();
    openTarget(`json:${dir}`, io);
    const bogus = join(dir, 'bogus.json');
    writeFileSync(bogus, JSON.stringify({ hello: 'world' }));
    await expect(run('storage', 'import', '--in', bogus, '--to', `json:${dir}`)).rejects.toThrow('not a GitHub Control export');
    await expect(run('storage', 'export')).rejects.toThrow('needs --out');
    await expect(run('storage', 'import')).rejects.toThrow('needs --in');
  });
});

describe('cli: rebasing dates', () => {
  it('moves every date forward by the age of the export', () => {
    const data = {
      repos: [{ full_name: 'a/b', last_commit_at: '2026-01-10T08:00:00.000Z', description: '2026-01-10', stars: 3 }],
      repo_metrics_history: [{ snapshot_date: '2026-01-09', created_at: '2026-01-09T00:00:00.000Z' }],
      unknown_collection: [{ created_at: '2026-01-01T00:00:00.000Z' }],
    };
    rebaseDates(data, '2026-01-10T12:00:00.000Z', new Date('2026-01-20T12:00:00.000Z'));

    expect(data.repos[0]).toEqual({
      full_name: 'a/b', last_commit_at: '2026-01-20T08:00:00.000Z', description: '2026-01-10', stars: 3,
    });
    expect(data.repo_metrics_history[0]).toEqual({ snapshot_date: '2026-01-19', created_at: '2026-01-19T00:00:00.000Z' });
    expect(data.unknown_collection[0].created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('imports the bundled demo data', async () => {
    const dir = tempDir();
    const { io, run } = cli();
    await run('storage', 'import', '--in', join(__dirname, '../../../docs/demo/demo-data.json'), '--to', `json:${dir}`, '--rebase-dates', 'true');
    const storage = openTarget(`json:${dir}`, io).storage;
    expect((await storage.repos.getStats()).total).toBeGreaterThan(5);
    expect(await storage.metrics.getLatestSnapshotDate()).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('cli: migrate and usage', () => {
  it('creates the schema of the configured SQLite database', async () => {
    const dataDir = tempDir();
    const { io, lines, run } = cli({ DATA_DIR: dataDir, STORAGE_DRIVER: 'sqlite', GITHUB_TOKEN: 'x', DISABLE_AUTH: 'true' });
    await run('migrate');
    expect(lines).toEqual(['Schema is up to date: current (sqlite)']);
    expect(existsSync(join(dataDir, 'github-control.db'))).toBe(true);
    expect(await openTarget('current', io).storage.repos.getStats()).toMatchObject({ total: 0 });
  });

  it('prints usage for unknown or missing commands', async () => {
    const { run } = cli();
    await expect(run()).rejects.toThrow(/^Usage:/);
    await expect(run('storage', 'explode')).rejects.toThrow(/Unknown command "storage explode"/);
  });
});
