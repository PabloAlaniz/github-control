/**
 * Inbox: the open pull requests and issues of every repo in one list.
 *
 * The list is read from the `inbox` signal of each repo (refreshed by every
 * sync, or on demand), so showing it costs no GitHub calls. Merging is the one
 * thing here that writes to GitHub.
 */
import type { AppContext } from '../application/context';
import { getOctokit } from '../lib/github/client';
import { getViewerLogin } from '../lib/github/repos';
import type { InboxItem } from '../lib/signals/inbox';
import { mapLimit } from './full-sync.service';
import { syncSignals } from './signal.service';

export interface InboxEntry extends InboxItem {
  repo: string;
  groups: string[];
  priority: string | null;
}

export interface Inbox {
  /** The GitHub login behind the token ("me"); null when unknown. */
  viewer: string | null;
  items: InboxEntry[];
  /** Repos whose inbox was read at least once / repos listed. */
  reposSynced: number;
  reposTotal: number;
  /** When the least recently refreshed repo was read. */
  oldestCheck: string | null;
  /** Repos with more open items than the 100 that are kept. */
  truncated: string[];
}

/** Every open item of the active repos (not archived, paused or deleted), most recently updated first. */
export async function getInbox(ctx: AppContext): Promise<Inbox> {
  const [repos, signals, viewer] = await Promise.all([
    ctx.storage.repos.listRepos(),
    ctx.storage.signals.listSignals('inbox'),
    getViewerLogin(ctx.config),
  ]);
  const byName = new Map(repos.map((repo) => [repo.full_name as string, repo]));

  const items: InboxEntry[] = [];
  const truncated: string[] = [];
  let reposSynced = 0;
  let oldestCheck: string | null = null;

  for (const signal of signals) {
    const repo = byName.get(signal.full_name);
    if (!repo) continue;
    reposSynced++;
    if (!oldestCheck || signal.checked_at < oldestCheck) oldestCheck = signal.checked_at;
    if (signal.data.truncated) truncated.push(signal.full_name);
    for (const item of (signal.data.items ?? []) as InboxItem[]) {
      items.push({ ...item, repo: signal.full_name, groups: repo.groups ?? [], priority: repo.priority ?? null });
    }
  }
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  return { viewer, items, reposSynced, reposTotal: repos.length, oldestCheck, truncated };
}

/** Reads the inbox of every active repo from GitHub again. */
export async function refreshInbox(ctx: AppContext, concurrency = 5): Promise<{ repos: number; failed: number }> {
  const repos = await ctx.storage.repos.listRepos();
  let failed = 0;
  await mapLimit(repos, concurrency, async (repo) => {
    const [owner, name] = String(repo.full_name).split('/');
    try {
      const results = await syncSignals(ctx, owner, name, ['inbox']);
      if (!results || results.some((result) => !result.ok)) failed++;
    } catch {
      failed++;
    }
  });
  return { repos: repos.length, failed };
}

// ── Merging ─────────────────────────────────────────

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface MergeTarget {
  repo: string;
  number: number;
  /** Head commit when the pull request was listed. If it changed, it is not merged. */
  sha: string;
}

export interface MergeResult {
  repo: string;
  number: number;
  merged: boolean;
  reason?: 'closed' | 'draft' | 'moved' | 'checks_failing' | 'checks_pending' | 'not_mergeable' | 'gone' | 'error';
  error?: string;
}

const FAILED_CHECKS = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

/** 'failing' | 'pending' | 'ok' for a commit, from its check runs and commit statuses. */
async function checksState(octokit: ReturnType<typeof getOctokit>, owner: string, repo: string, ref: string) {
  const [{ data: checks }, { data: status }] = await Promise.all([
    octokit.checks.listForRef({ owner, repo, ref, per_page: 100 }),
    octokit.repos.getCombinedStatusForRef({ owner, repo, ref }),
  ]);
  const runs = checks.check_runs ?? [];
  if (runs.some((run) => FAILED_CHECKS.has(run.conclusion ?? '')) || ['failure', 'error'].includes(status.state)) return 'failing';
  // A combined status with no statuses reports "pending": only count it when something actually reported.
  if (runs.some((run) => run.status !== 'completed') || (status.state === 'pending' && status.statuses.length > 0)) return 'pending';
  return 'ok';
}

/**
 * Merges pull requests on GitHub, each with its own safeguards: it must still
 * be open, not a draft, pointing to the commit the user saw, and with no
 * failing or running checks. GitHub's own rules (required reviews, conflicts,
 * branch protection) apply on top and are reported as `not_mergeable`.
 */
export async function mergePullRequests(
  ctx: AppContext, targets: MergeTarget[], method: MergeMethod,
): Promise<MergeResult[]> {
  const octokit = getOctokit(ctx.config);
  const results: MergeResult[] = [];

  for (const { repo: fullName, number, sha } of targets) {
    const [owner, repo] = fullName.split('/');
    const skip = (reason: MergeResult['reason'], error?: string) =>
      results.push({ repo: fullName, number, merged: false, reason, ...(error && { error }) });
    try {
      const { data: pull } = await octokit.pulls.get({ owner, repo, pull_number: number });
      if (pull.state !== 'open') { skip('closed'); continue; }
      if (pull.draft) { skip('draft'); continue; }
      if (pull.head.sha !== sha) { skip('moved'); continue; }

      const checks = await checksState(octokit, owner, repo, sha);
      if (checks === 'failing') { skip('checks_failing'); continue; }
      if (checks === 'pending') { skip('checks_pending'); continue; }

      // `sha` makes GitHub refuse the merge if the branch moved after the checks above.
      await octokit.pulls.merge({ owner, repo, pull_number: number, sha, merge_method: method });
      results.push({ repo: fullName, number, merged: true });
    } catch (err: any) {
      if (err?.status === 404) skip('gone');
      else if ([405, 409, 422].includes(err?.status)) skip('not_mergeable', err?.message);
      else skip('error', err?.message ?? 'unknown error');
    }
  }

  // Refresh what the inbox shows for the repos that changed.
  for (const fullName of new Set(results.filter((result) => result.merged).map((result) => result.repo))) {
    const [owner, repo] = fullName.split('/');
    await syncSignals(ctx, owner, repo, ['inbox']).catch(() => null);
  }
  return results;
}

// ── Reading and answering one item ──────────────────

export class InboxActionError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 | 502) {
    super(message);
  }
}

/** Turns a GitHub failure into one the caller can show. */
function asActionError(err: any, what: string): InboxActionError {
  if (err instanceof InboxActionError) return err;
  if (err?.status === 404) return new InboxActionError(`${what} was not found on GitHub`, 404);
  if (err?.status === 403) return new InboxActionError(`The token is not allowed to do that on ${what}`, 403);
  // 422 is how GitHub says "not this, not by you": e.g. approving your own pull request.
  if (err?.status === 422) return new InboxActionError(`GitHub refused: ${err?.message ?? 'not allowed'}`, 409);
  return new InboxActionError(`GitHub failed: ${err?.message ?? 'unknown error'}`, 502);
}

const MAX_BODY = 6000;

/** What a pull request or issue says, read live: enough to decide without opening GitHub. */
export async function getItemDetail(ctx: AppContext, fullName: string, number: number) {
  const octokit = getOctokit(ctx.config);
  const [owner, repo] = fullName.split('/');
  const what = `${fullName}#${number}`;
  try {
    const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: number });
    const base = {
      repo: fullName, number, title: issue.title, url: issue.html_url, state: issue.state,
      author: issue.user?.login ?? null,
      body: (issue.body ?? '').slice(0, MAX_BODY),
      bodyTruncated: (issue.body ?? '').length > MAX_BODY,
      comments: issue.comments,
    };
    if (!issue.pull_request) return { ...base, type: 'issue' as const };

    const [{ data: pull }, { data: files }] = await Promise.all([
      octokit.pulls.get({ owner, repo, pull_number: number }),
      octokit.pulls.listFiles({ owner, repo, pull_number: number, per_page: 30 }),
    ]);
    return {
      ...base, type: 'pr' as const,
      draft: pull.draft === true, headSha: pull.head.sha, headRef: pull.head.ref, baseRef: pull.base.ref,
      additions: pull.additions, deletions: pull.deletions, changedFiles: pull.changed_files,
      mergeable: pull.mergeable ?? null,
      files: files.map((file) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions })),
    };
  } catch (err) {
    throw asActionError(err, what);
  }
}

const REVIEW_EVENTS = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' } as const;

export interface ReviewInput {
  repo: string;
  number: number;
  event: keyof typeof REVIEW_EVENTS;
  body: string;
  /** Head commit when the pull request was shown. A review of anything newer is refused. */
  sha: string;
}

/** Submits a review on GitHub, pinned to the commit the reviewer saw. */
export async function reviewPullRequest(ctx: AppContext, input: ReviewInput): Promise<{ reviewUrl: string | null }> {
  const octokit = getOctokit(ctx.config);
  const [owner, repo] = input.repo.split('/');
  const what = `${input.repo}#${input.number}`;
  try {
    const { data: pull } = await octokit.pulls.get({ owner, repo, pull_number: input.number });
    if (pull.state !== 'open') throw new InboxActionError(`${what} is no longer open`, 409);
    if (pull.head.sha !== input.sha) {
      throw new InboxActionError(`${what} has new commits since you looked at it. Refresh and review it again.`, 409);
    }
    const { data: review } = await octokit.pulls.createReview({
      owner, repo, pull_number: input.number, commit_id: input.sha, event: REVIEW_EVENTS[input.event],
      ...(input.body && { body: input.body }),
    });
    await syncSignals(ctx, owner, repo, ['inbox']).catch(() => null);
    return { reviewUrl: review.html_url ?? null };
  } catch (err) {
    throw asActionError(err, what);
  }
}

/** Comments on a pull request or an issue. */
export async function commentOn(ctx: AppContext, fullName: string, number: number, body: string): Promise<{ commentUrl: string | null }> {
  const octokit = getOctokit(ctx.config);
  const [owner, repo] = fullName.split('/');
  try {
    const { data } = await octokit.issues.createComment({ owner, repo, issue_number: number, body });
    await syncSignals(ctx, owner, repo, ['inbox']).catch(() => null);
    return { commentUrl: data.html_url ?? null };
  } catch (err) {
    throw asActionError(err, `${fullName}#${number}`);
  }
}
