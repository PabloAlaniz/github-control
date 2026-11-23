import { COLLECTIONS, columnType, type CollectionName } from './schema';

/** Shifts every date and timestamp by whole days so that `exportedAt` lands on today. */
export function rebaseDates(data: Record<string, Record<string, unknown>[]>, exportedAt: string, now = new Date()): void {
  const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.round((utcDay(now) - utcDay(new Date(exportedAt))) / 86_400_000);
  if (!Number.isFinite(days) || days === 0) return;
  for (const [collection, rows] of Object.entries(data)) {
    if (!(collection in COLLECTIONS)) continue;
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== 'string') continue;
        const type = columnType(collection as CollectionName, column);
        if (type !== 'timestamp' && type !== 'date') continue;
        const shifted = new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
        row[column] = type === 'date' ? shifted.slice(0, 10) : shifted;
      }
    }
  }
}
