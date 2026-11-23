import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock import.meta.env before importing auth module
vi.stubEnv('VITE_API_URL', '');

const { getToken, setToken, removeToken, isAuthenticated, login, logout } = await import('@/lib/auth');

describe('auth utilities', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    describe('token management', () => {
        it('getToken returns null when no token stored', () => {
            expect(getToken()).toBeNull();
        });

        it('setToken stores and getToken retrieves', () => {
            setToken('my-token');
            expect(getToken()).toBe('my-token');
        });

        it('removeToken clears the token', () => {
            setToken('my-token');
            removeToken();
            expect(getToken()).toBeNull();
        });
    });

    describe('isAuthenticated', () => {
        it('returns false when no token', () => {
            expect(isAuthenticated()).toBe(false);
        });

        it('returns false with malformed token', () => {
            setToken('not-a-jwt');
            expect(isAuthenticated()).toBe(false);
        });

        it('returns false with expired token', () => {
            // Create a fake JWT with expired exp
            const payload = { sub: 'admin', exp: Math.floor(Date.now() / 1000) - 3600 };
            const fakeJwt = `header.${btoa(JSON.stringify(payload))}.signature`;
            setToken(fakeJwt);
            expect(isAuthenticated()).toBe(false);
        });

        it('returns true with valid non-expired token', () => {
            const payload = { sub: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
            const fakeJwt = `header.${btoa(JSON.stringify(payload))}.signature`;
            setToken(fakeJwt);
            expect(isAuthenticated()).toBe(true);
        });
    });

    describe('login', () => {
        it('calls fetch and stores token on success', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ token: 'jwt-token-123', expiresIn: 86400 }),
            });
            vi.stubGlobal('fetch', mockFetch);

            await login('admin', 'password');

            expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'password' }),
            });
            expect(getToken()).toBe('jwt-token-123');
        });

        it('throws error on failed login', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                json: () => Promise.resolve({ error: 'Invalid credentials' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            await expect(login('admin', 'wrong')).rejects.toThrow('Invalid credentials');
            expect(getToken()).toBeNull();
        });

        it('throws generic error when response has no error field', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                json: () => Promise.reject(new Error('parse error')),
            });
            vi.stubGlobal('fetch', mockFetch);

            await expect(login('admin', 'wrong')).rejects.toThrow('Login failed');
        });
    });

    describe('logout', () => {
        it('removes the token', () => {
            setToken('some-token');
            logout();
            expect(getToken()).toBeNull();
        });
    });
});
