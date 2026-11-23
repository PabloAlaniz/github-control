/**
 * Alerts: keeps the open alerts in step with the conditions that hold (see
 * domain/alerts.ts) and tells the configured channels what changed.
 *
 * It only reads what the storage already knows, so it is cheap and can run
 * after every sync and every round of service checks.
 */
import type { AppContext } from '../application/context';
import type { Alert, AlertChannel } from '../application/ports/storage';
import {
  ALERT_KIND_LABELS, RECOVERY_KINDS, evaluateConditions, isAlertKind, planAlerts, resolveAlertOptions,
  type AlertEventType,
} from '../domain/alerts';
import { deliver, type Fetcher, type OutgoingMessage } from '../lib/alerts/channels';
import { groupSignals } from './signal.service';

/** Days a resolved alert stays in the history. */
export const ALERT_HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;
const DIGEST_PERIOD_MS = { daily: DAY_MS, weekly: 7 * DAY_MS };
/** A digest that is due within this margin goes out now rather than a whole check later. */
const DIGEST_SLACK_MS = 10 * 60_000;
const DIGEST_MAX_LINES = 15;

export interface AlertEvent {
  type: AlertEventType;
  alert: Pick<Alert, 'key' | 'kind' | 'entity' | 'title' | 'detail' | 'url' | 'level'>;
}

export interface EvaluationResult {
  opened: number;
  worsened: number;
  resolved: number;
  /** Alerts open after this evaluation. */
  open: number;
  /** Messages accepted by a channel / refused or failed. */
  delivered: number;
  failed: number;
}

export interface AlertRunOptions {
  /** False records what changed without telling any channel. */
  notify?: boolean;
  now?: Date;
  fetcher?: Fetcher;
}

const PREFIX: Record<AlertEventType, string> = { opened: '🔴', worsened: '🔺', resolved: '🟢 Resolved:' };

export function eventMessage({ type, alert }: AlertEvent, at: Date): OutgoingMessage {
  const lines: string[] = [];
  if (type !== 'resolved' && Array.isArray(alert.detail?.top)) {
    for (const item of alert.detail.top) lines.push(`• ${item}`);
  }
  return {
    title: `${PREFIX[type]} ${alert.title}`,
    lines,
    url: alert.url,
    payload: {
      source: 'github-control', event: type, kind: alert.kind, entity: alert.entity,
      title: alert.title, url: alert.url, level: alert.level, detail: alert.detail, at: at.toISOString(),
    },
  };
}

const wants = (channel: AlertChannel, kind: string) =>
  channel.is_enabled && (channel.kinds.length === 0 || channel.kinds.includes(kind));

async function send(
  ctx: AppContext, channel: AlertChannel, message: OutgoingMessage, fetcher: Fetcher | undefined, digest = false,
): Promise<boolean> {
  const error = await deliver(channel.type, channel.config, message, fetcher);
  await ctx.storage.alertChannels.recordDelivery(channel.id, { error, digest }).catch(() => undefined);
  return error === null;
}

async function evaluate(ctx: AppContext, options: AlertRunOptions): Promise<EvaluationResult> {
  const { notify = true, now = new Date(), fetcher } = options;
  const { storage } = ctx;

  const [repos, services, signalRecords, openAlerts] = await Promise.all([
    storage.repos.listRepos(),
    storage.services.listServices({}),
    storage.signals.listSignals(),
    storage.alerts.listAlerts({ status: 'open', limit: 10_000 }),
  ]);
  const conditions = evaluateConditions({
    repos, services, now,
    signals: groupSignals(signalRecords, { summary: true }),
    options: resolveAlertOptions(ctx.config),
  });
  const plan = planAlerts(conditions, openAlerts);
  const events: AlertEvent[] = [];

  for (const condition of plan.open) {
    await storage.alerts.openAlert(condition);
    events.push({ type: 'opened', alert: condition });
  }
  for (const { id, condition, worsened } of plan.update) {
    await storage.alerts.updateAlert(id, condition);
    if (worsened) events.push({ type: 'worsened', alert: condition });
  }
  const byId = new Map(openAlerts.map((alert) => [alert.id, alert]));
  for (const { id } of plan.resolve) {
    await storage.alerts.resolveAlert(id);
    const alert = byId.get(id)!;
    if (RECOVERY_KINDS.includes(alert.kind)) events.push({ type: 'resolved', alert });
  }
  await storage.alerts.pruneResolved(ALERT_HISTORY_DAYS);

  const result: EvaluationResult = {
    opened: plan.open.length,
    worsened: plan.update.filter((update) => update.worsened).length,
    resolved: plan.resolve.length,
    open: openAlerts.length + plan.open.length - plan.resolve.length,
    delivered: 0, failed: 0,
  };

  if (notify && events.length > 0) {
    const channels = (await storage.alertChannels.listChannels()).filter((channel) => channel.is_enabled);
    for (const channel of channels) {
      for (const event of events.filter((e) => wants(channel, e.alert.kind))) {
        if (await send(ctx, channel, eventMessage(event, now), fetcher)) result.delivered++;
        else result.failed++;
      }
    }
  }
  return result;
}

/** One evaluation at a time per storage: two at once would open the same alert twice. */
const queues = new WeakMap<object, Promise<unknown>>();

export function evaluateAlerts(ctx: AppContext, options: AlertRunOptions = {}): Promise<EvaluationResult> {
  const previous = queues.get(ctx.storage) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => evaluate(ctx, options));
  queues.set(ctx.storage, run);
  return run;
}

/** Evaluation for callers whose own work must not fail because of alerts (sync, service checks). */
export async function evaluateAlertsQuietly(ctx: AppContext): Promise<void> {
  try {
    await evaluateAlerts(ctx);
  } catch (error: any) {
    console.warn(`Alert evaluation failed: ${error?.message}`);
  }
}

// ── Digests ─────────────────────────────────────────

export function digestMessage(
  channel: Pick<AlertChannel, 'kinds' | 'digest'>, alerts: Alert[], since: Date, now: Date,
): OutgoingMessage {
  const mine = alerts.filter((alert) => channel.kinds.length === 0 || channel.kinds.includes(alert.kind));
  const open = mine.filter((alert) => alert.status === 'open');
  const opened = mine.filter((alert) => new Date(alert.opened_at) >= since).length;
  const resolved = mine.filter((alert) => alert.resolved_at && new Date(alert.resolved_at) >= since).length;
  const period = channel.digest === 'weekly' ? 'week' : 'day';

  const lines = [`In the last ${period}: ${opened} opened, ${resolved} resolved.`];
  for (const alert of open.slice(0, DIGEST_MAX_LINES)) {
    const label = isAlertKind(alert.kind) ? ALERT_KIND_LABELS[alert.kind] : alert.kind;
    lines.push(`• [${label}] ${alert.title}`);
  }
  if (open.length > DIGEST_MAX_LINES) lines.push(`…and ${open.length - DIGEST_MAX_LINES} more.`);

  return {
    title: open.length === 0
      ? '🟢 GitHub Control digest: no open alerts'
      : `📋 GitHub Control digest: ${open.length} open alert${open.length === 1 ? '' : 's'}`,
    lines,
    url: null,
    payload: {
      source: 'github-control', event: 'digest', period, open: open.length, opened, resolved,
      alerts: open.map(({ kind, entity, title, url, opened_at }) => ({ kind, entity, title, url, opened_at })),
      at: now.toISOString(),
    },
  };
}

/** Sends the daily or weekly summary to every channel whose digest is due. Returns how many went out. */
export async function sendDueDigests(ctx: AppContext, options: AlertRunOptions = {}): Promise<number> {
  const { now = new Date(), fetcher } = options;
  const due = (await ctx.storage.alertChannels.listChannels()).filter((channel) => {
    if (!channel.is_enabled || channel.digest === 'off') return false;
    const last = new Date(channel.last_digest_at ?? channel.created_at).getTime();
    return now.getTime() - last >= DIGEST_PERIOD_MS[channel.digest] - DIGEST_SLACK_MS;
  });
  if (due.length === 0) return 0;

  const alerts = await ctx.storage.alerts.listAlerts({ limit: 10_000 });
  let sent = 0;
  for (const channel of due) {
    const since = new Date(now.getTime() - DIGEST_PERIOD_MS[channel.digest as 'daily' | 'weekly']);
    if (await send(ctx, channel, digestMessage(channel, alerts, since, now), fetcher, true)) sent++;
  }
  return sent;
}

/** Sends a test message to one channel. Returns why it failed, or null. */
export async function testChannel(ctx: AppContext, channel: AlertChannel, fetcher?: Fetcher): Promise<string | null> {
  const message: OutgoingMessage = {
    title: '✅ GitHub Control: test message',
    lines: [`Channel "${channel.name}" is set up correctly.`],
    url: null,
    payload: { source: 'github-control', event: 'test', channel: channel.name, at: new Date().toISOString() },
  };
  const error = await deliver(channel.type, channel.config, message, fetcher);
  await ctx.storage.alertChannels.recordDelivery(channel.id, { error });
  return error;
}
