import type { SignalCollector, SignalContext } from './types';
import { isUnavailable } from './types';

export const STALE_BRANCH_DAYS = 90;
export const STALE_PR_DAYS = 30;
/** Maximum number of branches compared against the default per sync. */
const MAX_COMPARES = 25;
const DAY_MS = 86_400_000;

export interface BranchInput {
  name: string;
  sha: string;
  protected: boolean;
  lastCommitAt: string | null;
  /** Commits on the branch that are not in the default; null if it was not compared. */
  ahead: number | null;
  behind: number | null;
}

export interface PullInput {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  draft: boolean;
  headRef: string;
  headSha: string;
  /** false when the PR comes from a fork: its branch does not live in this repo. */
  sameRepo: boolean;
  mergedAt: string | null;
  updatedAt: string;
}

export interface BranchItem {
  name: string;
  sha: string;
  lastCommitAt: string | null;
  /** merged: its content is already in the default. stale: no commits for a long time and no open PR. */
  status: 'merged' | 'stale' | 'active';
  /** pr: merged PR whose head is exactly this commit. ancestor: the default already contains the branch. */
  mergedVia: 'pr' | 'ancestor' | null;
  pr: { number: number; url: string; state: string } | null;
  ahead: number | null;
  behind: number | null;
}

/**
 * Classifies the unprotected branches other than the default. Pure function.
 * A branch counts as merged only with evidence: a merged PR whose head is
 * exactly the branch's current commit (covers squash and rebase), or a
 * comparison showing it has no commits of its own.
 */
export function analyzeBranches(
  defaultBranch: string,
  branches: BranchInput[],
  pulls: PullInput[],
  now: number = Date.now(),
) {
  const ownPulls = pulls.filter(p => p.sameRepo);
  const items: BranchItem[] = [];

  for (const branch of branches) {
    if (branch.name === defaultBranch || branch.protected) continue;
    const branchPulls = ownPulls.filter(p => p.headRef === branch.name);
    const mergedPr = branchPulls.find(p => p.mergedAt && p.headSha === branch.sha);
    const openPr = branchPulls.find(p => p.state === 'open');
    const linked = mergedPr ?? openPr ?? branchPulls[0] ?? null;

    let status: BranchItem['status'] = 'active';
    let mergedVia: BranchItem['mergedVia'] = null;
    if (mergedPr) {
      status = 'merged'; mergedVia = 'pr';
    } else if (branch.ahead === 0 && !openPr) {
      status = 'merged'; mergedVia = 'ancestor';
    } else if (!openPr && branch.lastCommitAt && now - new Date(branch.lastCommitAt).getTime() > STALE_BRANCH_DAYS * DAY_MS) {
      status = 'stale';
    }

    items.push({
      name: branch.name,
      sha: branch.sha,
      lastCommitAt: branch.lastCommitAt,
      status,
      mergedVia,
      pr: linked ? { number: linked.number, url: linked.url, state: linked.mergedAt ? 'merged' : linked.state } : null,
      ahead: branch.ahead,
      behind: branch.behind,
    });
  }

  const order = { merged: 0, stale: 1, active: 2 };
  items.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  const openPulls = pulls.filter(p => p.state === 'open');
  const stalePrs = openPulls
    .filter(p => now - new Date(p.updatedAt).getTime() > STALE_PR_DAYS * DAY_MS)
    .map(p => ({ number: p.number, title: p.title, url: p.url, updatedAt: p.updatedAt, draft: p.draft }));

  return {
    defaultBranch,
    total: branches.length,
    merged: items.filter(i => i.status === 'merged').length,
    stale: items.filter(i => i.status === 'stale').length,
    openPrs: openPulls.length,
    stalePrCount: stalePrs.length,
    stalePrs: stalePrs.slice(0, 10),
    items,
  };
}

/** Last commit date per branch, in a single query. If it fails, they are left without a date. */
async function branchDates(ctx: SignalContext): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  try {
    const result: any = await ctx.octokit.graphql(
      `query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          refs(refPrefix: "refs/heads/", first: 100) {
            nodes { name target { ... on Commit { committedDate } } }
          }
        }
      }`,
      { owner: ctx.owner, repo: ctx.repo },
    );
    for (const node of result?.repository?.refs?.nodes ?? []) {
      if (node?.target?.committedDate) dates.set(node.name, node.target.committedDate);
    }
  } catch (err: any) {
    console.warn(`Branch dates query failed for ${ctx.owner}/${ctx.repo}: ${err.message}`);
  }
  return dates;
}

/** Merged or abandoned branches and open PRs with no activity. */
export const collectBranches: SignalCollector = async (ctx) => {
  const { octokit, owner, repo } = ctx;
  const fullName = `${owner}/${repo}`;
  const { default_branch } = await ctx.repoInfo();

  const { data: rawBranches } = await octokit.repos.listBranches({ owner, repo, per_page: 100 });
  const { data: rawPulls } = await octokit.pulls.list({
    owner, repo, state: 'all', sort: 'updated', direction: 'desc', per_page: 100,
  });
  const dates = await branchDates(ctx);

  const pulls: PullInput[] = rawPulls.map(p => ({
    number: p.number,
    title: p.title,
    url: p.html_url,
    state: p.state === 'open' ? 'open' : 'closed',
    draft: p.draft === true,
    headRef: p.head.ref,
    headSha: p.head.sha,
    sameRepo: p.head.repo?.full_name?.toLowerCase() === fullName.toLowerCase(),
    mergedAt: p.merged_at ?? null,
    updatedAt: p.updated_at,
  }));

  const branches: BranchInput[] = [];
  let compares = 0;
  for (const b of rawBranches) {
    const branch: BranchInput = {
      name: b.name, sha: b.commit.sha, protected: b.protected === true,
      lastCommitAt: dates.get(b.name) ?? null, ahead: null, behind: null,
    };
    const hasPrEvidence = pulls.some(p => p.sameRepo && p.headRef === b.name && p.mergedAt && p.headSha === b.commit.sha);
    if (b.name !== default_branch && !branch.protected && !hasPrEvidence && compares < MAX_COMPARES) {
      compares++;
      try {
        const { data } = await octokit.repos.compareCommitsWithBasehead({
          owner, repo, basehead: `${default_branch}...${b.name}`, per_page: 1,
        });
        branch.ahead = data.ahead_by;
        branch.behind = data.behind_by;
      } catch (err: any) {
        if (!isUnavailable(err)) throw err;
      }
    }
    branches.push(branch);
  }

  return {
    ...analyzeBranches(default_branch, branches, pulls),
    truncated: rawBranches.length === 100,
  };
};
