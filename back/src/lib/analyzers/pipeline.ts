/**
 * Pipeline runner — composes all micro-analyzers into a single analysis pass.
 */

import type { AnalyzerInput, PipelineResult } from './types';
import { analyzeStack } from './stack.analyzer';
import { analyzeReadme } from './readme.analyzer';
import { analyzeCi } from './ci.analyzer';
import { analyzeTesting } from './testing.analyzer';
import { analyzeRoadmap } from './roadmap.analyzer';
import { analyzeGitignore } from './gitignore.analyzer';
import { analyzeCoverage } from './coverage.analyzer';
import { analyzeMonorepo } from './monorepo.analyzer';

/** Run all analyzers on a repo and merge results. */
export async function runPipeline(input: AnalyzerInput): Promise<PipelineResult> {
  const [stack, readme, ci, testing, roadmap, gitignore, coverage, monorepo] =
    await Promise.all([
      analyzeStack(input),
      analyzeReadme(input),
      analyzeCi(input),
      analyzeTesting(input),
      analyzeRoadmap(input),
      analyzeGitignore(input),
      analyzeCoverage(input),
      analyzeMonorepo(input),
    ]);

  return {
    ...stack,
    ...readme,
    ...ci,
    ...testing,
    ...roadmap,
    ...gitignore,
    ...coverage,
    ...monorepo,
  } as PipelineResult;
}

/** Run pipeline scoped to a sub-app path within a monorepo. */
export async function runAppPipeline(
  input: AnalyzerInput,
  appPath: string,
): Promise<Partial<PipelineResult>> {
  const appPaths = input.paths
    .filter(p => p.startsWith(`${appPath}/`))
    .map(p => p.slice(appPath.length + 1));

  const appInput: AnalyzerInput = {
    paths: appPaths,
    language: null, // will be detected by stack analyzer
    cloneDir: input.cloneDir ? `${input.cloneDir}/${appPath}` : undefined,
  };

  return runPipeline(appInput);
}
