import type { Stack, DocsQuality } from '../../types';

export interface AnalyzerInput {
  paths: string[];
  language: string | null;
  cloneDir?: string;
  /** When true, the coverage analyzer will install deps and run tests. */
  runCoverage?: boolean;
  /** Timeout in ms for coverage test runs (default 120_000). */
  coverageTimeout?: number;
}

export interface PipelineResult {
  // Stack
  stack: Stack;
  // README / Docs
  hasReadme: boolean;
  readmeLines: number;
  docsQuality: DocsQuality;
  docsFileCount: number;
  // CI
  hasCi: boolean;
  // Tests
  hasTests: boolean;
  hasUnitTests: boolean;
  hasIntegrationTests: boolean;
  hasE2eTests: boolean;
  testFramework: string | null;
  e2eFramework: string | null;
  // Lint
  hasLintConfig: boolean;
  lintTool: string | null;
  // Type checking
  hasTypeChecking: boolean;
  // Security
  hasSecurityScan: boolean;
  // Performance
  hasPerfTests: boolean;
  // Roadmap
  hasRoadmap: boolean;
  // Gitignore
  hasGitignore: boolean;
  // Coverage
  coverageConfigDetected: boolean;
  coverageToolDetected: string | null;
  estimatedCoverage: number | null;
  // Monorepo
  isMonorepo: boolean;
  apps: MonorepoApp[];
}

export interface MonorepoApp {
  appPath: string;
  appName: string;
  detectionSource: string;
  stack?: string;
}

export type Analyzer<T extends Partial<PipelineResult>> = (input: AnalyzerInput) => T | Promise<T>;
