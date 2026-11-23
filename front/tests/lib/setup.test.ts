import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSetupStatus, submitSetup } from '@/lib/setup';

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe('fetchSetupStatus', () => {
  it('returns the wizard data while the server is not configured', async () => {
    const status = { configured: false, needs: { storage: true, github: true, admin: true }, storageOptions: [] };
    vi.stubGlobal('fetch', respond(200, status));
    expect(await fetchSetupStatus()).toEqual(status);
  });

  it('treats errors, odd payloads and network failures as configured', async () => {
    vi.stubGlobal('fetch', respond(401, { error: 'nope' }));
    expect(await fetchSetupStatus()).toEqual({ configured: true, authRequired: true });
    vi.stubGlobal('fetch', respond(200, { hello: 'world' }));
    expect(await fetchSetupStatus()).toEqual({ configured: true, authRequired: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchSetupStatus()).toEqual({ configured: true, authRequired: true });
    vi.stubGlobal('fetch', respond(200, { configured: true, authRequired: false }));
    expect(await fetchSetupStatus()).toEqual({ configured: true, authRequired: false });
  });
});

describe('submitSetup', () => {
  it('posts the answers and returns the result', async () => {
    const fetchMock = respond(200, { ok: true, githubLogin: 'octocat' });
    vi.stubGlobal('fetch', fetchMock);
    const answers = { setupCode: 'c', storage: { driver: 'json' } };
    expect(await submitSetup(answers)).toMatchObject({ githubLogin: 'octocat' });
    expect(fetchMock).toHaveBeenCalledWith('/api/setup', expect.objectContaining({
      method: 'POST', body: JSON.stringify(answers),
    }));
  });

  it('raises the server message with field details', async () => {
    vi.stubGlobal('fetch', respond(400, {
      error: 'Invalid setup data',
      details: { fieldErrors: { admin: ['Password must be at least 8 characters'] } },
    }));
    await expect(submitSetup({ setupCode: 'c' })).rejects.toThrow(
      'Invalid setup data: Password must be at least 8 characters',
    );
  });
});
