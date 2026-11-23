import type { AnalyzerInput, Analyzer } from './types';

interface GitignoreResult {
  hasGitignore: boolean;
}

export const analyzeGitignore: Analyzer<GitignoreResult> = (input: AnalyzerInput): GitignoreResult => {
  const hasGitignore = input.paths.includes('.gitignore');

  return { hasGitignore };
};
