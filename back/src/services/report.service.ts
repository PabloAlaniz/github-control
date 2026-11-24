/**
 * The report: what changed across the repos and services over the last days,
 * put together from what the dashboard already stores (no GitHub calls).
 */
import type { AppContext } from '../application/context';
import { isReadyToMergeItem } from '../lib/signals/inbox';
import { buildUptime } from './service-check.service';

const DAY_MS = 86_400_000;
const TOP = 5;

export interface Report {
  days: number;
  from: string;
  to: string;
  /** The few sentences worth reading first. */
  highlights: string[];
  repos: { total: number; added: { repo: string; createdAt: string }[] };
  growth: {
    stars: number;
    loc: number;
    topStars: { repo: string; delta: number }[];
    topLoc: { repo: string; delta: number }[];
  };
  releases: { repo: string; tag: string; publishedAt: string; url: string | null }[];
  alerts: { opened: number; resolved: number; open: { kind: string; title: string; openedAt: string }[] };
  inbox: { openPrs: number; openIssues: number; prsOpened: number; issuesOpened: number; readyToMerge: number };
  ci: { failing: string[] };
  services: { name: string; uptimePct: number | null; incidents: number }[];
  traffic: { views: number; previousViews: number; clones: number };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export async function buildReport(ctx: AppContext, days = 7, now: Date = new Date()): Promise<Report> {
  const { storage } = ctx;
  const since = new Date(now.getTime() - days * DAY_MS);
  const sinceIso = since.toISOString();

  const [repos, trends, releaseSignals, inboxSignals, alerts, serviceRows, daily, incidents, traffic] = await Promise.all([
    storage.repos.listRepos(),
    storage.metrics.getBulkTrends(days),
    storage.signals.listSignals('release'),
    storage.signals.listSignals('inbox'),
    storage.alerts.listAlerts({ limit: 10_000 }),
    storage.services.listServices({ isActive: 'true' }),
    storage.serviceChecks.getDailyUptime(days),
    storage.serviceChecks.getIncidents(days),
    storage.traffic.getDailyTotals(days * 2),
  ]);
  const active = new Set(repos.map((repo) => repo.full_name as string));

  const moved = trends.filter((trend) => active.has(trend.full_name));
  const top = (field: 'stars_delta' | 'loc_delta') => moved
    .map((trend) => ({ repo: trend.full_name, delta: Number(trend[field]) || 0 }))
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.repo.localeCompare(b.repo))
    .slice(0, TOP);

  const releases = releaseSignals
    .filter((signal) => active.has(signal.full_name) && signal.data.hasRelease && typeof signal.data.publishedAt === 'string' && signal.data.publishedAt >= sinceIso)
    .map((signal) => ({ repo: signal.full_name, tag: String(signal.data.tag), publishedAt: signal.data.publishedAt as string, url: signal.data.url ?? null }))
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  const items = inboxSignals.filter((signal) => active.has(signal.full_name)).flatMap((signal) => (signal.data.items ?? []) as Record<string, any>[]);
  const openedSince = (type: string) => items.filter((item) => item.type === type && item.createdAt >= sinceIso).length;

  const uptime = buildUptime(daily, incidents, days, now).services as Record<string, any>;
  const services = serviceRows
    .filter((service) => service.is_active !== false)
    .map((service) => ({
      name: (service.name ?? service.slug) as string,
      uptimePct: uptime[service.slug]?.uptimePct ?? null,
      incidents: uptime[service.slug]?.incidents ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const cutoffDay = sinceIso.slice(0, 10);
  const recent = traffic.filter((day) => day.day > cutoffDay);
  const previous = traffic.filter((day) => day.day <= cutoffDay);

  const report: Report = {
    days,
    from: sinceIso,
    to: now.toISOString(),
    highlights: [],
    repos: {
      total: repos.length,
      added: repos
        .filter((repo) => typeof repo.repo_created_at === 'string' && new Date(repo.repo_created_at) >= since)
        .map((repo) => ({ repo: repo.full_name as string, createdAt: new Date(repo.repo_created_at).toISOString() })),
    },
    growth: {
      stars: sum(moved.map((trend) => Number(trend.stars_delta) || 0)),
      loc: sum(moved.map((trend) => Number(trend.loc_delta) || 0)),
      topStars: top('stars_delta'),
      topLoc: top('loc_delta'),
    },
    releases,
    alerts: {
      opened: alerts.filter((alert) => alert.opened_at >= sinceIso).length,
      resolved: alerts.filter((alert) => alert.resolved_at && alert.resolved_at >= sinceIso).length,
      open: alerts.filter((alert) => alert.status === 'open').map((alert) => ({ kind: alert.kind, title: alert.title, openedAt: alert.opened_at })),
    },
    inbox: {
      openPrs: items.filter((item) => item.type === 'pr').length,
      openIssues: items.filter((item) => item.type === 'issue').length,
      prsOpened: openedSince('pr'),
      issuesOpened: openedSince('issue'),
      readyToMerge: items.filter(isReadyToMergeItem).length,
    },
    ci: { failing: repos.filter((repo) => repo.ci_status === 'failure').map((repo) => repo.full_name as string).sort() },
    services,
    traffic: {
      views: sum(recent.map((day) => day.views)),
      previousViews: sum(previous.map((day) => day.views)),
      clones: sum(recent.map((day) => day.clones)),
    },
  };

  report.highlights = highlights(report);
  return report;
}

/** The report in a few sentences, most important first. */
export function highlights(report: Report): string[] {
  const lines: string[] = [];
  const period = report.days === 7 ? 'this week' : `in the last ${report.days} days`;

  if (report.ci.failing.length > 0) lines.push(`CI is failing on ${report.ci.failing.slice(0, 3).join(', ')}${report.ci.failing.length > 3 ? ` and ${report.ci.failing.length - 3} more` : ''}.`);
  const down = report.services.filter((service) => service.incidents > 0);
  if (down.length > 0) lines.push(`${down.map((service) => `${service.name} (${plural(service.incidents, 'incident')})`).join(', ')} went down ${period}.`);
  if (report.alerts.opened > 0 || report.alerts.resolved > 0) {
    lines.push(`${plural(report.alerts.opened, 'alert')} opened and ${report.alerts.resolved} resolved ${period}; ${report.alerts.open.length} still open.`);
  }
  if (report.releases.length > 0) lines.push(`${plural(report.releases.length, 'release')} published: ${report.releases.slice(0, 4).map((release) => `${release.repo} ${release.tag}`).join(', ')}.`);
  if (report.inbox.readyToMerge > 0) lines.push(`${plural(report.inbox.readyToMerge, 'pull request')} ${report.inbox.readyToMerge === 1 ? 'is' : 'are'} ready to merge.`);
  if (report.inbox.prsOpened + report.inbox.issuesOpened > 0) {
    lines.push(`${plural(report.inbox.prsOpened, 'pull request')} and ${plural(report.inbox.issuesOpened, 'issue')} opened ${period} are still open.`);
  }
  if (report.growth.stars !== 0) lines.push(`${report.growth.stars > 0 ? '+' : ''}${report.growth.stars} stars ${period}.`);
  if (report.traffic.previousViews > 0) {
    const change = Math.round(((report.traffic.views - report.traffic.previousViews) / report.traffic.previousViews) * 100);
    if (Math.abs(change) >= 10) lines.push(`Views are ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on the period before.`);
  }
  if (report.repos.added.length > 0) lines.push(`${plural(report.repos.added.length, 'new repo')}: ${report.repos.added.map((repo) => repo.repo).join(', ')}.`);
  if (lines.length === 0) lines.push(`A quiet stretch: nothing notable ${period}.`);
  return lines;
}
