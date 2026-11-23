import type { PGlite } from '@electric-sql/pglite';
import { postgresDialect, type SqlClient } from '@back/infrastructure/storage/sql/client';

/** SqlClient straight onto an embedded Postgres (test setup only). */
export function createPgliteClient(pg: PGlite): SqlClient {
  return {
    dialect: postgresDialect,
    query: async (sql, params = []) => (await pg.query(sql, params)).rows as any[],
    queryOne: async (sql, params = []) => ((await pg.query(sql, params)).rows[0] as any) ?? null,
    batch: (statements) => pg.transaction(async (tx) => {
      const results = [];
      for (const { sql, params = [] } of statements) results.push((await tx.query(sql, params)).rows as any[]);
      return results;
    }),
  };
}
