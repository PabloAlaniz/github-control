import { detectAllTestingMetadata } from '../github/detection';
import type { AnalyzerInput, Analyzer } from './types';

interface TestingResult {
  hasTests: boolean;
  hasUnitTests: boolean;
  hasIntegrationTests: boolean;
  hasE2eTests: boolean;
  testFramework: string | null;
  e2eFramework: string | null;
  hasLintConfig: boolean;
  lintTool: string | null;
  hasTypeChecking: boolean;
  hasSecurityScan: boolean;
  hasPerfTests: boolean;
}

const TEST_DIR_PREFIXES = ['test/', 'tests/', 'spec/', '__tests__/'];

export const analyzeTesting: Analyzer<TestingResult> = (input: AnalyzerInput): TestingResult => {
  const metadata = detectAllTestingMetadata(input.paths, input.language);

  const hasTestDir = input.paths.some(p =>
    TEST_DIR_PREFIXES.some(prefix => p.startsWith(prefix)) ||
    p.includes('__tests__/'),
  );

  const hasTests =
    metadata.hasUnitTests ||
    metadata.hasIntegrationTests ||
    metadata.hasE2eTests ||
    hasTestDir;

  return {
    hasTests,
    hasUnitTests: metadata.hasUnitTests,
    hasIntegrationTests: metadata.hasIntegrationTests,
    hasE2eTests: metadata.hasE2eTests,
    testFramework: metadata.testFramework,
    e2eFramework: metadata.e2eFramework,
    hasLintConfig: metadata.hasLintConfig,
    lintTool: metadata.lintTool,
    hasTypeChecking: metadata.hasTypeChecking,
    hasSecurityScan: metadata.hasSecurityScan,
    hasPerfTests: metadata.hasPerfTests,
  };
};
