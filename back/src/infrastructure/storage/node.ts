/**
 * Node-only storage drivers. Importing this module makes `sqlite`, `json`
 * and `csv` available to `createStorage`, and switches `postgres` to the
 * standard node-postgres driver with automatic migrations. The Cloudflare
 * Worker entry never imports it.
 */
import type { AppConfig } from '../../config';
import { registerStorageDriver } from './index';
import { createFileStorage, type FileFormat } from './file';
import { createSqlStorage } from './sql';
import { postgresDialect, sqliteDialect } from './sql/client';
import { withMigrations } from './sql/migrate';
import { createPgClient } from './sql/pg-client';
import { createSqliteClient } from './sql/sqlite-client';

function requirePath(config: AppConfig, driver: string): string {
  if (!config.STORAGE_PATH) throw new Error(`STORAGE_PATH is required when STORAGE_DRIVER is "${driver}"`);
  return config.STORAGE_PATH;
}

function fileDriver(format: FileFormat) {
  return (config: AppConfig) => createFileStorage({ dir: requirePath(config, format), format });
}

registerStorageDriver('json', fileDriver('json'));
registerStorageDriver('csv', fileDriver('csv'));

registerStorageDriver('sqlite', (config) => {
  const path = requirePath(config, 'sqlite');
  return createSqlStorage(withMigrations(() => createSqliteClient(path), sqliteDialect));
});

registerStorageDriver('postgres', (config) => {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required when STORAGE_DRIVER is "postgres"');
  return createSqlStorage(withMigrations(() => createPgClient(config.DATABASE_URL), postgresDialect));
});
