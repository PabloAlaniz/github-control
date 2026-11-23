import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockReaddirSync = vi.fn();
vi.mock('node:fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  readdirSync: (...args: any[]) => mockReaddirSync(...args),
}));

// Mock node:child_process
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
}));

import { analyzeCoverage } from '@back/lib/analyzers/coverage.analyzer';

describe('coverage.analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Level 1: Config detection ─────────────────

  describe('config detection from paths', () => {
    it('detects nyc config', () => {
      const result = analyzeCoverage({ paths: ['.nycrc', 'src/index.ts'], language: null });
      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('nyc');
    });

    it('detects vitest config', () => {
      const result = analyzeCoverage({ paths: ['vitest.config.ts', 'src/app.ts'], language: null });
      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('vitest');
    });

    it('detects jest config in nested path', () => {
      const result = analyzeCoverage({ paths: ['apps/web/jest.config.js'], language: null });
      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('jest');
    });

    it('detects c8 config', () => {
      const result = analyzeCoverage({ paths: ['.c8rc.json'], language: null });
      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('c8');
    });

    it('detects python coverage config', () => {
      const result = analyzeCoverage({ paths: ['.coveragerc', 'main.py'], language: 'Python' });
      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('coverage.py');
    });

    it('detects jacoco via pom.xml', () => {
      const result = analyzeCoverage({ paths: ['pom.xml', 'src/Main.java'], language: 'Java' });
      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('jacoco');
    });

    it('detects tarpaulin config', () => {
      const result = analyzeCoverage({ paths: ['tarpaulin.toml', 'src/main.rs'], language: 'Rust' });
      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('tarpaulin');
    });

    it('returns false when no config found', () => {
      const result = analyzeCoverage({ paths: ['src/index.ts', 'README.md'], language: null });
      expect(result.coverageConfigDetected).toBe(false);
      expect(result.coverageToolDetected).toBeNull();
    });
  });

  // ── Level 1: CI file scanning ─────────────────

  describe('CI file scanning', () => {
    it('detects coverage in CI workflows', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['ci.yml']);
      mockReadFileSync.mockReturnValue('run: npx vitest run --coverage');

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.coverageConfigDetected).toBe(true);
      expect(result.coverageToolDetected).toBe('ci-detected');
    });

    it('handles missing workflow dir', () => {
      mockExistsSync.mockReturnValue(false);

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.coverageConfigDetected).toBe(false);
    });

    it('handles unreadable workflow files', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['ci.yml']);
      mockReadFileSync.mockImplementation(() => { throw new Error('EACCES'); });

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.coverageConfigDetected).toBe(false);
    });

    it('skips non-yaml files in workflows dir', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['readme.txt', 'ci.yml']);
      mockReadFileSync.mockReturnValue('just a normal workflow');

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.coverageConfigDetected).toBe(false);
    });
  });

  // ── Level 2: Report parsing ───────────────────

  describe('report parsing', () => {
    it('parses LCOV report', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('workflows')) return false;
        return p.includes('lcov.info');
      });
      mockReadFileSync.mockReturnValue('LF:100\nLH:75\nLF:50\nLH:25\n');

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.estimatedCoverage).toBe(67); // (75+25)/(100+50) = 66.67 → 67
    });

    it('parses Jest coverage-summary.json', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('workflows')) return false;
        return p.includes('coverage-summary.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        total: { lines: { pct: 85.5 } },
      }));

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.estimatedCoverage).toBe(85.5);
    });

    it('parses Cobertura XML', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('workflows')) return false;
        if (p.includes('coverage-summary.json')) return false;
        if (p.includes('lcov.info')) return false;
        return p.includes('coverage.xml');
      });
      mockReadFileSync.mockReturnValue('<coverage line-rate="0.923" branch-rate="0.85">');

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.estimatedCoverage).toBe(92);
    });

    it('parses Python HTML coverage report', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('workflows')) return false;
        if (p.includes('coverage-summary.json')) return false;
        if (p.includes('lcov.info')) return false;
        if (p.includes('coverage.xml')) return false;
        return p.includes('htmlcov/index.html');
      });
      mockReadFileSync.mockReturnValue('<h1>Coverage report: 78%</h1>');

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.estimatedCoverage).toBe(78);
    });

    it('returns null when no reports found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = analyzeCoverage({
        paths: ['src/index.ts'],
        language: null,
        cloneDir: '/tmp/repo',
      });

      expect(result.estimatedCoverage).toBeNull();
    });
  });

  // ── Level 3: Test runner ──────────────────────

  describe('test runner (runCoverage)', () => {
    it('skips when runCoverage is false', () => {
      const result = analyzeCoverage({
        paths: ['package.json', 'src/index.ts'],
        language: 'TypeScript',
        cloneDir: '/tmp/repo',
        runCoverage: false,
      } as any);

      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('skips when no cloneDir', () => {
      const result = analyzeCoverage({
        paths: ['package.json'],
        language: 'TypeScript',
        runCoverage: true,
      } as any);

      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('runs node coverage and parses report', () => {
      // Level 2 must find no reports; Level 3 generates one after execSync
      let execRan = false;
      mockExecSync.mockImplementation(() => { execRan = true; });
      mockExistsSync.mockImplementation((p: string) => {
        // Level 3: report exists only after exec ran
        if (p.includes('coverage-summary.json') && execRan) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        total: { statements: { pct: 72 } },
      }));

      const result = analyzeCoverage({
        paths: ['package.json', 'src/index.ts'],
        language: 'TypeScript',
        cloneDir: '/tmp/repo',
        runCoverage: true,
      } as any);

      expect(mockExecSync).toHaveBeenCalled();
      expect(result.estimatedCoverage).toBe(72);
    });

    it('handles exec failure gracefully', () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => { throw new Error('command failed'); });

      const result = analyzeCoverage({
        paths: ['package.json'],
        language: 'TypeScript',
        cloneDir: '/tmp/repo',
        runCoverage: true,
      } as any);

      expect(result.estimatedCoverage).toBeNull();
    });

    it('returns null for unknown stack', () => {
      mockExistsSync.mockReturnValue(false);

      const result = analyzeCoverage({
        paths: ['main.zig'],
        language: 'Zig',
        cloneDir: '/tmp/repo',
        runCoverage: true,
      } as any);

      expect(result.estimatedCoverage).toBeNull();
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('infers python stack and uses pytest', () => {
      let execRan = false;
      mockExecSync.mockImplementation(() => { execRan = true; });
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('coverage.json') && execRan) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        totals: { percent_covered: 88.5 },
      }));

      const result = analyzeCoverage({
        paths: ['requirements.txt', 'main.py'],
        language: 'Python',
        cloneDir: '/tmp/repo',
        runCoverage: true,
      } as any);

      expect(result.estimatedCoverage).toBe(89);
    });

    it('infers go stack', () => {
      let execRan = false;
      mockExecSync.mockImplementation(() => { execRan = true; });
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('coverage.out') && execRan) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(
        'mode: set\nmain.go:1.1,5.1 3 1\nmain.go:7.1,10.1 2 0\n',
      );

      const result = analyzeCoverage({
        paths: ['go.mod', 'main.go'],
        language: 'Go',
        cloneDir: '/tmp/repo',
        runCoverage: true,
      } as any);

      expect(result.estimatedCoverage).toBe(60); // 3 covered out of 5 total
    });

    it('infers rust stack', () => {
      let execRan = false;
      mockExecSync.mockImplementation(() => { execRan = true; });
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('tarpaulin-report.json') && execRan) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ coverage: 45.3 }));

      const result = analyzeCoverage({
        paths: ['Cargo.toml', 'src/main.rs'],
        language: 'Rust',
        cloneDir: '/tmp/repo',
        runCoverage: true,
      } as any);

      expect(result.estimatedCoverage).toBe(45);
    });
  });
});
