/**
 * In-memory storage adapter.
 *
 * Implements every storage port over plain arrays. It is the reference
 * implementation for the adapter contract, the storage used by tests, and
 * the engine behind the file-backed stores (JSON, CSV), which only add
 * loading and saving of the state.
 */
import type { Row, Storage } from '../../../application/ports/storage';
import { COLLECTIONS, NOW, type CollectionName } from '../schema';
import { createTrafficStore } from './traffic-store';
import { createSavedViewStore, createServiceCheckStore, createSignalStore } from './extra-stores';
import { createAlertChannelStore, createAlertStore } from './alert-stores';
import { MemoryDb, clone, emptyState, type MemoryOptions, type MemoryState } from './db';
import { createGroupStore, createHealthStore, createMetaStore, createRepoStore } from './repo-stores';
import {
  createActivityStore, createAppStore, createCoverageStore, createMetricsStore, createServiceStore,
} from './other-stores';

export { emptyState, type MemoryOptions, type MemoryState };

const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

export function createMemoryStorage(state: MemoryState = emptyState(), options: MemoryOptions = {}): Storage {
  const db = new MemoryDb(state, options);
  return {
    repos: createRepoStore(db),
    groups: createGroupStore(db),
    meta: createMetaStore(db),
    health: createHealthStore(db),
    apps: createAppStore(db),
    coverage: createCoverageStore(db),
    metrics: createMetricsStore(db),
    services: createServiceStore(db),
    activity: createActivityStore(db),
    traffic: createTrafficStore(db),
    savedViews: createSavedViewStore(db),
    signals: createSignalStore(db),
    serviceChecks: createServiceCheckStore(db),
    alerts: createAlertStore(db),
    alertChannels: createAlertChannelStore(db),
    admin: {
      async exportAll() {
        const dump: Record<string, Row[]> = {};
        for (const name of COLLECTION_NAMES) dump[name] = clone(db.table(name));
        return dump;
      },
      async importAll(dump) {
        for (const name of COLLECTION_NAMES) {
          const defaults = COLLECTIONS[name] as Record<string, unknown>;
          db.replace(name, (dump[name] ?? []).map((row) => {
            // Complete every record, so data from an older export gains new columns.
            const full: Row = {};
            for (const [column, fallback] of Object.entries(defaults)) {
              full[column] = column in row ? clone(row[column]) : (fallback === NOW ? db.now() : clone(fallback));
            }
            return full;
          }));
        }
        await db.commit();
      },
    },
  };
}
