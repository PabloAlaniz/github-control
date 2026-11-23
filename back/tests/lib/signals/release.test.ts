import { describe, it, expect, vi } from 'vitest';
import { collectRelease } from '@back/lib/signals/release';
import { createSignalContext } from '@back/lib/signals';

const notFound = { status: 404 };
const fakeOctokit = (repos: Record<string, any>) => ({
  repos: {
    get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
    getLatestRelease: vi.fn().mockRejectedValue(notFound),
    listTags: vi.fn().mockResolvedValue({ data: [] }),
    listReleases: vi.fn().mockResolvedValue({ data: [] }),
    getCommit: vi.fn(),
    compareCommitsWithBasehead: vi.fn().mockResolvedValue({ data: { ahead_by: 0 } }),
    ...repos,
  },
}) as any;
const collect = (octokit: any) => collectRelease(createSignalContext(octokit, 'me', 'api'));

describe('collectRelease', () => {
  it('uses the latest published release and counts unreleased commits', async () => {
    const octokit = fakeOctokit({
      getLatestRelease: vi.fn().mockResolvedValue({ data: {
        tag_name: 'v1.2.0', name: 'Spring', published_at: '2026-10-01T00:00:00Z', html_url: 'https://x/r',
      } }),
      compareCommitsWithBasehead: vi.fn().mockResolvedValue({ data: { ahead_by: 14 } }),
      listReleases: vi.fn().mockResolvedValue({ data: [
        { tag_name: 'v1.2.0', assets: [{ download_count: 30 }, { download_count: 12 }] },
        { tag_name: 'v1.1.0', assets: [{ download_count: 100 }] },
        { tag_name: 'v1.0.0' },
      ] }),
    });

    expect(await collect(octokit)).toEqual({
      hasRelease: true, source: 'release', tag: 'v1.2.0', name: 'Spring',
      publishedAt: '2026-10-01T00:00:00Z', url: 'https://x/r', unreleasedCommits: 14,
      downloads: 142, latestDownloads: 42,
    });
    expect(octokit.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({
      owner: 'me', repo: 'api', basehead: 'v1.2.0...main', per_page: 1,
    });
    expect(octokit.repos.listTags).not.toHaveBeenCalled();
  });

  it('falls back to created_at and null fields on a sparse release', async () => {
    const octokit = fakeOctokit({
      getLatestRelease: vi.fn().mockResolvedValue({ data: { tag_name: 'v1', created_at: '2026-01-01T00:00:00Z' } }),
    });
    expect(await collect(octokit)).toMatchObject({ name: null, publishedAt: '2026-01-01T00:00:00Z', url: null });
  });

  it('falls back to the latest tag, dated by its commit', async () => {
    const octokit = fakeOctokit({
      listTags: vi.fn().mockResolvedValue({ data: [{ name: 'v0.3.0', commit: { sha: 'abc' } }] }),
      getCommit: vi.fn().mockResolvedValue({ data: { commit: { committer: { date: '2026-09-09T00:00:00Z' } } } }),
      compareCommitsWithBasehead: vi.fn().mockResolvedValue({ data: { ahead_by: 3 } }),
    });

    expect(await collect(octokit)).toEqual({
      hasRelease: true, source: 'tag', tag: 'v0.3.0', name: null, publishedAt: '2026-09-09T00:00:00Z',
      url: 'https://github.com/me/api/releases/tag/v0.3.0', unreleasedCommits: 3,
      downloads: null, latestDownloads: null,
    });
    expect(octokit.repos.getCommit).toHaveBeenCalledWith({ owner: 'me', repo: 'api', ref: 'abc' });
  });

  it('uses the author date, or none, when the tag commit lacks a committer date', async () => {
    const tags = { listTags: vi.fn().mockResolvedValue({ data: [{ name: 'v1', commit: { sha: 'abc' } }] }) };
    const author = fakeOctokit({ ...tags, getCommit: vi.fn().mockResolvedValue({ data: { commit: { author: { date: 'd' } } } }) });
    expect((await collect(author) as any).publishedAt).toBe('d');

    const none = fakeOctokit({ ...tags, getCommit: vi.fn().mockResolvedValue({ data: { commit: {} } }) });
    expect((await collect(none) as any).publishedAt).toBeNull();

    const missing = fakeOctokit({ ...tags, getCommit: vi.fn().mockRejectedValue(notFound) });
    expect((await collect(missing) as any).publishedAt).toBeNull();
  });

  it('leaves downloads unknown when releases cannot be listed, and for bare tags', async () => {
    const octokit = fakeOctokit({
      getLatestRelease: vi.fn().mockResolvedValue({ data: { tag_name: 'v1' } }),
      listReleases: vi.fn().mockRejectedValue({ status: 403 }),
    });
    expect(await collect(octokit)).toMatchObject({ downloads: null, latestDownloads: null });

    const boom = { status: 500 };
    await expect(collect(fakeOctokit({
      getLatestRelease: vi.fn().mockResolvedValue({ data: { tag_name: 'v1' } }), listReleases: vi.fn().mockRejectedValue(boom),
    }))).rejects.toBe(boom);
  });

  it('reports repos that never released', async () => {
    const octokit = fakeOctokit({});
    expect(await collect(octokit)).toEqual({ hasRelease: false });
    expect(octokit.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
  });

  it('leaves unreleased commits unknown when the tag cannot be compared', async () => {
    const octokit = fakeOctokit({
      getLatestRelease: vi.fn().mockResolvedValue({ data: { tag_name: 'v1', published_at: 'd' } }),
      compareCommitsWithBasehead: vi.fn().mockRejectedValue(notFound),
    });
    expect((await collect(octokit) as any).unreleasedCommits).toBeNull();
  });

  it('propagates unexpected errors from each call', async () => {
    const boom = { status: 500 };
    const release = { getLatestRelease: vi.fn().mockResolvedValue({ data: { tag_name: 'v1' } }) };
    const tags = { listTags: vi.fn().mockResolvedValue({ data: [{ name: 'v1', commit: { sha: 'abc' } }] }) };

    await expect(collect(fakeOctokit({ getLatestRelease: vi.fn().mockRejectedValue(boom) }))).rejects.toBe(boom);
    await expect(collect(fakeOctokit({ ...tags, getCommit: vi.fn().mockRejectedValue(boom) }))).rejects.toBe(boom);
    await expect(collect(fakeOctokit({ ...release, compareCommitsWithBasehead: vi.fn().mockRejectedValue(boom) }))).rejects.toBe(boom);
  });
});
