import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sign } from 'hono/jwt';
import { mockEnv } from '../helpers';

// Mock DB client (required by app imports)
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Mock GitHub lib (required by app imports)
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getAllOpenPRs: vi.fn().mockResolvedValue([]),
}));

import app from '@back/index';
import { loginLimiter } from '@back/routes/auth';

function request(path: string, options?: RequestInit) {
  return app.request(path, options, mockEnv);
}

function authRequest(path: string, token: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return app.request(path, { ...options, headers }, mockEnv);
}

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/auth/login', () => {
    it('returns JWT on successful login', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'test-password' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
      expect(body.expiresIn).toBe(86400);
    });

    it('returns 401 with wrong password', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong' }),
      });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toContain('Invalid credentials');
    });

    it('returns 401 with wrong username', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'wrong', password: 'test-password' }),
      });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toContain('Invalid credentials');
    });

    it('returns 400 when fields are missing', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('required');
    });

    it('returns 400 when body is invalid JSON', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('required');
    });

    it('does not require Authorization header', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'test-password' }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 500 when JWT_SECRET is not configured', async () => {
      const envNoSecret = { ...mockEnv, JWT_SECRET: '' };
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'test-password' }),
      }, envNoSecret);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('JWT_SECRET');
    });
  });

  describe('JWT authentication on protected routes', () => {
    it('allows access with valid JWT', async () => {
      // First login to get a token
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'test-password' }),
      });
      const { token } = await loginRes.json();

      // Use JWT to access protected route
      const res = await authRequest('/api/health', token);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
    });

    it('rejects expired JWT', async () => {
      // Create a token that expired 1 hour ago
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await sign(
        { sub: 'admin', iat: now - 7200, exp: now - 3600 },
        mockEnv.JWT_SECRET
      );

      const res = await authRequest('/api/stats', expiredToken);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBeDefined();
    });

    it('rejects JWT signed with wrong secret', async () => {
      const now = Math.floor(Date.now() / 1000);
      const badToken = await sign(
        { sub: 'admin', iat: now, exp: now + 3600 },
        'wrong-secret'
      );

      const res = await authRequest('/api/stats', badToken);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBeDefined();
    });
  });

  describe('sign-in attempt limit', () => {
    const attempt = (password: string, ip = '203.0.113.7') => app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ username: 'admin', password }),
    }, mockEnv);

    beforeEach(() => loginLimiter.reset());

    it('blocks a client after 10 failures, even with the right password', async () => {
      for (let i = 0; i < 10; i++) expect((await attempt('wrong')).status).toBe(401);

      const blocked = await attempt('test-password');
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);

      // Other clients are unaffected.
      expect((await attempt('test-password', '198.51.100.9')).status).toBe(200);
    });

    it('forgets earlier failures after a successful sign-in', async () => {
      for (let i = 0; i < 9; i++) await attempt('wrong');
      expect((await attempt('test-password')).status).toBe(200);
      for (let i = 0; i < 9; i++) expect((await attempt('wrong')).status).toBe(401);
      expect((await attempt('test-password')).status).toBe(200);
    });
  });
});
