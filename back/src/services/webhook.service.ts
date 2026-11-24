/**
 * Applies a GitHub webhook delivery: what would otherwise wait for the next
 * sync (a failed run, a new pull request, a security alert) is reflected at
 * once, and the alerts are evaluated again.
 */
import type { AppContext } from '../application/context';
import { planWebhook } from '../lib/github/webhook';
import { isSignalKind, type SignalKind } from '../lib/signals';
import { evaluateAlertsQuietly } from './alert.service';
import { syncSignals } from './signal.service';

/** A burst of deliveries for one repo (a push fires several) reads each signal once. */
const DEBOUNCE_MS = 15_000;
const lastRead = new WeakMap<object, Map<string, number>>();

function dueSignals(ctx: AppContext, repo: string, kinds: string[], now: number): SignalKind[] {
  const seen = lastRead.get(ctx.storage) ?? new Map<string, number>();
  lastRead.set(ctx.storage, seen);
  return kinds.filter(isSignalKind).filter((kind) => {
    const key = `${repo}:${kind}`;
    if (now - (seen.get(key) ?? 0) < DEBOUNCE_MS) return false;
    seen.set(key, now);
    return true;
  });
}

export interface WebhookOutcome {
  handled: boolean;
  /** Why nothing was done, when nothing was. */
  reason?: 'ignored_event' | 'unknown_repo';
  repo?: string;
  ci?: string;
  signals?: string[];
}

export async function handleGithubEvent(ctx: AppContext, event: string, payload: unknown, now = Date.now()): Promise<WebhookOutcome> {
  const plan = planWebhook(event, payload);
  if (!plan) return { handled: false, reason: 'ignored_event' };
  // Only repos the dashboard tracks: an organization webhook also delivers for the others.
  if (!(await ctx.storage.repos.getRepo(plan.repo))) return { handled: false, reason: 'unknown_repo', repo: plan.repo };

  if (plan.ci) await ctx.storage.health.updateCiStatus(plan.repo, plan.ci);

  const kinds = dueSignals(ctx, plan.repo, plan.signals, now);
  if (kinds.length > 0) {
    const [owner, name] = plan.repo.split('/');
    await syncSignals(ctx, owner, name, kinds).catch(() => null);
  }

  await evaluateAlertsQuietly(ctx);
  return { handled: true, repo: plan.repo, ...(plan.ci && { ci: plan.ci.ci_status }), signals: kinds };
}
