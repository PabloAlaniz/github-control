import type { Octokit } from '@octokit/rest';
import { resolveBaseline, type Baseline } from '../../domain/repo-baseline';
import type { CustomCheck } from '../../domain/policy';

/**
 * A "signal" is a per-repo piece of data fetched from GitHub on demand and
 * cached in `repo_signals`. Each type has a collector that returns the JSON
 * already processed, ready to display.
 *
 * Convention: if the signal has a long list, it goes under the `items` key.
 * `/api/repos` omits it (only the summary travels); the detail is read with
 * `GET /api/repos/:owner/:repo/signals` or with dedicated endpoints.
 */
export interface RepoInfo {
  default_branch: string;
  description?: string | null;
  topics?: string[];
  private?: boolean;
  archived?: boolean;
  license?: { spdx_id?: string | null } | null;
  [key: string]: unknown;
}

export interface SignalContext {
  octokit: Octokit;
  owner: string;
  repo: string;
  /** Settings baseline the repo is compared against. */
  baseline: Baseline;
  /** What the policy asks of the signals: its custom checks and optional sources. */
  policy: SignalPolicy;
  /** Repo metadata (memoized: several collectors share it within a single sync). */
  repoInfo(): Promise<RepoInfo>;
  /** Paths in the default branch's tree (memoized). Empty repo → []. */
  tree(): Promise<string[]>;
  /** Contents of a text file on the default branch, or null if it does not exist. */
  readFile(path: string): Promise<string | null>;
}

export interface SignalPolicy {
  checks: CustomCheck[];
  /** Ask the OpenSSF Scorecard API about public repos. */
  scorecard: boolean;
}

export type SignalData = Record<string, unknown>;
export type SignalCollector = (ctx: SignalContext) => Promise<SignalData>;

/** Does the GitHub error mean "not available for this repo/token"? */
export function isUnavailable(err: any): boolean {
  return [403, 404, 409, 410, 451].includes(err?.status);
}

function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function createSignalContext(
  octokit: Octokit, owner: string, repo: string, baseline: Baseline = resolveBaseline(undefined),
  policy: SignalPolicy = { checks: [], scorecard: false },
): SignalContext {
  let repoPromise: Promise<RepoInfo> | undefined;
  let treePromise: Promise<string[]> | undefined;

  const ctx: SignalContext = {
    octokit,
    owner,
    repo,
    baseline,
    policy,
    repoInfo() {
      repoPromise ??= octokit.repos.get({ owner, repo }).then(res => res.data as unknown as RepoInfo);
      return repoPromise;
    },
    tree() {
      treePromise ??= (async () => {
        const { default_branch } = await ctx.repoInfo();
        try {
          const { data } = await octokit.git.getTree({ owner, repo, tree_sha: default_branch, recursive: 'true' });
          return data.tree.map(item => item.path || '').filter(Boolean);
        } catch (err: any) {
          if (isUnavailable(err)) return [];  // empty repo
          throw err;
        }
      })();
      return treePromise;
    },
    async readFile(path: string) {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path });
        const content = (data as { content?: string }).content;
        return typeof content === 'string' ? decodeBase64(content) : null;
      } catch (err: any) {
        if (isUnavailable(err)) return null;
        throw err;
      }
    },
  };
  return ctx;
}
