import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

// Mock DB client
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: vi.fn(),
}));

// Mock GitHub lib
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
  calculateDocsQuality: vi.fn(),
  detectRepoApps: vi.fn(),
  getRepoTree: vi.fn(),
  checkAppHealth: vi.fn(),
  countFileLines: vi.fn(),
  computeCodeMetrics: vi.fn(),
  countLocFromTarball: vi.fn(),
  getOctokit: vi.fn(),
}));

vi.mock('@back/lib/analyzers/pipeline', () => ({
  runPipeline: vi.fn(),
  runAppPipeline: vi.fn(),
}));

vi.mock('@back/lib/analyzers/github-enricher', () => ({
  enrichFromGitHub: vi.fn(),
}));

// Mock services
const mockSyncRepoHealth = vi.fn();
const mockDetectAndPersistApps = vi.fn();
vi.mock('@back/services/health-sync.service', () => ({
  syncRepoHealth: (...args: any[]) => mockSyncRepoHealth(...args),
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) { super(msg); this.name = 'NotFoundError'; }
  },
}));
vi.mock('@back/services/app-detection.service', () => ({
  detectAndPersistApps: (...args: any[]) => mockDetectAndPersistApps(...args),
}));

import app from '@back/index';

function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  return app.request(path, { ...options, headers }, mockEnv);
}

describe('health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /detect-apps ────────────────────────

  describe('POST /api/repos/:owner/:repo/detect-apps', () => {
    it('detects and returns apps', async () => {
      mockDetectAndPersistApps.mockResolvedValueOnce({
        repo: 'owner/repo', detected: 2, persisted: false,
        apps: [{ app_name: 'web' }, { app_name: 'api' }],
      });

      const res = await request('/api/repos/owner/repo/detect-apps', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.detected).toBe(2);
    });

    it('persists apps when persist=true', async () => {
      mockDetectAndPersistApps.mockResolvedValueOnce({
        repo: 'owner/repo', detected: 1, persisted: true, apps: [],
      });

      const res = await request('/api/repos/owner/repo/detect-apps?persist=true', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(mockDetectAndPersistApps).toHaveBeenCalledWith(
        expect.anything(), 'owner', 'repo', true,
      );
    });

    it('returns 500 on error', async () => {
      mockDetectAndPersistApps.mockRejectedValueOnce(new Error('GitHub API error'));

      const res = await request('/api/repos/owner/repo/detect-apps', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('GitHub API error');
    });
  });

  // ── POST /health (manual) ────────────────────

  describe('POST /api/repos/:owner/:repo/health', () => {
    it('updates health manually', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repos/owner/repo/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_ci: true, has_tests: false }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });
});
