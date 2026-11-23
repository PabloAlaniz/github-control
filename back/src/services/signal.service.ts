import type { AppContext } from '../application/context';
import type { SignalRecord } from '../application/ports/storage';
import { policyBaseline, resolvePolicy } from '../domain/policy';
import { getOctokit } from '../lib/github/client';
import { SIGNAL_COLLECTORS, SIGNAL_KINDS, createSignalContext, type SignalKind, type SignalData } from '../lib/signals';

export type SignalSyncResult =
  | { kind: SignalKind; ok: true; data: SignalData }
  | { kind: SignalKind; ok: false; error: string };

/**
 * Runs the requested collectors for a repo and stores each result.
 * Kinds fail independently: a 403 on one does not stop the others.
 * Returns null when the repo is not in the store.
 */
export async function syncSignals(
  ctx: AppContext,
  owner: string,
  repo: string,
  kinds: SignalKind[] = SIGNAL_KINDS,
): Promise<SignalSyncResult[] | null> {
  const fullName = `${owner}/${repo}`;
  const policy = resolvePolicy(ctx.config);
  const signalCtx = createSignalContext(
    getOctokit(ctx.config), owner, repo, policyBaseline(policy),
    { checks: policy.health.checks, scorecard: policy.signals.scorecard },
  );
  const results: SignalSyncResult[] = [];

  for (const kind of kinds) {
    try {
      const data = await SIGNAL_COLLECTORS[kind](signalCtx);
      const saved = await ctx.storage.signals.upsertSignal(fullName, kind, data);
      if (!saved) return null;
      results.push({ kind, ok: true, data });
    } catch (err: any) {
      console.warn(`Signal ${kind} failed for ${fullName}: ${err.message}`);
      results.push({ kind, ok: false, error: err.message ?? 'unknown error' });
    }
  }
  return results;
}

export type SignalsByKind = Record<string, Record<string, unknown>>;

/**
 * Groups records as `{ full_name: { kind: { ...data, checked_at } } }`.
 * With `summary`, the `items` list of each signal is left out: by convention
 * that key holds the long detail, which listings do not need.
 */
export function groupSignals(records: SignalRecord[], { summary = false } = {}): Map<string, SignalsByKind> {
  const byRepo = new Map<string, SignalsByKind>();
  for (const record of records) {
    const signals = byRepo.get(record.full_name) ?? {};
    const { items, ...rest } = record.data;
    signals[record.kind] = { ...(summary ? rest : record.data), checked_at: record.checked_at };
    byRepo.set(record.full_name, signals);
  }
  return byRepo;
}
