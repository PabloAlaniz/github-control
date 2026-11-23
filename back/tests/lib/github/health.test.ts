import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../../helpers';

const mockGetContent = vi.fn();
const mockGetReadme = vi.fn();
const mockRepoGet = vi.fn();
const mockGetTree = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () { return {
    repos: {
      getContent: mockGetContent,
      getReadme: mockGetReadme,
      get: mockRepoGet,
    },
    git: {
      getTree: mockGetTree,
    },
  }; }),
}));

import { checkAppHealth, countFileLines, getRepoTree, computeCodeMetrics } from '@back/lib/github/health';

function b64(str: string): string {
  return Buffer.from(str).toString('base64');
}

describe('github/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoGet.mockResolvedValue({ data: { default_branch: 'main' } });
    mockGetTree.mockResolvedValue({ data: { tree: [] } });
  });

  describe('countFileLines', () => {
    it('returns line count from file content', async () => {
      mockGetContent.mockResolvedValueOnce({
        data: { content: b64('line1\nline2\nline3') },
      });

      const count = await countFileLines(mockEnv as any, 'owner', 'repo', 'src/index.ts');

      expect(count).toBe(3);
    });

    it('returns 0 when content is missing', async () => {
      mockGetContent.mockResolvedValueOnce({ data: {} });

      const count = await countFileLines(mockEnv as any, 'owner', 'repo', 'empty.ts');

      expect(count).toBe(0);
    });

    it('returns 0 on error', async () => {
      mockGetContent.mockRejectedValueOnce(new Error('Not found'));

      const count = await countFileLines(mockEnv as any, 'owner', 'repo', 'missing.ts');

      expect(count).toBe(0);
    });
  });

  describe('getRepoTree', () => {
    it('filters to code files excluding node_modules', async () => {
      mockGetTree.mockResolvedValue({
        data: {
          tree: [
            { path: 'src/index.ts', type: 'blob' },
            { path: 'node_modules/pkg/index.js', type: 'blob' },
            { path: 'src/utils', type: 'tree' },
            { path: 'README.md', type: 'blob' },
          ],
        },
      });

      const result = await getRepoTree(mockEnv as any, 'owner', 'repo');

      const paths = result.map(f => f.path);
      expect(paths).toContain('src/index.ts');
      expect(paths).not.toContain('node_modules/pkg/index.js');
      expect(paths).not.toContain('src/utils'); // tree, not blob
    });
  });

  describe('computeCodeMetrics', () => {
    it('counts only code files excluding node_modules and dist', () => {
      const tree = [
        { path: 'src/index.ts', type: 'blob', size: 4000 },
        { path: 'src/utils.py', type: 'blob', size: 2000 },
        { path: 'node_modules/pkg/index.js', type: 'blob', size: 800 },
        { path: 'dist/bundle.js', type: 'blob', size: 50000 },
        { path: 'src/types', type: 'tree' },
        { path: 'image.png', type: 'blob', size: 100000 },
      ];
      const metrics = computeCodeMetrics(tree);
      // src/index.ts: round(4000/35)=114, src/utils.py: round(2000/35)=57
      expect(metrics.fileCount).toBe(2);
      expect(metrics.estimatedLoc).toBe(Math.round(4000 / 35) + Math.round(2000 / 35));
    });

    it('scopes to sub-path for monorepo apps', () => {
      const tree = [
        { path: 'apps/web/index.ts', type: 'blob', size: 1050 },
        { path: 'apps/api/server.ts', type: 'blob', size: 2100 },
        { path: 'packages/shared/lib.ts', type: 'blob', size: 700 },
      ];
      const metrics = computeCodeMetrics(tree, 'apps/web');
      expect(metrics.fileCount).toBe(1);
      expect(metrics.estimatedLoc).toBe(Math.round(1050 / 35));
    });

    it('returns zeros for empty tree', () => {
      const metrics = computeCodeMetrics([]);
      expect(metrics.fileCount).toBe(0);
      expect(metrics.estimatedLoc).toBe(0);
    });

    it('handles missing size gracefully', () => {
      const tree = [{ path: 'src/index.ts', type: 'blob' }];
      const metrics = computeCodeMetrics(tree);
      expect(metrics.fileCount).toBe(1);
      expect(metrics.estimatedLoc).toBe(0);
    });

    it('excludes .github directory', () => {
      const tree = [
        { path: '.github/workflows/ci.yml', type: 'blob', size: 500 },
        { path: 'src/app.ts', type: 'blob', size: 3500 },
      ];
      const metrics = computeCodeMetrics(tree);
      expect(metrics.fileCount).toBe(1);
      expect(metrics.estimatedLoc).toBe(Math.round(3500 / 35));
    });
  });

  describe('checkAppHealth', () => {
    it('detects README, tests, CI, and stack for an app', async () => {
      // README exists
      mockGetContent
        .mockResolvedValueOnce({
          data: { content: b64('# Web App\nLine 2\nLine 3') },
        });

      // Test paths: first one found (tests/)
      mockGetContent
        .mockRejectedValueOnce(new Error('Not found'))  // test/
        .mockResolvedValueOnce({});                       // tests/

      // CI workflows
      mockGetContent.mockResolvedValueOnce({
        data: [
          { name: 'ci.yml', path: '.github/workflows/ci.yml' },
        ],
      });
      mockGetContent.mockResolvedValueOnce({
        data: { content: b64('jobs:\n  test:\n    run: cd apps/web && npm test') },
      });

      // Stack detection: package.json found
      mockGetContent.mockResolvedValueOnce({});

      // Tree for LOC
      mockGetTree.mockResolvedValue({
        data: { tree: [
          { path: 'apps/web/src/index.ts', type: 'blob' },
          { path: 'apps/web/src/app.ts', type: 'blob' },
        ] },
      });

      // countFileLines for each file
      mockGetContent
        .mockResolvedValueOnce({ data: { content: b64('line1\nline2') } })
        .mockResolvedValueOnce({ data: { content: b64('a\nb\nc') } });

      const result = await checkAppHealth(mockEnv as any, 'owner', 'repo', 'apps/web');

      expect(result.hasReadme).toBe(true);
      expect(result.readmeLines).toBe(3);
      expect(result.hasTests).toBe(true);
      expect(result.hasCi).toBe(true);
      expect(result.stack).toBe('node');
      expect(result.loc).toBe(5);
      expect(result.fileCount).toBe(2);
    });

    it('handles no README', async () => {
      mockGetContent.mockRejectedValueOnce(new Error('Not found'));

      // No test dirs
      for (let i = 0; i < 6; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found'));

      // No CI workflows
      mockGetContent.mockRejectedValueOnce(new Error('Not found'));

      // No stack config files (package.json, pyproject.toml, setup.py, requirements.txt, go.mod, Cargo.toml)
      for (let i = 0; i < 6; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found'));

      const result = await checkAppHealth(mockEnv as any, 'owner', 'repo', 'apps/api');

      expect(result.hasReadme).toBe(false);
      expect(result.readmeLines).toBe(0);
      expect(result.hasTests).toBe(false);
      expect(result.hasCi).toBe(false);
      expect(result.stack).toBeNull();
    });

    it('uses preloaded tree for LOC counting', async () => {
      mockGetContent.mockRejectedValueOnce(new Error('Not found')); // README
      for (let i = 0; i < 6; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found')); // tests
      mockGetContent.mockRejectedValueOnce(new Error('Not found')); // CI
      for (let i = 0; i < 5; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found')); // stack

      // LOC counting from preloaded tree
      mockGetContent.mockResolvedValueOnce({ data: { content: b64('a\nb') } });

      const preloadedTree = [
        { path: 'apps/web/index.ts', type: 'blob' },
        { path: 'apps/api/index.ts', type: 'blob' },
      ];

      const result = await checkAppHealth(mockEnv as any, 'owner', 'repo', 'apps/web', preloadedTree);

      expect(result.fileCount).toBe(1); // only apps/web/ paths
      // Should NOT have called getRepoTree since preloadedTree was provided
    });

    it('detects python stack', async () => {
      mockGetContent.mockRejectedValueOnce(new Error('Not found')); // README
      for (let i = 0; i < 6; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found')); // tests
      mockGetContent.mockRejectedValueOnce(new Error('Not found')); // CI

      // Stack: package.json not found, pyproject.toml found
      mockGetContent
        .mockRejectedValueOnce(new Error('Not found'))  // package.json
        .mockResolvedValueOnce({});                       // pyproject.toml

      const result = await checkAppHealth(mockEnv as any, 'owner', 'repo', 'ml');

      expect(result.stack).toBe('python');
    });

    it('detects go stack', async () => {
      mockGetContent.mockRejectedValueOnce(new Error('Not found')); // README
      for (let i = 0; i < 6; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found')); // tests
      mockGetContent.mockRejectedValueOnce(new Error('Not found')); // CI

      // Stack: package.json, pyproject.toml, setup.py not found, go.mod found
      mockGetContent
        .mockRejectedValueOnce(new Error('Not found'))  // package.json
        .mockRejectedValueOnce(new Error('Not found'))  // pyproject.toml
        .mockRejectedValueOnce(new Error('Not found'))  // setup.py
        .mockRejectedValueOnce(new Error('Not found'))  // requirements.txt
        .mockResolvedValueOnce({});                       // go.mod

      const result = await checkAppHealth(mockEnv as any, 'owner', 'repo', 'backend');

      expect(result.stack).toBe('go');
    });

    it('detects CI that does not mention app path', async () => {
      mockGetContent.mockRejectedValueOnce(new Error('Not found')); // README
      for (let i = 0; i < 6; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found')); // tests

      // CI workflows exist but don't mention app path
      mockGetContent.mockResolvedValueOnce({
        data: [{ name: 'ci.yml', path: '.github/workflows/ci.yml' }],
      });
      mockGetContent.mockResolvedValueOnce({
        data: { content: b64('jobs:\n  test:\n    run: npm test') }, // no "apps/web"
      });

      for (let i = 0; i < 5; i++) mockGetContent.mockRejectedValueOnce(new Error('Not found')); // stack

      const result = await checkAppHealth(mockEnv as any, 'owner', 'repo', 'apps/web');

      expect(result.hasCi).toBe(false);
    });
  });
});
