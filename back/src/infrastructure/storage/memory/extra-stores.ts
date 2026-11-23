/** In-memory stores for saved views, repo signals and the service check history. */
import type {
  IncidentRow, Row, SavedView, SavedViewStore, ServiceCheckStore, SignalRecord, SignalStore, UptimeDayRow,
} from '../../../application/ports/storage';
import { clone, compareText, type MemoryDb } from './db';

const DAY_MS = 86_400_000;

export function createSavedViewStore(db: MemoryDb): SavedViewStore {
  const views = () => db.table('saved_views');
  return {
    async listSavedViews() {
      return clone(views())
        .sort((a, b) => compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.name, b.name)) as SavedView[];
    },

    async upsertSavedView(name, query) {
      let row = views().find((view) => view.name === name);
      if (row) db.update('saved_views', row, { query, updated_at: db.now() });
      else row = db.insert('saved_views', { name, query });
      await db.commit();
      return clone(row) as SavedView;
    },

    async deleteSavedView(id) {
      const removed = db.remove('saved_views', (view) => view.id === id);
      await db.commit();
      return removed.length > 0;
    },
  };
}

export function createSignalStore(db: MemoryDb): SignalStore {
  const signals = () => db.table('repo_signals');
  const toRecord = (row: Row): SignalRecord => clone({
    full_name: row.full_name, kind: row.kind, data: row.data, checked_at: row.checked_at,
  });
  const ordered = (rows: Row[]) => rows
    .map(toRecord)
    .sort((a, b) => compareText(a.full_name, b.full_name) || compareText(a.kind, b.kind));

  return {
    async upsertSignal(fullName, kind, data) {
      if (!db.table('repos').some((repo) => repo.full_name === fullName)) return null;
      let row = signals().find((signal) => signal.full_name === fullName && signal.kind === kind);
      if (row) db.update('repo_signals', row, { data, checked_at: db.now() });
      else row = db.insert('repo_signals', { full_name: fullName, kind, data });
      await db.commit();
      return toRecord(row);
    },

    async getRepoSignals(fullName) {
      return ordered(signals().filter((signal) => signal.full_name === fullName));
    },

    async listSignals(kind) {
      return ordered(kind ? signals().filter((signal) => signal.kind === kind) : signals());
    },
  };
}

export function createServiceCheckStore(db: MemoryDb): ServiceCheckStore {
  const checks = () => db.table('service_checks');
  const since = (days: number) => new Date(new Date(db.now()).getTime() - days * DAY_MS).toISOString();
  const inWindow = (days: number) => checks().filter((check) => check.checked_at >= since(days));

  return {
    async recordCheck(slug, status, responseMs, httpCode, checkedAt) {
      db.insert('service_checks', {
        service_slug: slug, status, response_ms: responseMs, http_code: httpCode,
        ...(checkedAt ? { checked_at: checkedAt } : {}),
      });
      await db.commit();
    },

    async pruneChecks(keepDays) {
      const cutoff = since(keepDays);
      db.remove('service_checks', (check) => check.checked_at < cutoff);
      await db.commit();
    },

    async getDailyUptime(days) {
      const byKey = new Map<string, UptimeDayRow & { timed: number; total_ms: number }>();
      for (const check of inWindow(days)) {
        const day = (check.checked_at as string).slice(0, 10);
        const key = `${check.service_slug}\n${day}`;
        const row = byKey.get(key)
          ?? { slug: check.service_slug, day, checks: 0, down: 0, degraded: 0, avg_ms: null, timed: 0, total_ms: 0 };
        row.checks++;
        if (check.status === 'down') row.down++;
        if (check.status === 'degraded') row.degraded++;
        if (check.response_ms !== null) { row.timed++; row.total_ms += check.response_ms; }
        byKey.set(key, row);
      }
      return [...byKey.values()]
        .map(({ timed, total_ms, ...row }) => ({ ...row, avg_ms: timed > 0 ? Math.round(total_ms / timed) : null }))
        .sort((a, b) => compareText(a.slug, b.slug) || compareText(a.day, b.day));
    },

    async getIncidents(days) {
      const bySlug = new Map<string, Row[]>();
      for (const check of inWindow(days)) {
        bySlug.set(check.service_slug, [...(bySlug.get(check.service_slug) ?? []), check]);
      }
      const rows: IncidentRow[] = [];
      for (const [slug, history] of bySlug) {
        history.sort((a, b) => compareText(a.checked_at, b.checked_at) || a.id - b.id);
        let incidents = 0;
        let lastDownAt: string | null = null;
        history.forEach((check, i) => {
          if (check.status !== 'down') return;
          lastDownAt = check.checked_at;
          if (i === 0 || history[i - 1].status !== 'down') incidents++;
        });
        if (lastDownAt) rows.push({ slug, incidents, last_down_at: lastDownAt });
      }
      return rows.sort((a, b) => compareText(a.slug, b.slug));
    },
  };
}
