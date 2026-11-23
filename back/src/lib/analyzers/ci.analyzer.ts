import type { AnalyzerInput, Analyzer } from './types';

interface CiResult {
  hasCi: boolean;
}

export const analyzeCi: Analyzer<CiResult> = (input: AnalyzerInput): CiResult => {
  const hasCi = input.paths.some(
    p => p.startsWith('.github/workflows/') && (p.endsWith('.yml') || p.endsWith('.yaml')),
  );

  return { hasCi };
};
