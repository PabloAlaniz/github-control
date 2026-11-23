/**
 * SqlClient over node-postgres: any standard Postgres server (a local
 * container, a managed instance, Neon over TCP). Node only.
 */
import pg from 'pg';
import type { Row } from '../../../application/ports/storage';
import { postgresDialect, type SqlClient, type Statement } from './client';

export function createPgClient(connectionString: string): SqlClient & { close(): Promise<void> } {
  const pool = new pg.Pool({ connectionString, max: 5 });

  return {
    dialect: postgresDialect,
    async query<T = Row>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async queryOne<T = Row>(sql: string, params: unknown[] = []) {
      return ((await pool.query(sql, params)).rows[0] as T) ?? null;
    },
    async batch(statements: Statement[]) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const results: Row[][] = [];
        for (const { sql, params = [] } of statements) {
          results.push((await connection.query(sql, params)).rows);
        }
        await connection.query('COMMIT');
        return results;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}
