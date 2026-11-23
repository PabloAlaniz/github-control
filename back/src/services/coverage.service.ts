import type { AppContext } from '../application/context';

/** Report coverage from CI: upsert labeled report + update repo-level coverage. */
export async function reportCoverage(ctx: AppContext, fullName: string, coverage: number, label?: string, commitSha?: string) {
  const coverageLabel = label || 'default';
  await ctx.storage.coverage.upsertCoverage(fullName, coverageLabel, coverage, commitSha);
  await ctx.storage.coverage.updateRepoCoverage(fullName, coverage);
  return { coverage, label: coverageLabel };
}

/** List all coverage reports for a repo. */
export async function listReports(ctx: AppContext, fullName: string) {
  return ctx.storage.coverage.listCoverageReports(fullName);
}
