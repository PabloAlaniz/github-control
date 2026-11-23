import type { SignalCollector } from './types';
import { isUnavailable } from './types';

export interface StandardsInput {
  description?: string | null;
  topics?: string[] | null;
  license?: string | null;
  isPrivate?: boolean | null;
  /** Paths in the repo tree (any depth). */
  paths: string[];
  /** null = could not be queried. */
  defaultBranchProtected?: boolean | null;
}

export interface StandardCheck {
  key: string;
  label: string;
  /** null = could not be determined. */
  passed: boolean | null;
  /** false = does not apply to this repo (e.g. license in a private repo). */
  applicable: boolean;
  hint: string;
}

export interface StandardsResult {
  checks: StandardCheck[];
  passed: number;
  total: number;
}

// Locations GitHub recognizes for community files.
const COMMUNITY_DIRS = ['', '.github/', 'docs/'];

function hasCommunityFile(paths: Set<string>, names: RegExp): boolean {
  for (const path of paths) {
    const dir = COMMUNITY_DIRS.find(d => path.toLowerCase().startsWith(d) && !path.slice(d.length).includes('/'));
    if (dir === undefined) continue;
    if (names.test(path.slice(dir.length))) return true;
  }
  return false;
}

/**
 * Standards checklist for a repo. Pure function.
 * License, security policy and contributing guide only apply to public
 * repos; the rest always apply.
 */
export function analyzeStandards(input: StandardsInput): StandardsResult {
  const paths = new Set(input.paths);
  const isPublic = input.isPrivate === false;
  const hasLicenseFile = hasCommunityFile(paths, /^(licen[sc]e|copying)(\.|$)/i);

  const checks: StandardCheck[] = [
    {
      key: 'description',
      label: 'Description',
      passed: !!input.description?.trim(),
      applicable: true,
      hint: 'Add a one-line description in the repo settings',
    },
    {
      key: 'topics',
      label: 'Topics',
      passed: (input.topics?.length ?? 0) > 0,
      applicable: true,
      hint: 'Add topics so the repo is easy to find and classify',
    },
    {
      key: 'branchProtection',
      label: 'Default branch protected',
      passed: input.defaultBranchProtected ?? null,
      applicable: true,
      hint: 'Protect the default branch (require PRs or status checks)',
    },
    {
      key: 'codeowners',
      label: 'CODEOWNERS',
      passed: hasCommunityFile(paths, /^codeowners$/i),
      applicable: true,
      hint: 'Add a CODEOWNERS file to route reviews',
    },
    {
      key: 'license',
      label: 'License',
      passed: !!input.license || hasLicenseFile,
      applicable: isPublic,
      hint: 'Add a LICENSE file',
    },
    {
      key: 'security',
      label: 'Security policy',
      passed: hasCommunityFile(paths, /^security\.(md|rst|txt)$/i),
      applicable: isPublic,
      hint: 'Add a SECURITY.md explaining how to report vulnerabilities',
    },
    {
      key: 'contributing',
      label: 'Contributing guide',
      passed: hasCommunityFile(paths, /^contributing(\.(md|rst|txt))?$/i),
      applicable: isPublic,
      hint: 'Add a CONTRIBUTING.md',
    },
  ];

  const counted = checks.filter(c => c.applicable && c.passed !== null);
  return {
    checks,
    passed: counted.filter(c => c.passed).length,
    total: counted.length,
  };
}

/** Fetches from GitHub what the checklist needs: metadata, tree and branch protection. */
export const collectStandards: SignalCollector = async (ctx) => {
  const { octokit, owner, repo } = ctx;
  const repoData = await ctx.repoInfo();
  const paths = await ctx.tree();

  let defaultBranchProtected: boolean | null = null;
  try {
    const { data: branchData } = await octokit.repos.getBranch({ owner, repo, branch: repoData.default_branch });
    defaultBranchProtected = branchData.protected ?? null;
  } catch (err: any) {
    if (!isUnavailable(err)) throw err;
  }

  return {
    ...analyzeStandards({
      description: repoData.description,
      topics: repoData.topics,
      license: repoData.license?.spdx_id ?? null,
      isPrivate: repoData.private,
      paths,
      defaultBranchProtected,
    }),
  };
};
