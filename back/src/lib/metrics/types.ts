/** Shared metric types used by routes, services and repositories. */

// ── Snapshot input (what gets written to repo_metrics_history) ──

export interface SnapshotInput {
  repoId: number;
  fullName: string;
  code: { sizeKb: number | null; fileCount: number | null; loc: number | null };
  github: { stars: number; forks: number; watchers: number; subscribersCount: number; openIssues: number };
  health: {
    hasCi: boolean; hasTests: boolean; hasReadme: boolean; readmeLines: number;
    hasGitignore: boolean; hasRoadmap: boolean; docsFileCount: number; docsQuality: string;
  };
  meta: {
    language: string | null; isPrivate: boolean; isArchived: boolean;
    isFork: boolean; isTemplate: boolean; defaultBranch: string;
  };
}

// ── API response shapes ──

export interface CodeMetrics { sizeKb: number; fileCount: number; loc: number }
export interface GithubMetrics { stars: number; forks: number; watchers: number; subscribers: number; openIssues: number }
export interface HealthMetrics {
  hasCi: boolean; hasTests: boolean; hasReadme: boolean;
  readmeLines: number; docsQuality: string; docsFileCount: number;
}

export interface RepoSnapshot {
  date: string;
  code: CodeMetrics;
  github: GithubMetrics;
  health: HealthMetrics;
}

export interface CompareEntry {
  repo: string;
  deltas: { loc: number; fileCount: number; sizeKb: number; stars: number; forks: number; openIssues: number };
  current: { loc: number; fileCount: number; stars: number; fromLoc: number };
  isNew: boolean;
  isRemoved: boolean;
}
