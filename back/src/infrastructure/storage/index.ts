/**
 * Storage composition: picks the adapter for the configured driver.
 *
 * This module is safe to bundle for any runtime. Adapters that need a
 * specific runtime (the file stores need Node's filesystem) register
 * themselves from their own entry module: see `./node`.
 */
import type { AppConfig, StorageDriver } from '../../config';
import type { Storage } from '../../application/ports/storage';
import { createMemoryStorage } from './memory';
import { createPostgresStorage } from './sql';

export type StorageFactory = (config: AppConfig) => Storage;

const factories: Partial<Record<StorageDriver, StorageFactory>> = {
  postgres: createPostgresStorage,
  memory: () => createMemoryStorage(),
};

export function registerStorageDriver(driver: StorageDriver, factory: StorageFactory): void {
  factories[driver] = factory;
}

const cache = new WeakMap<AppConfig, Storage>();

export function createStorage(config: AppConfig): Storage {
  const cached = cache.get(config);
  if (cached) return cached;

  const driver = config.STORAGE_DRIVER || 'postgres';
  const factory = factories[driver];
  if (!factory) {
    const available = Object.keys(factories).join(', ');
    throw new Error(`Unsupported STORAGE_DRIVER "${driver}". Available: ${available}`);
  }

  const storage = factory(config);
  cache.set(config, storage);
  return storage;
}
