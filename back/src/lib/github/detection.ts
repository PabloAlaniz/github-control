// Pure functions — no AppConfig, no Octokit, no side effects

export interface TestingMetadata {
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

export type DocsQuality = 'missing' | 'needs_work' | 'good' | 'excellent';

// ── Code file utilities ─────────────────────────────

export const CODE_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.java', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.rs', '.sql',
  '.sh', '.bash', '.yml', '.yaml', '.json', '.md',
];

export const EXCLUDED_DIRS = [
  'node_modules', 'vendor', 'dist', 'build', '.git', '.github',
  'coverage', '__pycache__', '.next', '.cache', 'public/assets',
];

/**
 * Check if a file path represents a code file based on extension
 * @param path - File path to check
 * @returns true if the file has a recognized code extension
 */
export function isCodeFile(path: string): boolean {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  return CODE_EXTENSIONS.includes(ext);
}

/**
 * Check if a file path should be excluded from analysis
 * 
 * Excludes common directories like node_modules, dist, build, etc.
 * 
 * @param path - File path to check
 * @returns true if the path contains or starts with an excluded directory
 */
export function isExcludedPath(path: string): boolean {
  return EXCLUDED_DIRS.some(dir => path.includes(`/${dir}/`) || path.startsWith(`${dir}/`));
}

// ── Docs quality ────────────────────────────────────

export function calculateDocsQuality(hasReadme: boolean, readmeLines: number, docsFileCount: number): DocsQuality {
  if (!hasReadme) return 'missing';
  if (readmeLines > 300 || docsFileCount >= 2) return 'excellent';
  if (readmeLines >= 50) return 'good';
  return 'needs_work';
}

// ── Testing metadata detection ──────────────────────

function detectTestTypes(paths: string[]) {
  const hasUnitTests = paths.some(p =>
    p.startsWith('test/unit/') || p.startsWith('tests/unit/')
  );

  const hasIntegrationTests = paths.some(p =>
    p.includes('/integration/') ||
    p.startsWith('test/integration/') || p.startsWith('tests/integration/')
  );

  let hasE2eTests = false;
  let e2eFramework: string | null = null;
  if (paths.some(p => /playwright\.config\.[jt]s$/.test(p))) {
    hasE2eTests = true; e2eFramework = 'playwright';
  } else if (paths.some(p => /cypress\.config\.[jt]s$/.test(p) || p.startsWith('cypress/'))) {
    hasE2eTests = true; e2eFramework = 'cypress';
  } else if (paths.some(p => p.startsWith('e2e/') || p.startsWith('test/e2e/') || p.startsWith('tests/e2e/'))) {
    hasE2eTests = true;
  }

  let testFramework: string | null = null;
  if (paths.some(p => /vitest\.config\.[jt]s$/.test(p))) testFramework = 'vitest';
  else if (paths.some(p => /jest\.config\.[jt]sx?$/.test(p) || p === 'jest.config.json')) testFramework = 'jest';
  else if (paths.some(p => p === 'pytest.ini' || p === 'conftest.py' || p.endsWith('/conftest.py'))) testFramework = 'pytest';
  else if (paths.some(p => /_test\.go$/.test(p))) testFramework = 'go-test';

  return { hasUnitTests, hasIntegrationTests, hasE2eTests, testFramework, e2eFramework };
}

function detectLintConfig(paths: string[]) {
  const eslintConfigs = [
    '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', 'eslint.config.mts',
  ];
  if (paths.some(p => eslintConfigs.includes(p))) return { hasLintConfig: true, lintTool: 'eslint' as string | null };
  if (paths.includes('biome.json') || paths.includes('biome.jsonc')) return { hasLintConfig: true, lintTool: 'biome' as string | null };
  if (paths.includes('ruff.toml') || paths.includes('.ruff.toml')) return { hasLintConfig: true, lintTool: 'ruff' as string | null };
  if (paths.includes('.flake8')) return { hasLintConfig: true, lintTool: 'flake8' as string | null };
  if (paths.includes('.golangci.yml') || paths.includes('.golangci.yaml')) return { hasLintConfig: true, lintTool: 'golangci-lint' as string | null };
  if (paths.includes('.rubocop.yml')) return { hasLintConfig: true, lintTool: 'rubocop' as string | null };
  return { hasLintConfig: false, lintTool: null as string | null };
}

function detectTypeChecking(paths: string[], language?: string | null) {
  if (paths.includes('tsconfig.json')) return { hasTypeChecking: true };
  if (paths.includes('mypy.ini') || paths.includes('.mypy.ini') || paths.includes('pyrightconfig.json') || paths.includes('py.typed')) return { hasTypeChecking: true };
  const implicitlyTyped = ['go', 'rust', 'java', 'kotlin', 'swift', 'c#'];
  if (language && implicitlyTyped.includes(language.toLowerCase())) return { hasTypeChecking: true };
  return { hasTypeChecking: false };
}

function detectSecurityScan(paths: string[]) {
  const indicators = [
    '.github/dependabot.yml', '.github/dependabot.yaml', '.snyk',
    '.github/workflows/codeql.yml', '.github/workflows/codeql-analysis.yml',
    'trivy.yaml', 'trivy.yml', '.github/workflows/security.yml',
  ];
  const has = indicators.some(i => paths.includes(i)) || paths.some(p => p.startsWith('.github/codeql/'));
  return { hasSecurityScan: has };
}

function detectPerfTests(paths: string[]) {
  const has = paths.some(p =>
    p.startsWith('benchmark/') || p.startsWith('benchmarks/') || p.startsWith('perf/') ||
    /\.bench\.[jt]sx?$/.test(p) ||
    p === 'k6.js' || p.startsWith('k6/') ||
    p === 'artillery.yml' || p === 'artillery.yaml' ||
    p === 'lighthouserc.js' || p === '.lighthouserc.js'
  );
  return { hasPerfTests: has };
}

/** Run all detection functions on a list of file paths. */
export function detectAllTestingMetadata(paths: string[], language?: string | null): TestingMetadata {
  return {
    ...detectTestTypes(paths),
    ...detectLintConfig(paths),
    ...detectTypeChecking(paths, language),
    ...detectSecurityScan(paths),
    ...detectPerfTests(paths),
  };
}
