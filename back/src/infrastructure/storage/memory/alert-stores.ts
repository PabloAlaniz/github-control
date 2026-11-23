/** In-memory stores for alerts and the channels they are sent to. */
import type {
  Alert, AlertChannel, AlertChannelStore, AlertStore,
} from '../../../application/ports/storage';
import { clone, compareText, type MemoryDb } from './db';

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 200;

export function createAlertStore(db: MemoryDb): AlertStore {
  const alerts = () => db.table('alerts');
  return {
    async listAlerts({ status, limit = DEFAULT_LIMIT } = {}) {
      return clone(alerts().filter((alert) => !status || alert.status === status))
        .sort((a, b) => compareText(b.opened_at, a.opened_at) || b.id - a.id)
        .slice(0, Math.max(1, Math.floor(limit))) as Alert[];
    },

    async openAlert(input) {
      const row = db.insert('alerts', { ...clone(input) });
      await db.commit();
      return clone(row) as Alert;
    },

    async updateAlert(id, fields) {
      const row = alerts().find((alert) => alert.id === id);
      if (!row) return;
      db.update('alerts', row, {
        title: fields.title, detail: clone(fields.detail), url: fields.url, level: fields.level,
      });
      await db.commit();
    },

    async resolveAlert(id) {
      const row = alerts().find((alert) => alert.id === id && alert.status === 'open');
      if (!row) return;
      db.update('alerts', row, { status: 'resolved', resolved_at: db.now() });
      await db.commit();
    },

    async pruneResolved(keepDays) {
      const cutoff = new Date(new Date(db.now()).getTime() - keepDays * DAY_MS).toISOString();
      db.remove('alerts', (alert) => alert.status === 'resolved' && alert.resolved_at < cutoff);
      await db.commit();
    },
  };
}

export function createAlertChannelStore(db: MemoryDb): AlertChannelStore {
  const channels = () => db.table('alert_channels');
  const find = (id: number) => channels().find((channel) => channel.id === id);
  return {
    async listChannels() {
      return clone(channels()).sort((a, b) => a.id - b.id) as AlertChannel[];
    },

    async getChannel(id) {
      const row = find(id);
      return row ? clone(row) as AlertChannel : null;
    },

    async createChannel(input) {
      const row = db.insert('alert_channels', { ...clone(input) });
      await db.commit();
      return clone(row) as AlertChannel;
    },

    async updateChannel(id, input) {
      const row = find(id);
      if (!row) return null;
      db.update('alert_channels', row, { ...clone(input), updated_at: db.now() });
      await db.commit();
      return clone(row) as AlertChannel;
    },

    async deleteChannel(id) {
      const removed = db.remove('alert_channels', (channel) => channel.id === id);
      await db.commit();
      return removed.length > 0;
    },

    async recordDelivery(id, { error, digest }) {
      const row = find(id);
      if (!row) return;
      const now = db.now();
      db.update('alert_channels', row, {
        last_error: error,
        ...(error === null && { last_sent_at: now }),
        ...(digest && { last_digest_at: now }),
      });
      await db.commit();
    },
  };
}
