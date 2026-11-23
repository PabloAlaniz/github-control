import { vi } from 'vitest';

export const mockEnv = {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  GITHUB_TOKEN: 'ghp_test_token',
  CI_COVERAGE_TOKEN: 'test-ci-token',
  API_KEY: 'test-api-key',
  ENVIRONMENT: 'test',
  AUTH_USERNAME: 'admin',
  AUTH_PASSWORD: 'test-password',
  JWT_SECRET: 'test-jwt-secret-key',
  ASSETS: { fetch: vi.fn() },
};

import { createPostgresStorage } from '@back/infrastructure/storage/sql';
import type { AppContext } from '@back/application/context';

/** Service context backed by the Postgres adapter (whose SQL client the tests mock). */
export function ctxFor(config: any): AppContext {
  return { config, storage: createPostgresStorage(config) };
}

import { createStorage } from '@back/infrastructure/storage';
import type { Storage } from '@back/application/ports/storage';

/**
 * A config backed by a fresh in-memory storage, plus that storage. Requests
 * made with this env reach the same storage, so tests can seed and inspect it.
 */
export function memoryEnv(extra: Record<string, unknown> = {}): { env: any; storage: Storage } {
  const env = { ...mockEnv, STORAGE_DRIVER: 'memory', ...extra };
  return { env, storage: createStorage(env) };
}

/** Minimal repo record, as the GitHub refresh hands it to the store. */
export function repoRecord(fullName: string, extra: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split('/');
  return {
    full_name: fullName, owner, name, description: null, is_private: false, is_archived: false,
    language: 'TypeScript', default_branch: 'main', stars: 0, forks: 0, watchers: 0, open_issues: 0,
    repo_updated_at: '2026-01-01T00:00:00Z', ...extra,
  };
}
