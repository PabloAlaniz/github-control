/** In-memory store for traffic history. */
import type { Row, TrafficDay, TrafficStore } from '../../../application/ports/storage';
import { addDays, compareText, type MemoryDb } from './db';

const COUNTS = ['views', 'views_unique', 'clones', 'clones_unique'] as const;

function total(rows: Row[]): Omit<TrafficDay, 'day'> {
  const out = { views: 0, views_unique: 0, clones: 0, clones_unique: 0 };
  for (const row of rows) for (const column of COUNTS) out[column] += row[column] ?? 0;
  return out;
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(row[key], [...(groups.get(row[key]) ?? []), row]);
  return groups;
}

export function createTrafficStore(db: MemoryDb): TrafficStore {
  const daily = () => db.table('repo_traffic_daily');
  const sources = () => db.table('repo_traffic_sources');
  const since = (days: number) => addDays(db.today(), -days);

  return {
    async upsertDaily(fullName, days) {
      for (const d of days) {
        const values = {
          views: d.views, views_unique: d.views_unique,
          clones: d.clones, clones_unique: d.clones_unique, fetched_at: db.now(),
        };
        const existing = daily().find((row) => row.full_name === fullName && row.day === d.day);
        if (existing) db.update('repo_traffic_daily', existing, values);
        else db.insert('repo_traffic_daily', { full_name: fullName, day: d.day, ...values });
      }
      await db.commit();
    },

    async replaceSources(fullName, day, kind, items) {
      db.remove('repo_traffic_sources', (row) => row.full_name === fullName && row.day === day && row.kind === kind);
      for (const item of items) {
        db.insert('repo_traffic_sources', {
          full_name: fullName, day, kind, label: item.label, title: item.title ?? null,
          hits: item.hits, uniques: item.uniques,
        });
      }
      await db.commit();
    },

    async getDaily(fullName, days) {
      return daily()
        .filter((row) => row.full_name === fullName && row.day >= since(days))
        .sort((a, b) => compareText(a.day, b.day))
        .map((row) => ({ day: row.day, ...total([row]) }));
    },

    async getDailyTotals(days) {
      return [...groupBy(daily().filter((row) => row.day >= since(days)), 'day').entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([day, rows]) => ({ day, ...total(rows) }));
    },

    async getTotalsByRepo(days) {
      return [...groupBy(daily().filter((row) => row.day >= since(days)), 'full_name').entries()]
        .map(([full_name, rows]) => ({ full_name, ...total(rows) }))
        .sort((a, b) => b.views - a.views || compareText(a.full_name, b.full_name));
    },

    async getSources(fullName, kind) {
      const mine = sources().filter((row) => row.full_name === fullName && row.kind === kind);
      const day = mine.map((row) => row.day as string).sort().at(-1) ?? null;
      return {
        day,
        sources: mine
          .filter((row) => row.day === day)
          .sort((a, b) => b.hits - a.hits || compareText(a.label, b.label))
          .map((row) => ({ label: row.label, title: row.title, hits: row.hits, uniques: row.uniques })),
      };
    },
  };
}
