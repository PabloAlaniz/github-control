import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateDocsQuality } from '../github/detection';
import type { DocsQuality } from '../../types';
import type { AnalyzerInput, Analyzer } from './types';

interface ReadmeResult {
  hasReadme: boolean;
  readmeLines: number;
  docsQuality: DocsQuality;
  docsFileCount: number;
}

export const analyzeReadme: Analyzer<ReadmeResult> = (input: AnalyzerInput): ReadmeResult => {
  const readmePath = input.paths.find(p => p.toLowerCase() === 'readme.md');
  const hasReadme = !!readmePath;

  let readmeLines = 0;
  if (hasReadme && input.cloneDir && readmePath) {
    try {
      const content = readFileSync(join(input.cloneDir, readmePath), 'utf-8');
      readmeLines = content.split('\n').length;
    } catch {
      // File unreadable — leave lines at 0
    }
  }

  const docsFileCount = input.paths.filter(
    p => p.startsWith('docs/') && p.endsWith('.md'),
  ).length;

  const docsQuality = calculateDocsQuality(hasReadme, readmeLines, docsFileCount);

  return { hasReadme, readmeLines, docsQuality, docsFileCount };
};
