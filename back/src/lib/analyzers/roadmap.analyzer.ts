import type { AnalyzerInput, Analyzer } from './types';

interface RoadmapResult {
  hasRoadmap: boolean;
}

export const analyzeRoadmap: Analyzer<RoadmapResult> = (input: AnalyzerInput): RoadmapResult => {
  const hasRoadmap = input.paths.some(p => {
    const lower = p.toLowerCase();
    return lower === 'roadmap.md' || lower === 'docs/roadmap.md';
  });

  return { hasRoadmap };
};
