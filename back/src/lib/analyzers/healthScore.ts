/**
 * Health Score: 0-100 composite score per repo.
 * Weights total 100, distributed across 6 categories.
 * Pure function — no DB or network IO. Tests in tests/lib/analyzers/healthScore.analyzer.test.ts.
 */

import { HEALTH_CATEGORIES, type HealthPolicy } from '../../domain/policy';

export interface HealthScoreInput {
  // CI
  hasCi?: boolean | null;
  // Tests
  hasTests?: boolean | null;
  hasUnitTests?: boolean | null;
  hasIntegrationTests?: boolean | null;
  hasE2eTests?: boolean | null;
  testCoverage?: number | null;        // 0-100
  // Docs
  hasReadme?: boolean | null;
  readmeLines?: number | null;
  hasRoadmap?: boolean | null;
  docsQuality?: 'excellent' | 'good' | 'needs_work' | 'missing' | null;
  // Code quality
  hasLintConfig?: boolean | null;
  hasTypeChecking?: boolean | null;
  hasSecurityScan?: boolean | null;
  // Hygiene
  hasGitignore?: boolean | null;
  hasDocstrings?: boolean | null;
  /** The repo's standards checklist (`standards` signal); null = not synced. */
  standards?: { passed: number; total: number } | null;
  /** Results of the policy's custom checks (`policy` signal); null = not synced. */
  custom?: { id: string; passed: boolean | null }[] | null;
  // Freshness
  lastCommitAt?: string | Date | null;
  // Context
  isArchived?: boolean | null;
}

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface HealthCheck {
  key: string;
  label: string;
  passed: boolean | null;   // null = not checked / unknown
  weight: number;            // max points this check can earn
  earned: number;            // points actually earned (0..weight)
}

export interface HealthCategory {
  score: number;             // sum of earned in this category
  max: number;               // sum of weight in this category
  /** How much the category counts in the total, when a policy sets weights. */
  weight?: number;
  checks: HealthCheck[];
}

export interface HealthScoreResult {
  score: number;             // 0-100, integer
  grade: HealthGrade;
  archived: boolean;         // informational; archived repos still get a score
  breakdown: {
    ci: HealthCategory;
    tests: HealthCategory;
    docs: HealthCategory;
    quality: HealthCategory;
    hygiene: HealthCategory;
    freshness: HealthCategory;
    /** The policy's own checks; present only when the policy defines some. */
    custom?: HealthCategory;
  };
}

const DAY_MS = 1000 * 60 * 60 * 24;

function passCheck(value: boolean | null | undefined, weight: number, key: string, label: string): HealthCheck {
  const passed = value === true ? true : value === false ? false : null;
  return {
    key,
    label,
    passed,
    weight,
    earned: passed === true ? weight : 0,
  };
}

function coverageCheck(coverage: number | null | undefined): HealthCheck {
  let earned = 0;
  let passed: boolean | null;
  if (coverage == null) {
    passed = null;
  } else if (coverage >= 80) {
    earned = 5;
    passed = true;
  } else if (coverage >= 50) {
    earned = 3;
    passed = true;
  } else if (coverage >= 20) {
    earned = 1;
    passed = true;
  } else {
    earned = 0;
    passed = false;
  }
  return {
    key: 'testCoverage',
    label: coverage == null ? 'Test coverage (unknown)' : `Test coverage ${coverage}%`,
    passed,
    weight: 5,
    earned,
  };
}

function readmeLengthCheck(lines: number | null | undefined): HealthCheck {
  let earned = 0;
  let passed: boolean | null;
  if (lines == null) {
    passed = null;
  } else if (lines >= 50) {
    earned = 3;
    passed = true;
  } else if (lines >= 20) {
    earned = 2;
    passed = true;
  } else if (lines >= 5) {
    earned = 1;
    passed = true;
  } else {
    passed = false;
  }
  return {
    key: 'readmeLines',
    label: lines == null ? 'README length (unknown)' : `README length (${lines} lines)`,
    passed,
    weight: 3,
    earned,
  };
}

function docsQualityCheck(quality: HealthScoreInput['docsQuality']): HealthCheck {
  const map: Record<string, number> = { excellent: 4, good: 3, needs_work: 1, missing: 0 };
  const earned = quality && quality in map ? map[quality] : 0;
  const passed = quality == null ? null : quality === 'missing' ? false : true;
  return {
    key: 'docsQuality',
    label: quality ? `Docs quality: ${quality.replace('_', ' ')}` : 'Docs quality (unknown)',
    passed,
    weight: 4,
    earned,
  };
}

function freshnessCheck(lastCommitAt: HealthScoreInput['lastCommitAt']): HealthCheck {
  if (lastCommitAt == null) {
    return {
      key: 'freshness',
      label: 'Last commit (unknown)',
      passed: null,
      weight: 20,
      earned: 0,
    };
  }
  const last = new Date(lastCommitAt);
  if (Number.isNaN(last.getTime())) {
    return {
      key: 'freshness',
      label: 'Last commit (invalid date)',
      passed: null,
      weight: 20,
      earned: 0,
    };
  }
  const days = Math.floor((Date.now() - last.getTime()) / DAY_MS);
  let earned: number;
  let passed: boolean;
  if (days <= 30) { earned = 20; passed = true; }
  else if (days <= 90) { earned = 15; passed = true; }
  else if (days <= 180) { earned = 10; passed = true; }
  else if (days <= 365) { earned = 5; passed = false; }
  else { earned = 0; passed = false; }
  return {
    key: 'freshness',
    label: `Last commit ${days}d ago`,
    passed,
    weight: 20,
    earned,
  };
}

/**
 * Hygiene is worth 10 points. Without a standards checklist it is split 5/5
 * between .gitignore and docstrings (historical behaviour); with a checklist it
 * becomes 3/3/4, so syncing the standards never lowers the score by itself.
 */
function hygieneChecks(input: HealthScoreInput): HealthCheck[] {
  const standards = input.standards;
  if (!standards || !(standards.total > 0)) {
    return [
      passCheck(input.hasGitignore, 5, 'hasGitignore', '.gitignore'),
      passCheck(input.hasDocstrings, 5, 'hasDocstrings', 'Docstrings/comments'),
    ];
  }
  const ratio = Math.min(1, Math.max(0, standards.passed / standards.total));
  return [
    passCheck(input.hasGitignore, 3, 'hasGitignore', '.gitignore'),
    passCheck(input.hasDocstrings, 3, 'hasDocstrings', 'Docstrings/comments'),
    {
      key: 'standards',
      label: `Repo standards (${standards.passed}/${standards.total})`,
      passed: ratio >= 0.75,
      weight: 4,
      earned: Math.round(ratio * 4),
    },
  ];
}

function gradeFromScore(score: number): HealthGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function buildCategory(checks: HealthCheck[]): HealthCategory {
  return {
    score: checks.reduce((sum, c) => sum + c.earned, 0),
    max: checks.reduce((sum, c) => sum + c.weight, 0),
    checks,
  };
}

/**
 * Maps a row from the `repos` table (snake_case) into a HealthScoreInput.
 * Tolerates partial rows; missing fields become undefined and are treated
 * as "unknown" by computeHealthScore.
 */
export function repoRowToHealthInput(row: Record<string, any>): HealthScoreInput {
  return {
    hasCi: row.has_ci ?? row.hasCi,
    hasTests: row.has_tests ?? row.hasTests,
    hasUnitTests: row.has_unit_tests ?? row.hasUnitTests,
    hasIntegrationTests: row.has_integration_tests ?? row.hasIntegrationTests,
    hasE2eTests: row.has_e2e_tests ?? row.hasE2eTests,
    testCoverage: row.test_coverage ?? row.testCoverage,
    hasReadme: row.has_readme ?? row.hasReadme,
    readmeLines: row.readme_lines ?? row.readmeLines,
    hasRoadmap: row.has_roadmap ?? row.hasRoadmap,
    docsQuality: row.docs_quality ?? row.docsQuality,
    hasLintConfig: row.has_lint_config ?? row.hasLintConfig,
    hasTypeChecking: row.has_type_checking ?? row.hasTypeChecking,
    hasSecurityScan: row.has_security_scan ?? row.hasSecurityScan,
    hasGitignore: row.has_gitignore ?? row.hasGitignore,
    hasDocstrings: row.has_docstrings ?? row.hasDocstrings,
    custom: Array.isArray(row.signals?.policy?.checks) ? row.signals.policy.checks : null,
    standards: typeof row.signals?.standards?.total === 'number'
      ? { passed: Number(row.signals.standards.passed) || 0, total: row.signals.standards.total }
      : null,
    lastCommitAt: row.last_commit_at ?? row.lastCommitAt,
    isArchived: row.is_archived ?? row.isArchived,
  };
}

/** The policy's custom checks as a category; results come from the repo's `policy` signal. */
function customCategory(input: HealthScoreInput, health: HealthPolicy): HealthCategory {
  const results = new Map((input.custom ?? []).map((result) => [result.id, result.passed]));
  return buildCategory(health.checks
    // A check that does not apply to this repo neither adds nor costs points.
    .filter((check) => !(results.has(check.id) && results.get(check.id) === null))
    .map((check) => passCheck(results.has(check.id) ? results.get(check.id) : null, check.weight, `custom:${check.id}`, check.label)));
}

/**
 * Without a policy the score is the sum of the points earned (the categories
 * add up to 100). With one, each category counts for its weight and the total
 * is scaled back to 0-100, so weights are relative to each other.
 */
export function computeHealthScore(input: HealthScoreInput, health?: HealthPolicy): HealthScoreResult {
  const ci = buildCategory([
    passCheck(input.hasCi, 15, 'hasCi', 'CI/CD configured'),
  ]);

  const tests = buildCategory([
    passCheck(input.hasTests, 8, 'hasTests', 'Tests present'),
    passCheck(input.hasUnitTests, 5, 'hasUnitTests', 'Unit tests'),
    passCheck(input.hasIntegrationTests, 4, 'hasIntegrationTests', 'Integration tests'),
    passCheck(input.hasE2eTests, 3, 'hasE2eTests', 'End-to-end tests'),
    coverageCheck(input.testCoverage),
  ]);

  const docs = buildCategory([
    passCheck(input.hasReadme, 5, 'hasReadme', 'README present'),
    readmeLengthCheck(input.readmeLines),
    passCheck(input.hasRoadmap, 3, 'hasRoadmap', 'Roadmap present'),
    docsQualityCheck(input.docsQuality),
  ]);

  const quality = buildCategory([
    passCheck(input.hasLintConfig, 5, 'hasLintConfig', 'Lint config'),
    passCheck(input.hasTypeChecking, 5, 'hasTypeChecking', 'Type checking'),
    passCheck(input.hasSecurityScan, 5, 'hasSecurityScan', 'Security scan'),
  ]);

  const hygiene = buildCategory(hygieneChecks(input));

  const freshness = buildCategory([freshnessCheck(input.lastCommitAt)]);

  const breakdown: HealthScoreResult['breakdown'] = { ci, tests, docs, quality, hygiene, freshness };
  let score = ci.score + tests.score + docs.score + quality.score + hygiene.score + freshness.score;

  if (health) {
    let earned = 0;
    let total = 0;
    for (const name of HEALTH_CATEGORIES) {
      const category = breakdown[name];
      category.weight = health.weights[name];
      if (category.max > 0) earned += (category.score / category.max) * category.weight;
      total += category.weight;
    }
    if (health.checks.length > 0) {
      const custom = customCategory(input, health);
      custom.weight = health.weights.custom;
      breakdown.custom = custom;
      // Until the checks have run for this repo, they do not count against it.
      if (custom.max > 0 && custom.checks.some((check) => check.passed !== null)) {
        earned += (custom.score / custom.max) * custom.weight;
        total += custom.weight;
      }
    }
    score = total > 0 ? Math.round((earned / total) * 100) : 0;
  }

  return {
    score,
    grade: gradeFromScore(score),
    archived: input.isArchived === true,
    breakdown,
  };
}
