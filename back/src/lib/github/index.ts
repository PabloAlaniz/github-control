// Barrel re-export — preserves backward compat for `@back/lib/github` imports
export { getOctokit } from './client';
export { getAuthenticatedUser, getReposWithMetrics, getRepoDetails, getRepoReadme, archiveRepo, getAllOpenPRs } from './repos';
export { checkRepoHealth, getRepoTree, checkAppHealth, countFileLines, computeCodeMetrics, countLocFromTarball } from './health';
export type { CodeMetrics, TarballLocResult } from './health';
export type { TestingMetadata, DocsQuality } from './detection';
export { detectAllTestingMetadata, calculateDocsQuality, isCodeFile, isExcludedPath, CODE_EXTENSIONS, EXCLUDED_DIRS } from './detection';
export type { DetectedApp } from './apps';
export { detectRepoApps } from './apps';
export type { LatestWorkflowRun } from './workflows';
export { getLatestWorkflowRun, deriveCiStatus } from './workflows';
