/**
 * SQL adapter: one implementation of the storage ports for Postgres and
 * SQLite. Each `*.repository.ts` module holds the SQL for one store as plain
 * functions taking a `SqlClient` first; this file binds them to a client and
 * checks, at compile time, that the result satisfies the ports.
 */
import type { AppConfig } from '../../../config';
import type { Storage } from '../../../application/ports/storage';
import type { SqlClient } from './client';
import { createNeonClient } from './neon-client';
import * as repos from './repo.repository';
import * as groups from './group.repository';
import * as meta from './meta.repository';
import * as health from './health.repository';
import * as apps from './app.repository';
import * as coverage from './coverage.repository';
import * as metrics from './metrics.repository';
import * as services from './service.repository';
import * as activity from './activity.repository';
import * as admin from './admin.repository';
import * as traffic from './traffic.repository';
import * as savedViews from './saved-view.repository';
import * as signals from './signal.repository';
import * as serviceChecks from './service-check.repository';

/** Drops the leading client parameter from every function of a module. */
type Bound<M> = {
  [K in keyof M]: M[K] extends (db: SqlClient, ...args: infer A) => infer R ? (...args: A) => R : never;
};

function bind<M extends Record<string, unknown>>(module: M, db: SqlClient): Bound<M> {
  const bound: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(module)) {
    if (typeof fn === 'function') {
      bound[name] = (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(db, ...args);
    }
  }
  return bound as Bound<M>;
}

export function createSqlStorage(db: SqlClient): Storage {
  return {
    repos: bind(repos, db),
    groups: bind(groups, db),
    meta: bind(meta, db),
    health: bind(health, db),
    apps: bind(apps, db),
    coverage: bind(coverage, db),
    metrics: bind(metrics, db),
    services: bind(services, db),
    activity: bind(activity, db),
    traffic: bind(traffic, db),
    savedViews: bind(savedViews, db),
    signals: bind(signals, db),
    serviceChecks: bind(serviceChecks, db),
    admin: bind(admin, db),
  };
}

/** Postgres over Neon's HTTP driver (the Cloudflare Workers setup). */
export function createPostgresStorage(config: AppConfig): Storage {
  return createSqlStorage(createNeonClient(config));
}
