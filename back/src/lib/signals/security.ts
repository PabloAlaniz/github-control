import type { SignalCollector, SignalContext } from './types';
import { isUnavailable } from './types';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export interface SecurityAlert {
  source: 'dependabot' | 'codeScanning' | 'secretScanning';
  severity: Severity;
  title: string;
  url: string | null;
}

export interface SourceSummary {
  /** false = the source is not enabled on the repo or the token cannot read it. */
  available: boolean;
  open: number;
  /** true = there were more alerts than those on the first page (100). */
  truncated: boolean;
}

const PAGE_SIZE = 100;
const MAX_ITEMS = 50;
/** Alerts that travel in the `/api/repos` summary (the rest stay in `items`). */
const TOP_ITEMS = 5;

function normalizeSeverity(value: unknown): Severity {
  const v = String(value ?? '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low') return v;
  if (v === 'error') return 'high';       // code scanning without security_severity_level
  if (v === 'warning' || v === 'moderate') return 'medium';
  return 'low';
}

type Mapper = (raw: any) => Omit<SecurityAlert, 'source'>;

const SOURCES: Array<{ source: SecurityAlert['source']; route: string; map: Mapper }> = [
  {
    source: 'dependabot',
    route: 'GET /repos/{owner}/{repo}/dependabot/alerts',
    map: a => ({
      severity: normalizeSeverity(a.security_advisory?.severity ?? a.security_vulnerability?.severity),
      title: `${a.dependency?.package?.name ?? 'dependency'}: ${a.security_advisory?.summary ?? 'vulnerability'}`,
      url: a.html_url ?? null,
    }),
  },
  {
    source: 'codeScanning',
    route: 'GET /repos/{owner}/{repo}/code-scanning/alerts',
    map: a => ({
      severity: normalizeSeverity(a.rule?.security_severity_level ?? a.rule?.severity),
      title: a.rule?.description ?? a.rule?.id ?? 'code scanning alert',
      url: a.html_url ?? null,
    }),
  },
  {
    source: 'secretScanning',
    route: 'GET /repos/{owner}/{repo}/secret-scanning/alerts',
    // An exposed secret is always critical.
    map: a => ({
      severity: 'critical',
      title: a.secret_type_display_name ?? a.secret_type ?? 'exposed secret',
      url: a.html_url ?? null,
    }),
  },
];

async function fetchSource(ctx: SignalContext, route: string): Promise<any[] | null> {
  try {
    const { data } = await ctx.octokit.request(route, {
      owner: ctx.owner, repo: ctx.repo, state: 'open', per_page: PAGE_SIZE,
    });
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    // 403/404: alerts disabled, no analysis, or token without the permission.
    if (isUnavailable(err) || err?.status === 400) return null;
    throw err;
  }
}

/** Summarizes already-normalized alerts. Pure function. */
export function summarizeAlerts(alerts: SecurityAlert[], sources: Record<string, SourceSummary>) {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const alert of alerts) bySeverity[alert.severity]++;
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const sorted = [...alerts].sort((a, b) => rank(a.severity) - rank(b.severity));

  return {
    available: Object.values(sources).some(s => s.available),
    sources,
    total: alerts.length,
    bySeverity,
    worst: SEVERITIES.find(s => bySeverity[s] > 0) ?? null,
    top: sorted.slice(0, TOP_ITEMS),
    items: sorted.slice(0, MAX_ITEMS),
  };
}

/** Open security alerts: vulnerable dependencies, code scanning and exposed secrets. */
export const collectSecurity: SignalCollector = async (ctx) => {
  const alerts: SecurityAlert[] = [];
  const sources: Record<string, SourceSummary> = {};

  for (const { source, route, map } of SOURCES) {
    const raw = await fetchSource(ctx, route);
    sources[source] = { available: raw !== null, open: raw?.length ?? 0, truncated: raw?.length === PAGE_SIZE };
    for (const item of raw ?? []) alerts.push({ source, ...map(item) });
  }

  return summarizeAlerts(alerts, sources);
};
