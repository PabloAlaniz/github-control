import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalyzerInput, Analyzer } from './types';

// child_process is not available in Cloudflare Workers (even with nodejs_compat).
// Use conditional top-level await so the module still loads in the Worker context.
let _execSync: ((cmd: string, opts?: any) => Buffer) | null = null;
try {
  _execSync = (await import('node:child_process')).execSync;
} catch {
  // Workers runtime — coverage runner disabled
}

interface CoverageResult {
  coverageConfigDetected: boolean;
  coverageToolDetected: string | null;
  estimatedCoverage: number | null;
}

// ---------------------------------------------------------------------------
// Config file → tool mapping
// ---------------------------------------------------------------------------

const CONFIG_TO_TOOL: Array<{ pattern: string; tool: string }> = [
  { pattern: '.nycrc', tool: 'nyc' },
  { pattern: '.nycrc.json', tool: 'nyc' },
  { pattern: '.nycrc.yml', tool: 'nyc' },
  { pattern: '.nycrc.yaml', tool: 'nyc' },
  { pattern: '.c8rc.json', tool: 'c8' },
  { pattern: '.c8rc', tool: 'c8' },
  { pattern: '.coveragerc', tool: 'coverage.py' },
  { pattern: 'setup.cfg', tool: 'coverage.py' },
  { pattern: 'jest.config.js', tool: 'jest' },
  { pattern: 'jest.config.ts', tool: 'jest' },
  { pattern: 'jest.config.json', tool: 'jest' },
  { pattern: 'vitest.config.js', tool: 'vitest' },
  { pattern: 'vitest.config.ts', tool: 'vitest' },
  { pattern: 'jacoco.xml', tool: 'jacoco' },
  { pattern: 'pom.xml', tool: 'jacoco' },
  { pattern: 'tarpaulin.toml', tool: 'tarpaulin' },
];

// ---------------------------------------------------------------------------
// Report parsers
// ---------------------------------------------------------------------------

function parseLcov(content: string): number | null {
  let linesFound = 0;
  let linesHit = 0;
  for (const line of content.split('\n')) {
    if (line.startsWith('LF:')) linesFound += parseInt(line.slice(3), 10) || 0;
    if (line.startsWith('LH:')) linesHit += parseInt(line.slice(3), 10) || 0;
  }
  return linesFound > 0 ? Math.round((linesHit / linesFound) * 100) : null;
}

function parseJestCoverageSummary(content: string): number | null {
  try {
    const data = JSON.parse(content);
    return data?.total?.lines?.pct ?? data?.total?.statements?.pct ?? null;
  } catch {
    return null;
  }
}

function parseCoberturaXml(content: string): number | null {
  const match = content.match(/line-rate="([^"]+)"/);
  if (match) return Math.round(parseFloat(match[1]) * 100);
  return null;
}

function parseHtmlCovIndex(content: string): number | null {
  // Python coverage.py HTML reports typically include a percentage in the header
  const match = content.match(/(\d{1,3})%/);
  if (match) {
    const pct = parseInt(match[1], 10);
    if (pct >= 0 && pct <= 100) return pct;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Report locations to probe
// ---------------------------------------------------------------------------

const REPORT_LOCATIONS: Array<{
  path: string;
  parser: (content: string) => number | null;
}> = [
  { path: 'coverage/coverage-summary.json', parser: parseJestCoverageSummary },
  { path: 'coverage/lcov.info', parser: parseLcov },
  { path: 'coverage.xml', parser: parseCoberturaXml },
  { path: 'htmlcov/index.html', parser: parseHtmlCovIndex },
];

// ---------------------------------------------------------------------------
// CI workflow scanning
// ---------------------------------------------------------------------------

const COVERAGE_CI_PATTERNS = ['--coverage', '--cov', '-coverprofile', 'coverageThreshold'];

function detectCoverageInCiFiles(cloneDir: string): string | null {
  const workflowDir = join(cloneDir, '.github', 'workflows');
  if (!existsSync(workflowDir)) return null;

  try {
    const files = readdirSync(workflowDir).filter(
      f => f.endsWith('.yml') || f.endsWith('.yaml'),
    );
    for (const file of files) {
      try {
        const content = readFileSync(join(workflowDir, file), 'utf-8');
        for (const pattern of COVERAGE_CI_PATTERNS) {
          if (content.includes(pattern)) return 'ci-detected';
        }
      } catch {
        // unreadable file — skip
      }
    }
  } catch {
    // can't read workflow dir
  }

  return null;
}

// ---------------------------------------------------------------------------
// Level 1 — Config detection (from paths, optionally CI files)
// ---------------------------------------------------------------------------

function detectFromConfig(
  input: AnalyzerInput,
): { detected: boolean; tool: string | null } {
  // Check file paths for known config files
  for (const { pattern, tool } of CONFIG_TO_TOOL) {
    if (input.paths.some(p => p === pattern || p.endsWith(`/${pattern}`))) {
      return { detected: true, tool };
    }
  }

  // Scan CI workflows when cloneDir is available
  if (input.cloneDir) {
    const ciTool = detectCoverageInCiFiles(input.cloneDir);
    if (ciTool) return { detected: true, tool: ciTool };
  }

  return { detected: false, tool: null };
}

// ---------------------------------------------------------------------------
// Level 2 — Report parsing (requires cloneDir)
// ---------------------------------------------------------------------------

function parseExistingReports(cloneDir: string): number | null {
  for (const { path: reportPath, parser } of REPORT_LOCATIONS) {
    const fullPath = join(cloneDir, reportPath);
    if (!existsSync(fullPath)) continue;

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const pct = parser(content);
      if (pct !== null) return pct;
    } catch {
      // unreadable — try next
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Level 3 — Test runner (only when runCoverage is true)
// ---------------------------------------------------------------------------

interface CoverageRunConfig {
  install: string;
  command: string;
  reportPath: string;
  parser: (content: string) => number | null;
}

function getRunConfig(stack: string | null): CoverageRunConfig | null {
  switch (stack) {
    case 'node':
      return {
        install: 'npm ci --ignore-scripts',
        command: 'npx vitest run --coverage --reporter=json 2>/dev/null || npx jest --coverage --json 2>/dev/null',
        reportPath: 'coverage/coverage-summary.json',
        parser: parseJestCoverageSummary,
      };
    case 'python':
      return {
        install: 'pip install -e ".[test]" 2>/dev/null || pip install -r requirements.txt 2>/dev/null',
        command: 'pytest --cov --cov-report=json 2>/dev/null',
        reportPath: 'coverage.json',
        parser: (content: string) => {
          try {
            const data = JSON.parse(content);
            return data?.totals?.percent_covered != null
              ? Math.round(data.totals.percent_covered)
              : null;
          } catch {
            return null;
          }
        },
      };
    case 'go':
      return {
        install: '',
        command: 'go test -coverprofile=coverage.out ./... 2>/dev/null',
        reportPath: 'coverage.out',
        parser: (content: string) => {
          // Parse go coverage.out — count statements covered vs total
          let total = 0;
          let covered = 0;
          for (const line of content.split('\n')) {
            const match = line.match(/(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(\d+)/);
            if (match) {
              const stmts = parseInt(match[5], 10);
              const count = parseInt(match[6], 10);
              total += stmts;
              if (count > 0) covered += stmts;
            }
          }
          return total > 0 ? Math.round((covered / total) * 100) : null;
        },
      };
    case 'rust':
      return {
        install: 'cargo install cargo-tarpaulin 2>/dev/null',
        command: 'cargo tarpaulin --out Json 2>/dev/null',
        reportPath: 'tarpaulin-report.json',
        parser: (content: string) => {
          try {
            const data = JSON.parse(content);
            return data?.coverage != null ? Math.round(data.coverage) : null;
          } catch {
            return null;
          }
        },
      };
    default:
      return null;
  }
}

function inferStack(input: AnalyzerInput): string | null {
  if (input.language) {
    const lang = input.language.toLowerCase();
    if (['javascript', 'typescript'].includes(lang)) return 'node';
    if (lang === 'python') return 'python';
    if (lang === 'go') return 'go';
    if (lang === 'rust') return 'rust';
  }

  // Fallback: detect from paths
  if (input.paths.some(p => p === 'package.json')) return 'node';
  if (input.paths.some(p => p === 'pyproject.toml' || p === 'setup.py' || p === 'requirements.txt'))
    return 'python';
  if (input.paths.some(p => p === 'go.mod')) return 'go';
  if (input.paths.some(p => p === 'Cargo.toml')) return 'rust';

  return null;
}

function runCoverageCommand(
  input: AnalyzerInput & { runCoverage?: boolean; coverageTimeout?: number },
): number | null {
  if (!input.runCoverage || !input.cloneDir) return null;
  if (!_execSync) return null; // child_process not available (Workers)

  const stack = inferStack(input);
  const config = getRunConfig(stack);
  if (!config) return null;

  const timeout = input.coverageTimeout ?? 120_000;

  try {
    // Install dependencies
    if (config.install) {
      _execSync(config.install, {
        cwd: input.cloneDir,
        timeout,
        stdio: 'ignore',
      });
    }

    // Run coverage command
    _execSync(config.command, {
      cwd: input.cloneDir,
      timeout,
      stdio: 'ignore',
      shell: '/bin/sh',
    });

    // Parse the report
    const reportPath = join(input.cloneDir, config.reportPath);
    if (existsSync(reportPath)) {
      const content = readFileSync(reportPath, 'utf-8');
      return config.parser(content);
    }
  } catch {
    // Coverage run failed — return null
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export const analyzeCoverage: Analyzer<CoverageResult> = (
  input: AnalyzerInput & { runCoverage?: boolean; coverageTimeout?: number },
): CoverageResult => {
  // Level 1 — Config detection
  const { detected: coverageConfigDetected, tool: coverageToolDetected } =
    detectFromConfig(input);

  // Level 2 — Report parsing (when cloneDir is available)
  let estimatedCoverage: number | null = null;
  if (input.cloneDir) {
    estimatedCoverage = parseExistingReports(input.cloneDir);
  }

  // Level 3 — Test runner (only when runCoverage is true and no report found)
  if (estimatedCoverage === null) {
    estimatedCoverage = runCoverageCommand(input);
  }

  return {
    coverageConfigDetected,
    coverageToolDetected,
    estimatedCoverage,
  };
};
