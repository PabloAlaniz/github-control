import { describe, it, expect, vi } from 'vitest';
import { analyzeStandards, collectStandards } from '@back/lib/signals/standards';
import { isUnavailable, createSignalContext } from '@back/lib/signals';

const check = (result: ReturnType<typeof analyzeStandards>, key: string) =>
  result.checks.find(c => c.key === key)!;

describe('analyzeStandards', () => {
  it('passes everything for a well-kept public repo', () => {
    const result = analyzeStandards({
      description: 'A thing',
      topics: ['cli'],
      license: 'MIT',
      isPrivate: false,
      paths: ['README.md', '.github/CODEOWNERS', 'SECURITY.md', 'docs/CONTRIBUTING.md', 'src/index.ts'],
      defaultBranchProtected: true,
    });
    expect(result.passed).toBe(7);
    expect(result.total).toBe(7);
    expect(result.checks.every(c => c.passed)).toBe(true);
  });

  it('fails everything for a bare public repo', () => {
    const result = analyzeStandards({
      description: '  ', topics: [], license: null, isPrivate: false, paths: [], defaultBranchProtected: false,
    });
    expect(result.passed).toBe(0);
    expect(result.total).toBe(7);
  });

  it('does not count license, security and contributing for private repos', () => {
    const result = analyzeStandards({
      description: 'x', topics: ['a'], isPrivate: true, paths: ['CODEOWNERS'], defaultBranchProtected: true,
    });
    expect(result).toMatchObject({ passed: 4, total: 4 });
    for (const key of ['license', 'security', 'contributing']) {
      expect(check(result, key).applicable).toBe(false);
    }
  });

  it('treats unknown visibility as not public', () => {
    const result = analyzeStandards({ paths: [] });
    expect(check(result, 'license').applicable).toBe(false);
  });

  it('leaves unknown branch protection out of the total', () => {
    const result = analyzeStandards({ description: 'x', topics: ['a'], isPrivate: true, paths: [], defaultBranchProtected: null });
    expect(check(result, 'branchProtection').passed).toBeNull();
    expect(result).toMatchObject({ passed: 2, total: 3 });
  });

  it('accepts a LICENSE file when the API reports no license', () => {
    const base = { isPrivate: false, license: null };
    expect(check(analyzeStandards({ ...base, paths: ['LICENSE'] }), 'license').passed).toBe(true);
    expect(check(analyzeStandards({ ...base, paths: ['LICENCE.md'] }), 'license').passed).toBe(true);
    expect(check(analyzeStandards({ ...base, paths: ['COPYING'] }), 'license').passed).toBe(true);
    expect(check(analyzeStandards({ ...base, paths: ['license-checker.js'] }), 'license').passed).toBe(false);
  });

  it('only looks for community files in root, .github and docs', () => {
    const at = (path: string) => check(analyzeStandards({ isPrivate: false, paths: [path] }), 'security').passed;
    expect(at('SECURITY.md')).toBe(true);
    expect(at('.github/SECURITY.md')).toBe(true);
    expect(at('docs/security.md')).toBe(true);
    expect(at('packages/api/SECURITY.md')).toBe(false);
    expect(at('docs/guides/SECURITY.md')).toBe(false);
  });

  it('matches CODEOWNERS exactly', () => {
    const at = (path: string) => check(analyzeStandards({ paths: [path] }), 'codeowners').passed;
    expect(at('docs/CODEOWNERS')).toBe(true);
    expect(at('CODEOWNERS.bak')).toBe(false);
  });
});

describe('collectStandards', () => {
  const repoData = {
    default_branch: 'main', description: 'desc', topics: ['a'], private: false, license: { spdx_id: 'MIT' },
  };
  const fakeOctokit = (overrides: Record<string, any> = {}) => ({
    repos: {
      get: vi.fn().mockResolvedValue({ data: repoData }),
      getBranch: vi.fn().mockResolvedValue({ data: { protected: true } }),
      ...overrides.repos,
    },
    git: {
      getTree: vi.fn().mockResolvedValue({ data: { tree: [{ path: 'SECURITY.md' }, { path: 'CODEOWNERS' }, {}] } }),
      ...overrides.git,
    },
  }) as any;

  it('combines repo metadata, tree and branch protection', async () => {
    const octokit = fakeOctokit();
    const result: any = await collectStandards(createSignalContext(octokit, 'me', 'api'));

    expect(result).toMatchObject({ passed: 6, total: 7 });
    expect(octokit.git.getTree).toHaveBeenCalledWith({ owner: 'me', repo: 'api', tree_sha: 'main', recursive: 'true' });
    expect(octokit.repos.getBranch).toHaveBeenCalledWith({ owner: 'me', repo: 'api', branch: 'main' });
  });

  it('handles an empty repo and unreadable branch protection', async () => {
    const octokit = fakeOctokit({
      git: { getTree: vi.fn().mockRejectedValue({ status: 409 }) },
      repos: { getBranch: vi.fn().mockRejectedValue({ status: 404 }) },
    });
    const result: any = await collectStandards(createSignalContext(octokit, 'me', 'empty'));

    expect(result.checks.find((c: any) => c.key === 'branchProtection').passed).toBeNull();
    expect(result.checks.find((c: any) => c.key === 'codeowners').passed).toBe(false);
  });

  it('handles a repo without license info or protection flag', async () => {
    const octokit = fakeOctokit({
      repos: {
        get: vi.fn().mockResolvedValue({ data: { ...repoData, license: null } }),
        getBranch: vi.fn().mockResolvedValue({ data: {} }),
      },
    });
    const result: any = await collectStandards(createSignalContext(octokit, 'me', 'api'));
    expect(result.checks.find((c: any) => c.key === 'license').passed).toBe(false);
  });

  it('propagates unexpected errors', async () => {
    const boom = { status: 500, message: 'boom' };
    await expect(collectStandards(createSignalContext(
      fakeOctokit({ git: { getTree: vi.fn().mockRejectedValue(boom) } }), 'me', 'api',
    ))).rejects.toBe(boom);
    await expect(collectStandards(createSignalContext(
      fakeOctokit({ repos: { getBranch: vi.fn().mockRejectedValue(boom) } }), 'me', 'api',
    ))).rejects.toBe(boom);
  });
});

describe('isUnavailable', () => {
  it('recognizes "not available" statuses', () => {
    expect(isUnavailable({ status: 403 })).toBe(true);
    expect(isUnavailable({ status: 404 })).toBe(true);
    expect(isUnavailable({ status: 500 })).toBe(false);
    expect(isUnavailable(undefined)).toBe(false);
  });
});

describe('createSignalContext', () => {
  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

  it('memoizes repo info and tree across collectors', async () => {
    const get = vi.fn().mockResolvedValue({ data: { default_branch: 'main' } });
    const getTree = vi.fn().mockResolvedValue({ data: { tree: [{ path: 'a' }] } });
    const ctx = createSignalContext({ repos: { get }, git: { getTree } } as any, 'me', 'api');

    await ctx.repoInfo(); await ctx.repoInfo();
    expect(await ctx.tree()).toEqual(['a']);
    await ctx.tree();

    expect(get).toHaveBeenCalledTimes(1);
    expect(getTree).toHaveBeenCalledTimes(1);
  });

  it('reads and decodes a file, including non-ASCII text', async () => {
    const getContent = vi.fn().mockResolvedValue({ data: { content: b64('{"name":"ñandú"}\n') } });
    const ctx = createSignalContext({ repos: { getContent } } as any, 'me', 'api');

    expect(await ctx.readFile('package.json')).toBe('{"name":"ñandú"}\n');
    expect(getContent).toHaveBeenCalledWith({ owner: 'me', repo: 'api', path: 'package.json' });
  });

  it('returns null for missing files and directories, and rethrows other errors', async () => {
    const getContent = vi.fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ data: [{ name: 'x' }] })
      .mockRejectedValueOnce({ status: 500 });
    const ctx = createSignalContext({ repos: { getContent } } as any, 'me', 'api');

    expect(await ctx.readFile('nope')).toBeNull();
    expect(await ctx.readFile('dir')).toBeNull();
    await expect(ctx.readFile('boom')).rejects.toEqual({ status: 500 });
  });
});
