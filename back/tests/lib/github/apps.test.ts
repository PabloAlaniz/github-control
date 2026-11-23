import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../../helpers';

const mockGetContent = vi.fn();
const mockRepoGet = vi.fn();
const mockGetTree = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () { return {
    repos: {
      getContent: mockGetContent,
      get: mockRepoGet,
    },
    git: {
      getTree: mockGetTree,
    },
  }; }),
}));

import { detectRepoApps } from '@back/lib/github/apps';

function b64(str: string): string {
  return Buffer.from(str).toString('base64');
}

describe('detectRepoApps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: repos.get and getTree for getRepoTree
    mockRepoGet.mockResolvedValue({ data: { default_branch: 'main' } });
    mockGetTree.mockResolvedValue({ data: { tree: [] } });
  });

  it('detects apps from pnpm-workspace.yaml', async () => {
    // pnpm-workspace.yaml exists
    mockGetContent
      .mockResolvedValueOnce({
        data: { content: b64("packages:\n  - 'apps/*'\n") },
      });

    // getRepoTree paths
    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { path: 'apps/web/package.json', type: 'blob' },
          { path: 'apps/web/src/index.ts', type: 'blob' },
          { path: 'apps/api/package.json', type: 'blob' },
        ],
      },
    });

    // Root listing (standalone detection) — no extra dirs
    mockGetContent.mockResolvedValueOnce({ data: [] });

    const result = await detectRepoApps(mockEnv as any, 'owner', 'repo');

    expect(result.length).toBe(2);
    expect(result.map(a => a.app_name)).toContain('web');
    expect(result.map(a => a.app_name)).toContain('api');
    expect(result[0].detection_source).toBe('pnpm_workspace');
  });

  it('falls back to package.json workspaces', async () => {
    // pnpm-workspace.yaml not found
    mockGetContent
      .mockRejectedValueOnce(new Error('Not found'))
      // package.json
      .mockResolvedValueOnce({
        data: { content: b64(JSON.stringify({ workspaces: ['packages/*'] })) },
      });

    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { path: 'packages/ui/index.ts', type: 'blob' },
          { path: 'packages/core/index.ts', type: 'blob' },
        ],
      },
    });

    // Root listing
    mockGetContent.mockResolvedValueOnce({ data: [] });

    const result = await detectRepoApps(mockEnv as any, 'owner', 'repo');

    expect(result.length).toBe(2);
    expect(result.map(a => a.app_name)).toContain('ui');
    expect(result.map(a => a.app_name)).toContain('core');
  });

  it('handles package.json with {packages} form', async () => {
    mockGetContent
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce({
        data: { content: b64(JSON.stringify({ workspaces: { packages: ['apps/*'] } })) },
      });

    mockGetTree.mockResolvedValue({
      data: { tree: [{ path: 'apps/front/index.js', type: 'blob' }] },
    });

    mockGetContent.mockResolvedValueOnce({ data: [] });

    const result = await detectRepoApps(mockEnv as any, 'owner', 'repo');

    expect(result.length).toBe(1);
    expect(result[0].app_name).toBe('front');
  });

  it('detects standalone root-level apps', async () => {
    // No workspace files
    mockGetContent
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'));

    // Root listing returns dirs
    mockGetContent.mockResolvedValueOnce({
      data: [
        { name: 'backend', type: 'dir' },
        { name: 'frontend', type: 'dir' },
        { name: 'docs', type: 'dir' },        // skipped
        { name: '.github', type: 'dir' },      // skipped
        { name: 'README.md', type: 'file' },   // not dir
      ],
    });

    // Check config files for backend: go.mod found
    mockGetContent
      .mockRejectedValueOnce(new Error('Not found'))  // backend/package.json
      .mockRejectedValueOnce(new Error('Not found'))  // backend/pyproject.toml
      .mockRejectedValueOnce(new Error('Not found'))  // backend/setup.py
      .mockResolvedValueOnce({ data: {} })             // backend/go.mod ← found
      // Check config files for frontend: package.json found
      .mockResolvedValueOnce({ data: {} });            // frontend/package.json

    const result = await detectRepoApps(mockEnv as any, 'owner', 'repo');

    expect(result.length).toBe(2);
    expect(result.find(a => a.app_name === 'backend')?.stack).toBe('go');
    expect(result.find(a => a.app_name === 'frontend')?.stack).toBe('node');
    expect(result[0].detection_source).toBe('auto');
  });

  it('returns empty when no apps detected', async () => {
    mockGetContent
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'));

    // Root listing has no app-like dirs
    mockGetContent.mockResolvedValueOnce({
      data: [
        { name: 'src', type: 'dir' },
        { name: 'README.md', type: 'file' },
      ],
    });

    // src has no config files
    mockGetContent
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'));

    const result = await detectRepoApps(mockEnv as any, 'owner', 'repo');

    expect(result.length).toBe(0);
  });

  it('handles root listing failure gracefully', async () => {
    mockGetContent
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('API error'));

    const result = await detectRepoApps(mockEnv as any, 'owner', 'repo');

    expect(result).toEqual([]);
  });
});
