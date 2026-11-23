import { LANG_TO_STACK } from '../../types';
import type { Stack } from '../../types';
import type { AnalyzerInput, Analyzer } from './types';

interface StackResult {
  stack: Stack;
}

const CONFIG_TO_STACK: Array<{ file: string; stack: Stack }> = [
  { file: 'package.json', stack: 'node' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'setup.py', stack: 'python' },
  { file: 'requirements.txt', stack: 'python' },
  { file: 'go.mod', stack: 'go' },
  { file: 'Cargo.toml', stack: 'rust' },
  { file: 'pom.xml', stack: 'java' },
  { file: 'build.gradle', stack: 'java' },
  { file: 'Gemfile', stack: 'ruby' },
  { file: 'composer.json', stack: 'php' },
];

export const analyzeStack: Analyzer<StackResult> = (input: AnalyzerInput): StackResult => {
  // Check for config files at the repo root
  for (const { file, stack } of CONFIG_TO_STACK) {
    if (input.paths.includes(file)) {
      return { stack };
    }
  }

  // Fallback to GitHub-reported language
  if (input.language) {
    const mapped = LANG_TO_STACK[input.language];
    if (mapped) return { stack: mapped };
  }

  return { stack: 'unknown' };
};
