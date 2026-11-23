import type { SignalCollector, SignalContext } from './types';
import { isUnavailable } from './types';

interface LatestVersion {
  source: 'release' | 'tag';
  tag: string;
  name: string | null;
  publishedAt: string | null;
  url: string | null;
}

async function latestRelease(ctx: SignalContext): Promise<LatestVersion | null> {
  const { octokit, owner, repo } = ctx;
  try {
    const { data } = await octokit.repos.getLatestRelease({ owner, repo });
    return {
      source: 'release',
      tag: data.tag_name,
      name: data.name ?? null,
      publishedAt: data.published_at ?? data.created_at ?? null,
      url: data.html_url ?? null,
    };
  } catch (err: any) {
    if (!isUnavailable(err)) throw err;
    return null;  // no published releases
  }
}

/** With no releases, the most recent tag counts as the latest version. */
async function latestTag(ctx: SignalContext): Promise<LatestVersion | null> {
  const { octokit, owner, repo } = ctx;
  const { data: tags } = await octokit.repos.listTags({ owner, repo, per_page: 1 });
  const tag = tags[0];
  if (!tag) return null;

  let publishedAt: string | null = null;
  try {
    const { data: commit } = await octokit.repos.getCommit({ owner, repo, ref: tag.commit.sha });
    publishedAt = commit.commit.committer?.date ?? commit.commit.author?.date ?? null;
  } catch (err: any) {
    if (!isUnavailable(err)) throw err;
  }
  return { source: 'tag', tag: tag.name, name: null, publishedAt, url: `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tag.name)}` };
}

/**
 * Latest published version (release, or tag if there are no releases) and how
 * many commits on the default branch are not in it yet.
 */
export const collectRelease: SignalCollector = async (ctx) => {
  const { octokit, owner, repo } = ctx;
  const latest = (await latestRelease(ctx)) ?? (await latestTag(ctx));
  if (!latest) return { hasRelease: false };

  const { default_branch } = await ctx.repoInfo();
  let unreleasedCommits: number | null = null;
  try {
    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner, repo, basehead: `${latest.tag}...${default_branch}`, per_page: 1,
    });
    unreleasedCommits = data.ahead_by;
  } catch (err: any) {
    if (!isUnavailable(err)) throw err;  // the tag no longer exists or is not comparable
  }

  return { hasRelease: true, ...latest, unreleasedCommits };
};
