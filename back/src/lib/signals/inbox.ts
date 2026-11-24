import type { SignalCollector } from './types';
import { isUnavailable } from './types';

/** An open pull request or issue, as the inbox shows it. */
export interface InboxItem {
  type: 'pr' | 'issue';
  number: number;
  title: string;
  url: string;
  author: string | null;
  /** Opened by an app (Dependabot, Renovate...), not a person. */
  authorIsBot: boolean;
  labels: { name: string; color: string | null }[];
  assignees: string[];
  /** Pull requests only: users whose review was asked for. */
  requestedReviewers: string[];
  draft: boolean;
  comments: number;
  createdAt: string;
  updatedAt: string;
  /** Pull requests only: the branch and the commit it pointed to when listed. */
  headRef: string | null;
  headSha: string | null;
  /** Pull requests only: the outcome of the checks on the head commit; null when there are none or it is unknown. */
  checks: 'success' | 'failure' | 'pending' | null;
  /** Pull requests only: where the review stands; null when no review is required or it is unknown. */
  review: 'approved' | 'changes_requested' | 'review_required' | null;
}

/** What GraphQL knows about an open pull request that the REST listings do not. */
export interface PullState {
  checks: InboxItem['checks'];
  review: InboxItem['review'];
}

const CHECK_STATES: Record<string, InboxItem['checks']> = {
  SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending',
};
const REVIEW_STATES: Record<string, InboxItem['review']> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'review_required',
};

/** Check and review state per pull request number, from the GraphQL answer. Pure. */
export function pullStates(result: any): Map<number, PullState> {
  const states = new Map<number, PullState>();
  for (const node of result?.repository?.pullRequests?.nodes ?? []) {
    if (typeof node?.number !== 'number') continue;
    const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
    states.set(node.number, { checks: CHECK_STATES[rollup] ?? null, review: REVIEW_STATES[node.reviewDecision] ?? null });
  }
  return states;
}

const PAGE_SIZE = 100;
const login = (user: any): string | null => (typeof user?.login === 'string' ? user.login : null);
const logins = (users: any): string[] => (Array.isArray(users) ? users.map(login).filter((l): l is string => !!l) : []);

/**
 * Builds the inbox of one repo from GitHub's issue listing (which includes
 * pull requests) and, for what only the pull request listing knows (requested
 * reviewers, head branch and commit), from that one. `states` adds the check
 * and review state of each pull request, when known. Pure function.
 */
export function buildInbox(issues: any[], pulls: any[], states: Map<number, PullState> = new Map()) {
  const pullByNumber = new Map(pulls.map((pull) => [pull.number, pull]));

  const items: InboxItem[] = issues.map((issue) => {
    const isPr = !!issue.pull_request;
    const pull = isPr ? pullByNumber.get(issue.number) : undefined;
    return {
      type: isPr ? 'pr' : 'issue',
      number: issue.number,
      title: String(issue.title ?? ''),
      url: issue.html_url,
      author: login(issue.user),
      authorIsBot: issue.user?.type === 'Bot' || /\[bot\]$/.test(issue.user?.login ?? ''),
      labels: (Array.isArray(issue.labels) ? issue.labels : []).map((label: any) => (
        typeof label === 'string' ? { name: label, color: null } : { name: String(label?.name ?? ''), color: label?.color ?? null }
      )).filter((label: { name: string }) => label.name),
      assignees: logins(issue.assignees),
      requestedReviewers: logins(pull?.requested_reviewers),
      draft: Boolean(pull?.draft ?? issue.draft),
      comments: Number(issue.comments) || 0,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      headRef: pull?.head?.ref ?? null,
      headSha: pull?.head?.sha ?? null,
      checks: (isPr && states.get(issue.number)?.checks) || null,
      review: (isPr && states.get(issue.number)?.review) || null,
    };
  });

  return {
    prs: items.filter((item) => item.type === 'pr').length,
    issues: items.filter((item) => item.type === 'issue').length,
    items,
  };
}

const STATES_QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
    }
  }
}`;

/** One query for the check and review state of every open pull request. Without it, they are left unknown. */
async function fetchPullStates(octokit: any, owner: string, repo: string, hasPulls: boolean): Promise<Map<number, PullState>> {
  if (!hasPulls) return new Map();
  try {
    return pullStates(await octokit.graphql(STATES_QUERY, { owner, repo }));
  } catch {
    return new Map();
  }
}

/** Open pull requests and issues of the repo, most recently updated first (the first 100). */
export const collectInbox: SignalCollector = async ({ octokit, owner, repo }) => {
  let issues: any[];
  try {
    ({ data: issues } = await octokit.issues.listForRepo({
      owner, repo, state: 'open', sort: 'updated', direction: 'desc', per_page: PAGE_SIZE,
    }));
  } catch (err: any) {
    if (!isUnavailable(err)) throw err;
    return { available: false, prs: 0, issues: 0, items: [] };
  }

  let pulls: any[] = [];
  if (issues.some((issue) => issue.pull_request)) {
    ({ data: pulls } = await octokit.pulls.list({
      owner, repo, state: 'open', sort: 'updated', direction: 'desc', per_page: PAGE_SIZE,
    }));
  }

  return { available: true, ...buildInbox(issues, pulls, await fetchPullStates(octokit, owner, repo, pulls.length > 0)), truncated: issues.length === PAGE_SIZE };
};
