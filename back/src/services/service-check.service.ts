import type { AppContext } from '../application/context';
import type { IncidentRow, UptimeDayRow } from '../application/ports/storage';
import { evaluateAlertsQuietly } from './alert.service';

export interface CheckResult {
  status: 'healthy' | 'degraded' | 'down';
  httpCode: number | null;
  responseMs: number;
}

const TIMEOUT_MS = 10_000;
const SLOW_MS = 5_000;
/** Days of check history kept by the scheduled run. */
export const HISTORY_DAYS = 90;

/** GETs the service and classifies it: fast 2xx = healthy, 5xx or no answer = down, anything else = degraded. */
export async function probe(url: string): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET', signal: controller.signal,
      headers: { 'User-Agent': 'github-control-health-checker/1.0' },
      redirect: 'follow',
    });
    const responseMs = Date.now() - startTime;
    const httpCode = response.status;
    let status: CheckResult['status'];
    if (httpCode >= 200 && httpCode < 300) status = responseMs > SLOW_MS ? 'degraded' : 'healthy';
    else if (httpCode >= 500) status = 'down';
    else status = 'degraded';
    return { status, httpCode, responseMs };
  } catch {
    return { status: 'down', httpCode: null, responseMs: Date.now() - startTime };
  } finally {
    clearTimeout(timeout);
  }
}

/** Checks a service, updates its latest status and appends the result to the history. */
export async function checkAndRecord(ctx: AppContext, service: { slug: string; url: string }): Promise<CheckResult> {
  const result = await probe(service.url);
  await ctx.storage.services.updateHealthCheck(service.slug, result.status, result.responseMs, result.httpCode);
  await ctx.storage.serviceChecks.recordCheck(service.slug, result.status, result.responseMs, result.httpCode);
  return result;
}

export async function checkAllServices(ctx: AppContext) {
  const services = await ctx.storage.services.listActiveServices();
  const results = await Promise.allSettled(
    services.map(async (svc) => ({ slug: svc.slug, name: svc.name, ...(await checkAndRecord(ctx, svc)) })),
  );

  const summary = { total: services.length, healthy: 0, degraded: 0, down: 0 };
  const details = results.map((r) => {
    if (r.status === 'fulfilled') {
      summary[r.value.status]++;
      return r.value;
    }
    summary.down++;
    return { slug: 'unknown', status: 'down', error: r.reason?.message };
  });
  // A service that went down or came back is an alert opening or closing.
  await evaluateAlertsQuietly(ctx);
  return { ...summary, results: details };
}

/** Scheduled run: checks every active service and trims old history. */
export async function runScheduledChecks(ctx: AppContext) {
  const summary = await checkAllServices(ctx);
  await ctx.storage.serviceChecks.pruneChecks(HISTORY_DAYS);
  return summary;
}

export interface UptimeDay { date: string; checks: number; down: number; degraded: number; avgMs: number | null }

/** Per-service uptime summary from the daily and incident rows. Pure. */
export function buildUptime(daily: UptimeDayRow[], incidents: IncidentRow[], days: number, now: Date = new Date()) {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const incidentBySlug = new Map(incidents.map((i) => [i.slug, i]));
  const bySlug = new Map<string, Map<string, UptimeDay>>();
  for (const row of daily) {
    const perDay = bySlug.get(row.slug) ?? new Map<string, UptimeDay>();
    perDay.set(row.day, { date: row.day, checks: row.checks, down: row.down, degraded: row.degraded, avgMs: row.avg_ms });
    bySlug.set(row.slug, perDay);
  }

  const services: Record<string, unknown> = {};
  for (const [slug, perDay] of bySlug) {
    const recorded = [...perDay.values()];
    const checks = recorded.reduce((n, d) => n + d.checks, 0);
    const down = recorded.reduce((n, d) => n + d.down, 0);
    const timed = recorded.filter((d) => d.avgMs !== null);
    const weighted = timed.reduce((n, d) => n + d.avgMs! * d.checks, 0);
    const timedChecks = timed.reduce((n, d) => n + d.checks, 0);
    const incident = incidentBySlug.get(slug);
    services[slug] = {
      checks,
      uptimePct: checks > 0 ? Math.round(((checks - down) / checks) * 10000) / 100 : null,
      avgMs: timedChecks > 0 ? Math.round(weighted / timedChecks) : null,
      incidents: incident?.incidents ?? 0,
      lastDownAt: incident?.last_down_at ?? null,
      daily: dates.map((date) => perDay.get(date) ?? { date, checks: 0, down: 0, degraded: 0, avgMs: null }),
    };
  }
  return { days, services };
}
