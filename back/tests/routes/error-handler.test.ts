import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { mockEnv } from '../helpers';

const mockQuery = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import { onError } from '@back/lib/error-handler';

const auth = { Authorization: `Bearer ${mockEnv.API_KEY}` };
const LEAKY = 'connect ECONNREFUSED postgresql://user:secret@db.example.com/prod';

describe('error handling', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('answers an unhandled error with a generic 500 and logs the detail', async () => {
    mockQuery.mockRejectedValue(new Error(LEAKY));

    const res = await app.request('/api/groups', { headers: auth }, mockEnv);

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('ECONNREFUSED');
    expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
    expect(consoleError).toHaveBeenCalled();
  });

  it('keeps the response shape of routes that catch storage errors themselves', async () => {
    mockQuery.mockRejectedValue(new Error(LEAKY));

    const activity = await app.request('/api/activity', { headers: auth }, mockEnv);
    expect(activity.status).toBe(500);
    expect(await activity.json()).toEqual({ error: 'Internal server error', activities: [] });

    const metrics = await app.request('/api/metrics/aggregate', { headers: auth }, mockEnv);
    expect(metrics.status).toBe(500);
    const body = await metrics.text();
    expect(body).not.toContain('secret');
    expect(JSON.parse(body).error).toBe('Internal server error');
  });

  describe('HTTPException', () => {
    const mini = new Hono();
    mini.onError(onError);
    mini.get('/forbidden', () => { throw new HTTPException(403, { message: 'Not allowed' }); });
    mini.get('/custom', () => { throw new HTTPException(401, { res: new Response('nope', { status: 401 }) }); });
    mini.get('/bad-gateway', () => { throw new HTTPException(502, { message: LEAKY }); });

    it('keeps the status and message of a 4xx, without logging', async () => {
      const res = await mini.request('/forbidden');
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Not allowed' });
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('returns the response an exception carries', async () => {
      const res = await mini.request('/custom');
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('nope');
    });

    it('hides the message of a 5xx', async () => {
      const res = await mini.request('/bad-gateway');
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal server error' });
    });
  });
});
