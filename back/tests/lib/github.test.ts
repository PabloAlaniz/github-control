import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

// Mock @octokit/rest
const mockGetContent = vi.fn();
const mockGetReadme = vi.fn();
const mockRepoGet = vi.fn();
const mockGetTree = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () { return {
    repos: {
      getContent: mockGetContent,
      getReadme: mockGetReadme,
      get: mockRepoGet,
    },
    git: {
      getTree: mockGetTree,
    },
  }; }),
}));

// Import after mocking
import { checkRepoHealth, calculateDocsQuality, getRepoReadme, detectAllTestingMetadata } from '@back/lib/github';

// Helper to set up repos.get and git.getTree mocks
function mockTree(paths: string[], language = 'JavaScript') {
  mockRepoGet.mockResolvedValue({ data: { default_branch: 'main', language } });
  mockGetTree.mockResolvedValue({ data: { tree: paths.map(p => ({ path: p })) } });
}

describe('checkRepoHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all-true when repo has README, CI, tests, .gitignore', async () => {
    const readmeContent = Buffer.from('# Project\nLine 2\nLine 3').toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree(['.github/workflows/ci.yml', 'tests/unit.test.js', '.gitignore']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasReadme).toBe(true);
    expect(result.hasCi).toBe(true);
    expect(result.hasTests).toBe(true);
    expect(result.hasGitignore).toBe(true);
  });

  it('returns hasReadme=false when README is missing (404)', async () => {
    const error: any = new Error('Not found');
    error.status = 404;
    mockGetReadme.mockRejectedValue(error);
    mockTree(['src/index.js']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasReadme).toBe(false);
    expect(result.readmeLines).toBe(0);
  });

  it('counts readme lines correctly', async () => {
    const lines = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const readmeContent = Buffer.from(lines).toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree(['src/index.js']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasReadme).toBe(true);
    expect(result.readmeLines).toBe(5);
  });

  it('detects tests from tree paths (tests/ dir)', async () => {
    const readmeContent = Buffer.from('# README').toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree(['src/index.js', 'tests/unit.test.js']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasTests).toBe(true);
    expect(result.hasCi).toBe(false);
    expect(result.hasGitignore).toBe(false);
  });

  it('returns hasTests=false when no test directories or files exist', async () => {
    const readmeContent = Buffer.from('# README').toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree(['src/index.js', 'package.json']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasTests).toBe(false);
  });

  it('returns hasCi=false when no .github/workflows exists', async () => {
    const readmeContent = Buffer.from('# README').toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree(['src/index.js']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasCi).toBe(false);
  });

  it('throws when getRepoReadme encounters a non-404 error (e.g. 403 rate limit)', async () => {
    const error: any = new Error('Forbidden');
    error.status = 403;
    mockGetReadme.mockRejectedValue(error);
    mockTree(['src/index.js']);

    await expect(checkRepoHealth(mockEnv as any, 'owner', 'repo')).rejects.toThrow('Forbidden');
  });

  it('returns hasReadme=false when readme content is null', async () => {
    mockGetReadme.mockResolvedValue({
      data: { content: null, sha: 'abc123' },
    });
    mockTree(['src/index.js']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasReadme).toBe(false);
    expect(result.readmeLines).toBe(0);
  });

  it('counts .md files in docs directory', async () => {
    const readmeContent = Buffer.from('# README').toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree([
      '.github/workflows/ci.yml',
      '.gitignore',
      'docs/roadmap.md',
      'docs/api.md',
      'docs/setup.txt',
    ]);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.docsFileCount).toBe(2);
    expect(result.hasRoadmap).toBe(true);
  });

  it('returns docsFileCount=0 when no docs directory', async () => {
    const readmeContent = Buffer.from('# README').toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree(['src/index.js']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.docsFileCount).toBe(0);
  });

  it('correctly counts lines for a large README (500 lines)', async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`);
    const encoded = Buffer.from(lines.join('\n')).toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: encoded, sha: 'sha500' },
    });
    mockTree(['src/index.js']);

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasReadme).toBe(true);
    expect(result.readmeLines).toBe(500);
  });

  it('throws when getRepoReadme encounters a network error', async () => {
    mockGetReadme.mockRejectedValue(new Error('Network timeout'));
    mockTree(['src/index.js']);

    await expect(checkRepoHealth(mockEnv as any, 'owner', 'repo')).rejects.toThrow('Network timeout');
  });

  it('detects testing metadata (unit tests, lint config, etc.)', async () => {
    const readmeContent = Buffer.from('# README').toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: readmeContent, sha: 'abc123' },
    });
    mockTree([
      'src/index.ts',
      'tests/unit/utils.test.ts',
      'eslint.config.js',
      'tsconfig.json',
      '.github/dependabot.yml',
    ], 'TypeScript');

    const result = await checkRepoHealth(mockEnv as any, 'owner', 'repo');

    expect(result.hasUnitTests).toBe(true);
    expect(result.hasLintConfig).toBe(true);
    expect(result.hasTypeChecking).toBe(true);
    expect(result.hasSecurityScan).toBe(true);
  });
});

describe('detectAllTestingMetadata', () => {
  it('detects unit test files in tests/unit/', () => {
    const result = detectAllTestingMetadata(['tests/unit/utils.test.ts', 'src/index.ts']);
    expect(result.hasUnitTests).toBe(true);
  });

  it('does not detect unit tests from file name alone', () => {
    const result = detectAllTestingMetadata(['src/utils.test.ts', 'src/index.ts']);
    expect(result.hasUnitTests).toBe(false);
  });

  it('detects integration tests', () => {
    const result = detectAllTestingMetadata(['tests/integration/api.test.ts']);
    expect(result.hasIntegrationTests).toBe(true);
  });

  it('detects E2E frameworks', () => {
    const result = detectAllTestingMetadata(['playwright.config.ts', 'e2e/login.spec.ts']);
    expect(result.hasE2eTests).toBe(true);
    expect(result.e2eFramework).toBe('playwright');
  });

  it('detects lint configs', () => {
    const result = detectAllTestingMetadata(['eslint.config.js', 'src/index.ts']);
    expect(result.hasLintConfig).toBe(true);
    expect(result.lintTool).toBe('eslint');
  });

  it('detects type checking for TypeScript', () => {
    const result = detectAllTestingMetadata(['tsconfig.json', 'src/index.ts']);
    expect(result.hasTypeChecking).toBe(true);
  });

  it('detects type checking for Pyright', () => {
    const result = detectAllTestingMetadata(['pyrightconfig.json', 'src/main.py']);
    expect(result.hasTypeChecking).toBe(true);
  });

  it('detects type checking for py.typed marker', () => {
    const result = detectAllTestingMetadata(['py.typed', 'src/main.py']);
    expect(result.hasTypeChecking).toBe(true);
  });

  it('detects implicit type checking for Go', () => {
    const result = detectAllTestingMetadata(['main.go'], 'Go');
    expect(result.hasTypeChecking).toBe(true);
  });

  it('detects security scan tools', () => {
    const result = detectAllTestingMetadata(['.github/dependabot.yml']);
    expect(result.hasSecurityScan).toBe(true);
  });

  it('detects performance tests', () => {
    const result = detectAllTestingMetadata(['benchmarks/load.js']);
    expect(result.hasPerfTests).toBe(true);
  });

  it('returns all false for empty paths', () => {
    const result = detectAllTestingMetadata([]);
    expect(result.hasUnitTests).toBe(false);
    expect(result.hasIntegrationTests).toBe(false);
    expect(result.hasE2eTests).toBe(false);
    expect(result.hasLintConfig).toBe(false);
    expect(result.hasTypeChecking).toBe(false);
    expect(result.hasSecurityScan).toBe(false);
    expect(result.hasPerfTests).toBe(false);
  });
});

describe('calculateDocsQuality', () => {
  it('returns missing when no README', () => {
    expect(calculateDocsQuality(false, 0, 0)).toBe('missing');
  });

  it('returns needs_work when README has < 50 lines', () => {
    expect(calculateDocsQuality(true, 30, 0)).toBe('needs_work');
  });

  it('returns good when README has 50-300 lines', () => {
    expect(calculateDocsQuality(true, 100, 0)).toBe('good');
  });

  it('returns excellent when README has > 300 lines', () => {
    expect(calculateDocsQuality(true, 350, 0)).toBe('excellent');
  });

  it('returns excellent when docs has >= 2 .md files', () => {
    expect(calculateDocsQuality(true, 30, 2)).toBe('excellent');
  });

  it('returns good at exactly 50 lines', () => {
    expect(calculateDocsQuality(true, 50, 0)).toBe('good');
  });

  it('returns needs_work at 49 lines', () => {
    expect(calculateDocsQuality(true, 49, 0)).toBe('needs_work');
  });
});

describe('getRepoReadme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decodes base64 content and returns it with sha', async () => {
    const original = '# My Project\n\nThis is a test README.\n';
    const encoded = Buffer.from(original).toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: encoded, sha: 'abc123' },
    });

    const result = await getRepoReadme(mockEnv as any, 'owner', 'repo');

    expect(result).not.toBeNull();
    expect(result!.content).toBe(original);
    expect(result!.sha).toBe('abc123');
  });

  it('handles a realistic large README (200+ lines)', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: some documentation content here`);
    const original = lines.join('\n');
    const encoded = Buffer.from(original).toString('base64');
    mockGetReadme.mockResolvedValue({
      data: { content: encoded, sha: 'sha200' },
    });

    const result = await getRepoReadme(mockEnv as any, 'owner', 'repo');

    expect(result).not.toBeNull();
    expect(result!.content.split('\n')).toHaveLength(200);
  });

  it('returns null for a 404 (repo has no README)', async () => {
    const error: any = new Error('Not Found');
    error.status = 404;
    mockGetReadme.mockRejectedValue(error);

    const result = await getRepoReadme(mockEnv as any, 'owner', 'repo');

    expect(result).toBeNull();
  });

  it('returns null when content is null (large file)', async () => {
    mockGetReadme.mockResolvedValue({
      data: { content: null, sha: 'abc123' },
    });

    const result = await getRepoReadme(mockEnv as any, 'owner', 'repo');

    expect(result).toBeNull();
  });

  it('throws for non-404 errors (e.g. 403 rate limit)', async () => {
    const error: any = new Error('API rate limit exceeded');
    error.status = 403;
    mockGetReadme.mockRejectedValue(error);

    await expect(getRepoReadme(mockEnv as any, 'owner', 'repo')).rejects.toThrow('API rate limit exceeded');
  });

  it('throws for 500 server errors', async () => {
    const error: any = new Error('Internal Server Error');
    error.status = 500;
    mockGetReadme.mockRejectedValue(error);

    await expect(getRepoReadme(mockEnv as any, 'owner', 'repo')).rejects.toThrow('Internal Server Error');
  });
});
