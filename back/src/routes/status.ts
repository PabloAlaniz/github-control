import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import { renderBadge } from '../lib/badge';
import { buildUptime } from '../services/service-check.service';

/**
 * Public status page data. Served without authentication, so it is off unless
 * PUBLIC_STATUS=true, and it says only what a status page needs: each active
 * service's name, how it is doing and its uptime history. No URLs, providers
 * or repos.
 */
export const statusRoutes = new Hono<HttpEnv>();

const DAYS = 90;
type Overall = 'operational' | 'degraded' | 'outage' | 'unknown';

async function buildStatus(storage: HttpEnv['Variables']['storage']) {
  const [services, daily, incidents] = await Promise.all([
    storage.services.listServices({ isActive: 'true' }),
    storage.serviceChecks.getDailyUptime(DAYS),
    storage.serviceChecks.getIncidents(DAYS),
  ]);
  const uptime = buildUptime(daily, incidents, DAYS).services as Record<string, any>;

  const listed = services
    .filter((service) => service.is_active !== false)
    .map((service) => {
      const history = uptime[service.slug];
      return {
        slug: service.slug as string,
        name: (service.name ?? service.slug) as string,
        status: (service.last_check_status ?? 'unknown') as string,
        checkedAt: (service.last_check_at ?? null) as string | null,
        uptimePct: history?.uptimePct ?? null,
        incidents: history?.incidents ?? 0,
        lastDownAt: history?.lastDownAt ?? null,
        daily: (history?.daily ?? []).map(({ date, checks, down, degraded }: any) => ({ date, checks, down, degraded })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const statuses = listed.map((service) => service.status);
  const overall: Overall = listed.length === 0 || statuses.every((status) => status === 'unknown') ? 'unknown'
    : statuses.includes('down') ? 'outage'
      : statuses.includes('degraded') ? 'degraded' : 'operational';

  return { overall, days: DAYS, updatedAt: new Date().toISOString(), services: listed };
}

statusRoutes.get('/', async (c) => {
  if (c.env.PUBLIC_STATUS !== 'true') return c.json({ error: 'The status page is disabled' }, 404);
  return c.json(await buildStatus(c.var.storage), 200, { 'Cache-Control': 'public, max-age=60' });
});

const BADGE: Record<Overall, [string, string]> = {
  operational: ['operational', 'green'],
  degraded: ['degraded', 'yellow'],
  outage: ['outage', 'red'],
  unknown: ['unknown', 'gray'],
};

// Overall status as a badge, or one service's uptime with ?service=<slug>.
statusRoutes.get('/badge.svg', async (c) => {
  if (c.env.PUBLIC_STATUS !== 'true') return c.json({ error: 'The status page is disabled' }, 404);
  const status = await buildStatus(c.var.storage);
  const slug = c.req.query('service');

  let svg: string;
  if (slug) {
    const service = status.services.find((candidate) => candidate.slug === slug);
    if (!service) return c.json({ error: 'Service not found' }, 404);
    const pct = service.uptimePct;
    svg = renderBadge(
      `${service.name} uptime (${DAYS}d)`, pct === null ? 'unknown' : `${pct}%`,
      pct === null ? 'gray' : pct >= 99.9 ? 'green' : pct >= 99 ? 'yellow' : 'red',
    );
  } else {
    const [value, color] = BADGE[status.overall];
    svg = renderBadge('status', value, color);
  }
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
});
