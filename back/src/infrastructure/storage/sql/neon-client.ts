/** SqlClient over Neon's HTTP driver: the one that works on Cloudflare Workers. */
import type { AppConfig } from '../../../config';
import { postgresDialect, type SqlClient } from './client';
import { getDb, query, queryOne } from './neon';

export function createNeonClient(config: AppConfig): SqlClient {
  return {
    dialect: postgresDialect,
    query: (sql, params = []) => query(config, sql, params),
    queryOne: (sql, params = []) => queryOne(config, sql, params),
    async batch(statements) {
      const db = getDb(config);
      // Neon's HTTP transactions are non-interactive: all statements go in one request.
      const results = await db.transaction(statements.map(({ sql, params = [] }) => db.query(sql, params)));
      return results as Record<string, any>[][];
    },
  };
}
