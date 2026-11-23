import { neon } from '@neondatabase/serverless';
import type { AppConfig } from '../../../config';
import type { Row } from '../../../application/ports/storage';

export function getDb(env: AppConfig) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL secret is not configured');
  }
  return neon(env.DATABASE_URL);
}

// Helper to run queries
export async function query<T = Row>(
  env: AppConfig,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const db = getDb(env);
  return db(sql, params) as Promise<T[]>;
}

// Helper for single row
export async function queryOne<T = Row>(
  env: AppConfig,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(env, sql, params);
  return rows[0] || null;
}
