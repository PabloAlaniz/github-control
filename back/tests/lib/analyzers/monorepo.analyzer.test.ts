import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockReaddirSync = vi.fn();
vi.mock('node:fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  readdirSync: (...args: any[]) => mockReaddirSync(...args),
}));

import { analyzeMonorepo } from '@back/lib/analyzers/monorepo.analyzer';

describe('monorepo.analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Path-only detection (API mode) ────────────

  describe('path-only detection', () => {
    it('detects monorepo with pnpm-workspace.yaml', () => {
      const result = analyzeMonorepo({
        paths: ['pnpm-workspace.yaml', 'apps/web/package.json', 'apps/api/package.json'],
        language: null,
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.apps.length).toBeGreaterThanOrEqual(2);
    });

    it('detects monorepo with lerna.json', () => {
      const result = analyzeMonorepo({
        paths: ['lerna.json', 'packages/ui/package.json', 'packages/utils/package.json'],
        language: null,
      });

      expect(result.isMonorepo).toBe(true);
    });

    it('detects monorepo from multiple nested package.json', () => {
      const result = analyzeMonorepo({
        paths: [
          'package.json',
          'apps/web/package.json',
          'apps/api/package.json',
          'packages/ui/package.json',
        ],
        language: null,
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.apps.length).toBe(3);
      expect(result.apps[0].detectionSource).toBe('path_analysis');
    });

    it('detects mixed stacks from config files', () => {
      const result = analyzeMonorepo({
        paths: [
          'package.json',
          'front/package.json',
          'back/go.mod',
          'ml/pyproject.toml',
        ],
        language: null,
      });

      expect(result.isMonorepo).toBe(true);
      const stacks = result.apps.map(a => a.stack);
      expect(stacks).toContain('node');
      expect(stacks).toContain('go');
      expect(stacks).toContain('python');
    });

    it('deduplicates apps with same path', () => {
      const result = analyzeMonorepo({
        paths: [
          'apps/web/package.json',
          'apps/web/tsconfig.json',
          'apps/api/package.json',
        ],
        language: null,
      });

      const webApps = result.apps.filter(a => a.appPath === 'apps/web');
      expect(webApps).toHaveLength(1);
    });

    it('returns not monorepo for simple repo', () => {
      const result = analyzeMonorepo({
        paths: ['package.json', 'src/index.ts', 'README.md'],
        language: 'TypeScript',
      });

      expect(result.isMonorepo).toBe(false);
      expect(result.apps).toHaveLength(0);
    });

    it('detects nested Cargo.toml as rust app', () => {
      const result = analyzeMonorepo({
        paths: ['Cargo.toml', 'crates/core/Cargo.toml', 'crates/cli/Cargo.toml'],
        language: 'Rust',
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.apps.every(a => a.stack === 'rust')).toBe(true);
    });
  });

  // ── Filesystem-based detection (cloneDir) ─────

  describe('filesystem-based detection', () => {
    it('detects monorepo from pnpm-workspace.yaml', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('pnpm-workspace.yaml')) return true;
        if (p.endsWith('/apps')) return true; // base dir for pattern resolution
        if (p.includes('apps/web/package.json')) return true; // stack detection
        if (p.includes('apps/api/package.json')) return true; // stack detection
        return false;
      });
      mockReadFileSync.mockReturnValue("packages:\n  - 'apps/*'\n");
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.endsWith('/apps')) {
          return [
            { name: 'web', isDirectory: () => true },
            { name: 'api', isDirectory: () => true },
          ];
        }
        return [];
      });

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.apps.length).toBeGreaterThanOrEqual(2);
      expect(result.apps[0].detectionSource).toBe('pnpm_workspace');
    });

    it('falls back to package.json workspaces (array form)', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('pnpm-workspace.yaml')) return false;
        if (p.includes('package.json') && !p.includes('/')) return true;
        if (p.endsWith('/tmp/repo/package.json')) return true;
        // workspace base dirs
        if (p.endsWith('/tmp/repo/packages')) return true;
        // stack detection for subdirs
        if (p.includes('packages/ui/package.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        workspaces: ['packages/*'],
      }));
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.includes('packages') && !p.includes('packages/')) {
          return [
            { name: 'ui', isDirectory: () => true },
            { name: '.DS_Store', isDirectory: () => false },
          ];
        }
        return [];
      });

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.apps[0].detectionSource).toBe('package_json_workspaces');
    });

    it('handles package.json with {packages} form', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('pnpm-workspace.yaml')) return false;
        if (p.endsWith('/tmp/repo/package.json')) return true;
        if (p.endsWith('/tmp/repo/apps')) return true;
        if (p.includes('apps/web/package.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        workspaces: { packages: ['apps/*'] },
      }));
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.endsWith('apps')) {
          return [{ name: 'web', isDirectory: () => true }];
        }
        return [];
      });

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.apps[0].appName).toBe('web');
    });

    it('auto-detects standalone root-level apps', () => {
      // No workspace configs
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('pnpm-workspace.yaml')) return false;
        if (p.endsWith('/tmp/repo/package.json')) return false;
        // standalone dir detection
        if (p.includes('backend/go.mod')) return true;
        if (p.includes('frontend/package.json')) return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === '/tmp/repo') {
          return [
            { name: 'backend', isDirectory: () => true },
            { name: 'frontend', isDirectory: () => true },
            { name: 'docs', isDirectory: () => true }, // should be skipped (SKIP_DIRS)
            { name: '.github', isDirectory: () => true }, // should be skipped
            { name: 'README.md', isDirectory: () => false }, // should be skipped (not dir)
          ];
        }
        return [];
      });

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.isMonorepo).toBe(true);
      expect(result.apps).toHaveLength(2);
      expect(result.apps.find(a => a.appName === 'backend')?.stack).toBe('go');
      expect(result.apps.find(a => a.appName === 'frontend')?.stack).toBe('node');
    });

    it('skips standalone dirs without recognized config', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('pnpm-workspace.yaml')) return false;
        if (p.endsWith('/tmp/repo/package.json')) return false;
        // No config files in any subdir
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === '/tmp/repo') {
          return [{ name: 'misc', isDirectory: () => true }];
        }
        return [];
      });

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.isMonorepo).toBe(false);
      expect(result.apps).toHaveLength(0);
    });

    it('handles read errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => { throw new Error('EACCES'); });
      mockReaddirSync.mockImplementation(() => { throw new Error('EACCES'); });

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.isMonorepo).toBe(false);
      expect(result.apps).toHaveLength(0);
    });

    it('handles invalid package.json', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('pnpm-workspace.yaml')) return false;
        if (p.endsWith('/tmp/repo/package.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue('not valid json {{{');
      mockReaddirSync.mockReturnValue([]);

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.isMonorepo).toBe(false);
    });

    it('handles non-existent workspace base dir', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('pnpm-workspace.yaml')) return true;
        if (p.includes('apps')) return false; // base dir doesn't exist
        return false;
      });
      mockReadFileSync.mockReturnValue("packages:\n  - 'apps/*'\n");
      mockReaddirSync.mockReturnValue([]);

      const result = analyzeMonorepo({
        paths: [],
        language: null,
        cloneDir: '/tmp/repo',
      });

      // Has patterns but no resolved apps
      expect(result.isMonorepo).toBe(true); // patterns.length > 0
      expect(result.apps).toHaveLength(0);
    });
  });
});
