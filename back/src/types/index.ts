// Shared types for the backend API

export type Priority = 'high' | 'medium' | 'low' | 'paused';
export type DocsQuality = 'missing' | 'needs_work' | 'good' | 'excellent';
export type Stack =
  | 'python' | 'node' | 'php' | 'go' | 'java'
  | 'ruby' | 'rust' | 'c' | 'cpp' | 'csharp'
  | 'swift' | 'kotlin' | 'unknown';

export type LocalStatus = 'reviewed' | 'pending' | 'archived';

/** Language-to-stack mapping (previously hardcoded in repos.ts) */
export const LANG_TO_STACK: Record<string, Stack> = {
  Python: 'python',
  JavaScript: 'node',
  TypeScript: 'node',
  Go: 'go',
  Rust: 'rust',
  Java: 'java',
  Ruby: 'ruby',
  PHP: 'php',
  C: 'c',
  'C++': 'cpp',
  'C#': 'csharp',
  Swift: 'swift',
  Kotlin: 'kotlin',
};

export interface HealthResult {
  hasReadme: boolean;
  readmeLines: number;
  hasCi: boolean;
  hasTests: boolean;
  hasGitignore: boolean;
  hasRoadmap: boolean;
  docsFileCount: number;
  hasUnitTests: boolean;
  hasIntegrationTests: boolean;
  hasE2eTests: boolean;
  hasLintConfig: boolean;
  hasTypeChecking: boolean;
  hasSecurityScan: boolean;
  hasPerfTests: boolean;
  testFramework: string | null;
  e2eFramework: string | null;
  lintTool: string | null;
}

export interface AppHealthResult {
  hasReadme: boolean;
  readmeLines: number;
  hasCi: boolean;
  hasTests: boolean;
  stack: string | null;
  loc: number;
  fileCount: number;
  docsQuality: DocsQuality;
}

export interface ActivityParams {
  action: string;
  entityType: string;
  entityId: string;
  fieldChanged?: string | null;
  oldValue?: any;
  newValue?: any;
  actorType: string;
  actorName: string;
  metadata?: Record<string, any>;
}
