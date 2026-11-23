/**
 * Full sync: refresh the repo list from GitHub, then bring every active repo
 * up to date (health, code metrics, daily snapshot, monorepo apps, CI status,
 * traffic, signals).
 *
 * It goes through the storage ports only, so it works on any storage driver.
 * One sync runs at a time per process; callers get the run in progress.
 */
import type { AppContext } from '../application/context';
import { deriveCiStatus, getLatestWorkflowRun } from '../lib/github/workflows';
import { syncRepoHealth } from './health-sync.service';
import { refreshFromGitHub } from './repo-sync.service';
import { syncRepoTraffic } from './traffic.service';
import { syncSignals } from './signal.service';
import { evaluateAlertsQuietly } from './alert.service';

export interface SyncProgress {
  phase: 'refreshing' | 'syncing';
  done: number;
  total: number;
}

export interface SyncSummary {
  trigger: string;
  startedAt: string;
  finishedAt: string;
  repos: { total: number; synced: number; failed: number; removed: number };
  /** First failures only: enough to diagnose without flooding the response. */
  errors: { repo: string; error: string }[];
  /** Set when the run could not even refresh the repo list. */
  error?: string;
}

export interface SyncOptions {
  /** Who started it: shown in the activity log ('manual', 'schedule', 'setup'). */
  trigger?: string;
  /** Repos synced in parallel. Keep low: every repo costs several GitHub API calls. */
  concurrency?: number;
  onProgress?: (progress: SyncProgress) => void;
}

const MAX_REPORTED_ERRORS = 20;

/** Runs `worker` over `items`, at most `limit` at a time. */
export async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(lanes);
}

export async function runFullSync(ctx: AppContext, options: SyncOptions = {}): Promise<SyncSummary> {
  const { trigger = 'manual', concurrency = 3, onProgress } = options;
  const startedAt = new Date().toISOString();
  const summary: SyncSummary = {
    trigger, startedAt, finishedAt: startedAt,
    repos: { total: 0, synced: 0, failed: 0, removed: 0 },
    errors: [],
  };
  const actor = { type: 'system', name: `${trigger}_sync` };

  try {
    onProgress?.({ phase: 'refreshing', done: 0, total: 0 });
    const refreshed = await refreshFromGitHub(ctx);
    summary.repos.removed = refreshed.removed;

    const repos = await ctx.storage.repos.listRepos();
    summary.repos.total = repos.length;
    let done = 0;
    onProgress?.({ phase: 'syncing', done, total: repos.length });

    await mapLimit(repos, concurrency, async (repo) => {
      const fullName: string = repo.full_name;
      const [owner, name] = fullName.split('/');
      try {
        await syncRepoHealth(ctx, owner, name, actor);
        const run = await getLatestWorkflowRun(ctx.config, owner, name);
        await ctx.storage.health.updateCiStatus(fullName, {
          ci_status: deriveCiStatus(run),
          ci_status_url: run?.html_url ?? null,
          ci_status_run_at: run?.run_at ?? null,
        });
        // Traffic needs push access; repos without it are simply skipped.
        await syncRepoTraffic(ctx, owner, name).catch(() => false);
        // Signals fail per kind (missing permissions, disabled features) without failing the repo.
        await syncSignals(ctx, owner, name).catch(() => null);
        summary.repos.synced++;
      } catch (error: any) {
        summary.repos.failed++;
        if (summary.errors.length < MAX_REPORTED_ERRORS) summary.errors.push({ repo: fullName, error: error.message });
      }
      onProgress?.({ phase: 'syncing', done: ++done, total: repos.length });
    });
  } catch (error: any) {
    summary.error = error.message;
  }

  // The data is fresh: open, update or resolve alerts and tell the channels.
  if (!summary.error) await evaluateAlertsQuietly(ctx);

  summary.finishedAt = new Date().toISOString();
  await ctx.storage.activity.logActivity({
    action: 'sync.full',
    entityType: 'system',
    entityId: 'full-sync',
    newValue: summary.error
      ? `Failed: ${summary.error}`
      : `Synced ${summary.repos.synced}/${summary.repos.total} repos (${summary.repos.failed} failed)`,
    actorType: actor.type,
    actorName: actor.name,
    metadata: summary,
  }).catch(() => undefined); // the log must not turn a finished sync into a failure

  return summary;
}

// ── One run at a time ───────────────────────────────

export interface SyncStatus {
  running: boolean;
  progress: SyncProgress | null;
  lastRun: SyncSummary | null;
}

interface RunnerState extends SyncStatus {
  current: Promise<SyncSummary> | null;
}

/** Keyed by storage: a process has one storage, tests have many. */
const runners = new WeakMap<object, RunnerState>();

function runnerFor(ctx: AppContext): RunnerState {
  let state = runners.get(ctx.storage);
  if (!state) {
    state = { running: false, progress: null, lastRun: null, current: null };
    runners.set(ctx.storage, state);
  }
  return state;
}

export function getSyncStatus(ctx: AppContext): SyncStatus {
  const { running, progress, lastRun } = runnerFor(ctx);
  return { running, progress, lastRun };
}

/**
 * Starts a full sync unless one is already running. Returns immediately;
 * `started` tells which happened and `finished` resolves with the summary.
 */
export function startFullSync(
  ctx: AppContext,
  options: SyncOptions = {},
): { started: boolean; finished: Promise<SyncSummary> } {
  const state = runnerFor(ctx);
  if (state.current) return { started: false, finished: state.current };

  state.running = true;
  state.progress = { phase: 'refreshing', done: 0, total: 0 };
  state.current = runFullSync(ctx, {
    ...options,
    onProgress: (progress) => {
      state.progress = progress;
      options.onProgress?.(progress);
    },
  }).then((summary) => {
    state.lastRun = summary;
    return summary;
  }).finally(() => {
    state.running = false;
    state.progress = null;
    state.current = null;
  });

  return { started: true, finished: state.current };
}

/** True when the last GitHub refresh is older than the interval (or never happened). */
export function isSyncDue(lastSync: string | null, intervalHours: number, now = new Date()): boolean {
  if (!(intervalHours > 0)) return false;
  if (!lastSync) return true;
  return now.getTime() - new Date(lastSync).getTime() >= intervalHours * 3_600_000;
}
