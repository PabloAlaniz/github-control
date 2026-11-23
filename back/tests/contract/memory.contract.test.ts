import { describe, expect, it } from 'vitest';
import { createMemoryStorage, emptyState, type MemoryState } from '@back/infrastructure/storage/memory';
import { MemoryDb } from '@back/infrastructure/storage/memory/db';
import { describeStorageContract, ghRepo } from './storage-contract';

let state: MemoryState;

describeStorageContract('memory', {
  async fresh(snapshots = []) {
    state = emptyState();
    const db = new MemoryDb(state);
    snapshots.forEach((row) => db.insert('repo_metrics_history', row));
    return createMemoryStorage(state);
  },
});

describe('memory adapter specifics', () => {
  it('keeps its whole state in one JSON-serializable object', async () => {
    const original = emptyState();
    const storage = createMemoryStorage(original);
    await storage.repos.refreshFromGitHub([ghRepo('a')]);
    await storage.groups.createGroup('web', 'web');

    const restored = createMemoryStorage(JSON.parse(JSON.stringify(original)));
    expect(await restored.repos.getRepo('acme/a')).toEqual(await storage.repos.getRepo('acme/a'));
    const next = await restored.groups.createGroup('api', 'api');
    expect(next!.id).toBe(2); // id sequence survives the round-trip
  });

  it('notifies after every write and never after a read', async () => {
    let writes = 0;
    const storage = createMemoryStorage(emptyState(), { onChange: () => { writes++; } });
    await storage.repos.refreshFromGitHub([ghRepo('a')]);
    await storage.repos.updatePriority('acme/a', 'high');
    await storage.repos.listRepos();
    await storage.repos.getStats();
    expect(writes).toBe(2);
  });

  it('returns copies, so callers cannot mutate stored records', async () => {
    const storage = createMemoryStorage();
    await storage.repos.refreshFromGitHub([ghRepo('a')]);
    const repo = await storage.repos.getRepo('acme/a');
    repo!.blockers.push('tampered');
    repo!.stars = 999;
    expect(await storage.repos.getRepo('acme/a')).toMatchObject({ blockers: [], stars: 1 });
  });

  it('uses the injected clock', async () => {
    const storage = createMemoryStorage(emptyState(), { now: () => new Date('2030-05-06T07:08:09.000Z') });
    await storage.repos.refreshFromGitHub([ghRepo('a')]);
    expect((await storage.repos.getRepo('acme/a'))!.github_cached_at).toBe('2030-05-06T07:08:09.000Z');
  });
});
