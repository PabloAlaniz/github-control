import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryEnv, mockEnv } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';

let env: any;
let storage: Storage;
const request = (path: string, init: RequestInit = {}) => app.request(path, {
  ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json', ...init.headers },
}, env);
const post = (body: unknown) => request('/api/saved-views', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('saved views routes', () => {
  beforeEach(() => {
    ({ env, storage } = memoryEnv());
  });

  it('requires auth', async () => {
    expect((await app.request('/api/saved-views', {}, env)).status).toBe(401);
  });

  it('lists views by name', async () => {
    await storage.savedViews.upsertSavedView('stale', 'stale=1');
    await storage.savedViews.upsertSavedView('Prod without CI', 'health=needs-ci&groups=prod');

    const body = await (await request('/api/saved-views')).json();

    expect(body.map((v: any) => [v.name, v.query])).toEqual([
      ['Prod without CI', 'health=needs-ci&groups=prod'], ['stale', 'stale=1'],
    ]);
  });

  describe('POST /api/saved-views', () => {
    it('creates a view and overwrites the one with the same name', async () => {
      const created = await (await post({ name: 'Stale', query: 'stale=1' })).json();
      expect(created).toMatchObject({ success: true, view: { name: 'Stale', query: 'stale=1' } });

      const replaced = await (await post({ name: 'Stale', query: 'stale=1&vis=private' })).json();
      expect(replaced.view).toMatchObject({ id: created.view.id, query: 'stale=1&vis=private' });
      expect(await storage.savedViews.listSavedViews()).toHaveLength(1);
    });

    it('trims the name, strips a leading "?" and defaults to the empty (default) view', async () => {
      await post({ name: '  Private  ', query: '?vis=private' });
      await post({ name: 'All' });

      expect((await storage.savedViews.listSavedViews()).map(v => [v.name, v.query])).toEqual([
        ['All', ''], ['Private', 'vis=private'],
      ]);
    });

    it.each([
      ['missing name', { query: 'stale=1' }],
      ['blank name', { name: '   ', query: '' }],
      ['name too long', { name: 'x'.repeat(81), query: '' }],
      ['query too long', { name: 'ok', query: 'q='.padEnd(2001, 'x') }],
    ])('rejects %s', async (_label, payload) => {
      expect((await post(payload)).status).toBe(400);
      expect(await storage.savedViews.listSavedViews()).toEqual([]);
    });

    it('rejects invalid JSON', async () => {
      const res = await post('{not json');
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Invalid JSON body');
    });
  });

  describe('DELETE /api/saved-views/:id', () => {
    it('deletes a view, and reports a missing one', async () => {
      const view = await storage.savedViews.upsertSavedView('Stale', 'stale=1');

      expect((await request(`/api/saved-views/${view.id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await request(`/api/saved-views/${view.id}`, { method: 'DELETE' })).status).toBe(404);
      expect(await storage.savedViews.listSavedViews()).toEqual([]);
    });

    it('rejects a non-numeric id', async () => {
      expect((await request('/api/saved-views/abc', { method: 'DELETE' })).status).toBe(400);
    });
  });

  describe('configuration export / import', () => {
    it('carries saved views, and accepts exports made before they existed', async () => {
      await storage.savedViews.upsertSavedView('Stale', 'stale=1');
      const exported = await (await request('/api/export')).json();
      expect(exported.saved_views).toEqual([{ name: 'Stale', query: 'stale=1' }]);

      const other = memoryEnv();
      const imported = await app.request('/api/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(exported),
      }, other.env);
      expect((await imported.json()).summary.saved_views_upserted).toBe(1);
      expect((await other.storage.savedViews.listSavedViews()).map(v => v.name)).toEqual(['Stale']);

      const legacy = await request('/api/import', { method: 'POST', body: JSON.stringify({ version: 1 }) });
      expect((await legacy.json()).summary.saved_views_upserted).toBe(0);
    });
  });
});
