import { describe, it, expect } from 'vitest';
import { createStorage } from '@back/infrastructure/storage';

const base: any = { DATABASE_URL: 'postgresql://test', GITHUB_TOKEN: 'ghp_test' };

describe('createStorage', () => {
  it('defaults to the postgres adapter and exposes every store', () => {
    const storage = createStorage({ ...base });
    expect(Object.keys(storage).sort()).toEqual([
      'activity', 'admin', 'apps', 'coverage', 'groups', 'health',
      'meta', 'metrics', 'repos', 'savedViews', 'serviceChecks', 'services', 'signals', 'traffic',
    ]);
    expect(typeof storage.repos.listRepos).toBe('function');
  });

  it('reuses the storage for the same config object', () => {
    const config = { ...base, STORAGE_DRIVER: 'postgres' };
    expect(createStorage(config)).toBe(createStorage(config));
  });

  it('creates an in-memory storage per config', async () => {
    const config = { ...base, STORAGE_DRIVER: 'memory' };
    await createStorage(config).groups.createGroup('web', 'web');
    expect(await createStorage(config).groups.listGroups()).toHaveLength(1);
    expect(await createStorage({ ...config }).groups.listGroups()).toHaveLength(0);
  });

  it('rejects drivers that have no adapter yet', () => {
    expect(() => createStorage({ ...base, STORAGE_DRIVER: 'csv' })).toThrow(/Unsupported STORAGE_DRIVER "csv"/);
  });
});
