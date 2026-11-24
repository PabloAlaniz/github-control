#!/usr/bin/env npx tsx
/**
 * Fills the demo dataset (docs/demo/demo-data.json) with what a sync would add
 * beyond the repo list: signals for every repo, the uptime history of the
 * services and a couple of saved views.
 *
 * Everything is fictional and deterministic: running it again writes the same
 * file. The signals go through the real analyzers, so when the shape of a
 * signal changes, re-running this keeps the demo in step:
 *
 *   npx tsx back/scripts/demo-signals.ts
 *
 * Dates are relative to the file's `exported_at`; demo mode shifts them to today.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeBranches, type BranchInput, type PullInput } from '../src/lib/signals/branches';
import { analyzeRuns, type RunInput } from '../src/lib/signals/ci';
import { diffConfig } from '../src/lib/signals/config';
import { buildInbox, type PullState } from '../src/lib/signals/inbox';
import { summarizeScorecard } from '../src/lib/signals/scorecard';
import { summarizeFindings, type Finding } from '../src/lib/signals/vulnerabilities';
import { buildPolicy, parsePolicyDocument, policyBaseline, runCustomChecks } from '../src/domain/policy';
import { parseManifest, type Dependency, type RuntimeDecl } from '../src/lib/signals/manifests';
import { dedupeRuntimes } from '../src/lib/signals/runtimes';
import { summarizeAlerts, type SecurityAlert } from '../src/lib/signals/security';
import { analyzeStandards } from '../src/lib/signals/standards';

const FILE = fileURLToPath(new URL('../../docs/demo/demo-data.json', import.meta.url).href);
const POLICY = buildPolicy(parsePolicyDocument(
  readFileSync(fileURLToPath(new URL('../../docs/demo/policy.yml', import.meta.url).href), 'utf8'),
).document!);
const DAY = 86_400_000;
const MINUTE = 60_000;

type Row = Record<string, any>;

/** Small seeded generator (mulberry32), so every repo gets its own stable sequence. */
function random(seed: string) {
  let state = [...seed].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sha = (rand: () => number) => Array.from({ length: 40 }, () => Math.floor(rand() * 16).toString(16)).join('');

// ── What each fictional repo looks like ─────────────

/** Manifests per repo: `path -> contents`, parsed by the real manifest parsers. */
const MANIFESTS: Record<string, Record<string, string>> = {
  'storefront-web': {
    'package.json': JSON.stringify({
      engines: { node: '>=22' },
      dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0', next: '^15.3.0', zod: '^4.0.5', '@tanstack/react-query': '^5.80.0' },
      devDependencies: { typescript: '^5.8.3', vitest: '^3.2.0', eslint: '^9.28.0', tailwindcss: '^4.1.8' },
    }),
    '.nvmrc': '22\n',
  },
  'design-system': {
    'package.json': JSON.stringify({
      engines: { node: '>=20' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', clsx: '^2.1.1' },
      devDependencies: { typescript: '^5.8.3', vitest: '^3.2.0', eslint: '^9.28.0', storybook: '^9.0.4', tailwindcss: '^4.1.8' },
    }),
    '.nvmrc': '20\n',
  },
  'analytics-dashboard': {
    'package.json': JSON.stringify({
      dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0', recharts: '^2.15.3', zod: '^3.25.0', '@tanstack/react-query': '^4.36.1' },
      devDependencies: { typescript: '^5.4.5', vitest: '^1.6.0', eslint: '^8.57.0', tailwindcss: '^3.4.17' },
    }),
    '.nvmrc': '18\n',
  },
  'docs-site': {
    'package.json': JSON.stringify({
      dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0', next: '^15.3.0' },
      devDependencies: { typescript: '^5.8.3', eslint: '^9.28.0' },
    }),
    '.nvmrc': '22\n',
  },
  'hackathon-2024': {
    'package.json': JSON.stringify({ dependencies: { express: '^4.18.2', react: '^17.0.2' } }),
    '.nvmrc': '16\n',
  },
  'billing-worker': {
    'requirements.txt': 'fastapi==0.110.0\npydantic==1.10.15\nsqlalchemy==1.4.52\nhttpx==0.27.0\ncelery==5.3.6\n',
    '.python-version': '3.9\n',
  },
  'data-pipeline': {
    'requirements.txt': 'pandas==2.2.3\npydantic==2.11.5\nsqlalchemy==2.0.41\nhttpx==0.28.1\napache-airflow==2.10.5\n',
    '.python-version': '3.11\n',
  },
  'sdk-python': {
    'pyproject.toml': '[project]\nname = "acme-sdk"\nrequires-python = ">=3.10"\ndependencies = [\n  "httpx>=0.28",\n  "pydantic>=2.11",\n]\n',
    '.python-version': '3.12\n',
  },
  'checkout-api': {
    'go.mod': 'module github.com/acme/checkout-api\n\ngo 1.24\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.2.1\n\tgithub.com/jackc/pgx/v5 v5.7.5\n\tgo.uber.org/zap v1.27.0\n)\n',
  },
  'cli-tools': {
    'Cargo.toml': '[package]\nname = "acme-cli"\nversion = "2.4.1"\nedition = "2021"\n\n[dependencies]\nclap = "4.5"\nserde = "1.0"\ntokio = "1.45"\nreqwest = "0.12"\n',
  },
};

/** Open security alerts per repo. Repos not listed have alerts enabled and none open. */
const ALERTS: Record<string, SecurityAlert[]> = {
  'billing-worker': [
    { source: 'dependabot', severity: 'critical', title: 'sqlalchemy: SQL injection through crafted column names', url: null },
    { source: 'dependabot', severity: 'high', title: 'pydantic: regular expression denial of service', url: null },
    { source: 'codeScanning', severity: 'medium', title: 'Clear-text logging of sensitive information', url: null },
  ],
  'analytics-dashboard': [
    { source: 'dependabot', severity: 'high', title: 'vite: server.fs.deny bypass', url: null },
    { source: 'dependabot', severity: 'medium', title: 'esbuild: development server accepts any request', url: null },
    { source: 'dependabot', severity: 'low', title: 'brace-expansion: inefficient regular expression', url: null },
  ],
  'legacy-monolith': [
    { source: 'secretScanning', severity: 'critical', title: 'Stripe API key', url: null },
    { source: 'dependabot', severity: 'critical', title: 'guzzlehttp/guzzle: cross-domain cookie leakage', url: null },
    { source: 'dependabot', severity: 'high', title: 'symfony/http-kernel: privilege escalation', url: null },
    { source: 'dependabot', severity: 'high', title: 'twig/twig: sandbox bypass', url: null },
    { source: 'dependabot', severity: 'medium', title: 'monolog/monolog: log injection', url: null },
  ],
  'mobile-app': [
    { source: 'dependabot', severity: 'medium', title: 'okhttp: certificate pinning bypass on redirects', url: null },
  ],
};

/** Repos whose token cannot read alerts (shown as "not available"). */
const NO_ALERT_ACCESS = new Set(['infra-terraform', 'email-templates', 'hackathon-2024']);

/** Latest version per repo: [tag, days since published, commits not released yet]. */
const RELEASES: Record<string, [string, number, number]> = {
  'storefront-web': ['v3.12.0', 4, 7],
  'checkout-api': ['v1.8.2', 11, 3],
  'design-system': ['v5.2.0', 2, 0],
  'billing-worker': ['v0.9.4', 96, 41],
  'mobile-app': ['v2.6.0', 23, 18],
  'data-pipeline': ['2025.10.1', 48, 26],
  'docs-site': ['v1.3.0', 30, 12],
  'cli-tools': ['v2.4.1', 9, 0],
  'sdk-python': ['v1.14.0', 6, 2],
  'legacy-monolith': ['v7.41.3', 310, 64],
};

/** Downloads of release files, for the public repos that ship some. */
const DOWNLOADS: Record<string, number> = { 'cli-tools': 18420, 'sdk-python': 6310, 'design-system': 2975 };

/** How tidy each repo is, 0..1: drives standards, branch leftovers and settings drift. */
const TIDINESS: Record<string, number> = {
  'storefront-web': 0.9, 'checkout-api': 0.8, 'design-system': 1, 'billing-worker': 0.45, 'mobile-app': 0.6,
  'data-pipeline': 0.5, 'infra-terraform': 0.35, 'docs-site': 0.7, 'cli-tools': 0.85, 'analytics-dashboard': 0.4,
  'email-templates': 0.2, 'legacy-monolith': 0.15, 'hackathon-2024': 0.1, 'sdk-python': 0.95,
};

/** CI success rate and average duration (seconds) per repo that has CI. */
const CI_PROFILE: Record<string, { success: number; duration: number; flaky: number }> = {
  'storefront-web': { success: 0.96, duration: 410, flaky: 0.02 },
  'checkout-api': { success: 0.98, duration: 190, flaky: 0 },
  'design-system': { success: 0.99, duration: 260, flaky: 0 },
  'billing-worker': { success: 0.71, duration: 540, flaky: 0.12 },
  'mobile-app': { success: 0.88, duration: 1260, flaky: 0.06 },
  'data-pipeline': { success: 0.9, duration: 720, flaky: 0.03 },
  'docs-site': { success: 0.97, duration: 95, flaky: 0 },
  'cli-tools': { success: 0.95, duration: 330, flaky: 0.01 },
  'analytics-dashboard': { success: 0.82, duration: 380, flaky: 0.08 },
  'legacy-monolith': { success: 0.58, duration: 1840, flaky: 0.15 },
  'sdk-python': { success: 0.99, duration: 150, flaky: 0 },
};

// ── Signals ─────────────────────────────────────────

/** Packages that come along with the declared ones, per ecosystem: what a lockfile adds. */
const TRANSITIVE: Record<string, [string, string[]][]> = {
  npm: [
    ['scheduler', ['0.26.0', '0.23.2']], ['loose-envify', ['1.4.0']], ['js-tokens', ['4.0.0']], ['nanoid', ['3.3.11', '3.3.7']],
    ['picocolors', ['1.1.1']], ['source-map-js', ['1.2.1']], ['postcss', ['8.5.4', '8.4.38']], ['debug', ['4.4.1', '4.3.4', '2.6.9']],
    ['ms', ['2.1.3', '2.0.0']], ['semver', ['7.7.2', '6.3.1']], ['lodash', ['4.17.21', '4.17.20']], ['minimatch', ['9.0.5', '3.1.2']],
    ['brace-expansion', ['2.0.2', '1.1.11']], ['esbuild', ['0.25.5', '0.21.5']], ['rollup', ['4.43.0']], ['@types/node', ['22.15.30', '20.14.2']],
  ],
  pypi: [
    ['anyio', ['4.9.0', '3.7.1']], ['idna', ['3.10']], ['certifi', ['2025.4.26', '2023.7.22']], ['sniffio', ['1.3.1']],
    ['typing-extensions', ['4.14.0', '4.9.0']], ['urllib3', ['2.4.0', '1.26.18']], ['starlette', ['0.36.3']], ['h11', ['0.16.0', '0.14.0']],
  ],
  go: [['golang.org/x/sys', ['v0.33.0']], ['golang.org/x/crypto', ['v0.38.0']], ['go.uber.org/multierr', ['v1.11.0']], ['github.com/jackc/pgpassfile', ['v1.0.0']]],
  cargo: [['syn', ['2.0.101']], ['proc-macro2', ['1.0.95']], ['quote', ['1.0.40']], ['libc', ['0.2.172']], ['mio', ['1.0.4']], ['bytes', ['1.10.1']]],
};

/** A lockfile for the repo: each declared dependency at a resolved version, plus what it drags in. */
function lockfile(repo: Row, tidy: number) {
  const declared = dependencies(repo.name);
  const files: Record<string, string> = { npm: 'package-lock.json', pypi: 'poetry.lock', go: 'go.sum', cargo: 'Cargo.lock' };
  // The least tidy repos never committed one.
  if (declared.items.length === 0 || tidy < 0.25) return { lockfiles: [], total: 0, ecosystems: {}, truncated: false, items: [] };
  const rand = random(`${repo.name}:lock`);
  const rows = new Map<string, [string, string, string]>();
  const add = (ecosystem: string, name: string, version: string) => rows.set(`${ecosystem}\n${name}\n${version}`, [ecosystem, name, version]);

  for (const item of declared.items) {
    const base = /\d+(\.\d+){0,2}/.exec(item.version)?.[0] ?? '1.0.0';
    const parts = base.split('.');
    while (parts.length < 3) parts.push(String(Math.floor(rand() * 9)));
    add(item.ecosystem, item.ecosystem === 'pypi' ? item.name.toLowerCase() : item.name, (item.ecosystem === 'go' ? 'v' : '') + parts.join('.'));
  }
  for (const ecosystem of Object.keys(declared.ecosystems)) {
    for (const [name, versions] of TRANSITIVE[ecosystem] ?? []) {
      // Tidy repos are on the latest; the others carry an older copy, sometimes both.
      const old = versions.length > 1 && rand() > tidy;
      add(ecosystem, name, old ? versions[1 + Math.floor(rand() * (versions.length - 1))] : versions[0]);
      if (old && rand() < 0.3) add(ecosystem, name, versions[0]);
    }
  }
  const items = [...rows.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
  const ecosystems: Record<string, number> = {};
  for (const [ecosystem] of items) ecosystems[ecosystem] = (ecosystems[ecosystem] ?? 0) + 1;
  return { lockfiles: Object.keys(ecosystems).map((ecosystem) => files[ecosystem]), total: items.length, ecosystems, truncated: false, items };
}
/** Published advisories for the older versions in TRANSITIVE: [ecosystem, name, version, id, CVE, severity, summary, fixed]. */
const ADVISORIES: [string, string, string, string, string | null, Finding['severity'], string, string][] = [
  ['pypi', 'h11', '0.14.0', 'GHSA-vqfr-h8mv-ghfj', 'CVE-2025-43859', 'critical', 'h11 accepts some malformed Chunked-Encoding bodies', '0.16.0'],
  ['npm', 'lodash', '4.17.20', 'GHSA-35jh-r3h4-6jhm', 'CVE-2021-23337', 'high', 'Command Injection in lodash', '4.17.21'],
  ['pypi', 'starlette', '0.36.3', 'GHSA-f96h-pmfr-66vw', 'CVE-2024-47874', 'high', 'Starlette Denial of service (DoS) via multipart/form-data', '0.40.0'],
  ['npm', 'lodash', '4.17.20', 'GHSA-29mw-wpgm-hmr9', 'CVE-2020-28500', 'moderate', 'Regular Expression Denial of Service (ReDoS) in lodash', '4.17.21'],
  ['npm', 'esbuild', '0.21.5', 'GHSA-67mh-4wv8-2f99', null, 'moderate', 'esbuild enables any website to send any requests to the development server and read the response', '0.25.0'],
  ['npm', 'nanoid', '3.3.7', 'GHSA-mwcw-c2x4-8c55', 'CVE-2024-55565', 'moderate', 'Predictable results in nanoid generation when given non-integer values', '3.3.8'],
  ['pypi', 'starlette', '0.36.3', 'GHSA-2c2j-9gv5-cj73', 'CVE-2025-54121', 'moderate', 'Starlette has possible denial-of-service vector when parsing large files in multipart forms', '0.47.2'],
  ['pypi', 'urllib3', '1.26.18', 'GHSA-34jh-p97f-mpxf', 'CVE-2024-37891', 'moderate', "urllib3's Proxy-Authorization request header isn't stripped during cross-origin redirects", '1.26.19'],
  ['npm', 'brace-expansion', '1.1.11', 'GHSA-v6h2-p8h4-qcjw', 'CVE-2025-5889', 'low', 'brace-expansion Regular Expression Denial of Service vulnerability', '1.1.12'],
  ['pypi', 'certifi', '2023.7.22', 'GHSA-248v-346w-9cwc', 'CVE-2024-39689', 'low', 'Certifi removes GLOBALTRUST root certificate', '2024.7.4'],
];

/** What looking the repo's pinned versions up would find. */
function vulnerabilities(locked: ReturnType<typeof lockfile>) {
  const pinned = new Set(locked.items.map((row) => row.join('\n')));
  const findings: Finding[] = ADVISORIES
    .filter(([ecosystem, name, version]) => pinned.has(`${ecosystem}\n${name}\n${version}`))
    .map(([ecosystem, name, version, id, cve, severity, summary, fixed]) => ({
      id, aliases: cve ? [cve] : [], ecosystem, name, version, severity, summary, fixed, url: `https://osv.dev/vulnerability/${id}`,
    }));
  return { enabled: true, ...summarizeFindings(findings, locked.total) };
}

/** The files a repo this tidy would have. */
function repoPaths(tidy: number): string[] {
  const paths = ['README.md', '.gitignore'];
  if (tidy > 0.3) paths.push('LICENSE');
  if (tidy > 0.55) paths.push('.github/CODEOWNERS');
  if (tidy > 0.65) paths.push('CONTRIBUTING.md');
  if (tidy > 0.75) paths.push('SECURITY.md');
  if (tidy < 0.25) paths.push('config/.env');
  return paths;
}

/** The demo policy's custom checks, as the `policy` collector reports them. */
function policyChecks(repo: Row, tidy: number) {
  const { checks } = POLICY.health;
  const results = runCustomChecks(checks, { paths: repoPaths(tidy), isPrivate: repo.is_private });
  const counted = results.filter((result) => result.passed !== null);
  return {
    checks: results.map((result) => ({ ...result, label: checks.find((check) => check.id === result.id)!.label })),
    passed: counted.filter((result) => result.passed).length,
    total: counted.length,
  };
}

const SCORECARD_CHECKS = [
  'Branch-Protection', 'Code-Review', 'Dangerous-Workflow', 'Dependency-Update-Tool', 'License', 'Maintained',
  'Pinned-Dependencies', 'SAST', 'Security-Policy', 'Token-Permissions', 'Vulnerabilities',
];

/** An OpenSSF Scorecard for the public repos, better the tidier the repo. */
function scorecard(repo: Row, tidy: number, now: number) {
  if (repo.is_private) return { enabled: true, available: false, reason: 'private' };
  if (tidy < 0.3) return { enabled: true, available: false, reason: 'not_scanned' };
  const rand = random(`${repo.name}:scorecard`);
  const checks = SCORECARD_CHECKS.map((name) => {
    const score = Math.max(0, Math.min(10, Math.round(tidy * 10 + (rand() - 0.6) * 6)));
    return { name, score, reason: score >= 8 ? 'no problems found' : score >= 4 ? 'partially in place' : 'not in place' };
  });
  const score = Math.round((checks.reduce((sum, check) => sum + check.score, 0) / checks.length) * 10) / 10;
  return { enabled: true, ...summarizeScorecard({ score, date: new Date(now - 3 * DAY).toISOString(), checks }) };
}

function standards(repo: Row, tidy: number) {
  const paths = repoPaths(tidy).filter((path) => path !== 'config/.env');
  return analyzeStandards({
    description: tidy > 0.15 ? repo.description : null,
    topics: tidy > 0.4 ? (repo.topics?.length ? repo.topics : [String(repo.language).toLowerCase()]) : [],
    license: tidy > 0.3 ? 'MIT' : null,
    isPrivate: repo.is_private,
    paths,
    defaultBranchProtected: tidy > 0.5,
  });
}

function dependencies(name: string) {
  const files = MANIFESTS[name] ?? {};
  const items: Dependency[] = [];
  const runtimes: RuntimeDecl[] = [];
  for (const [path, text] of Object.entries(files)) {
    const parsed = parseManifest(path, text);
    items.push(...parsed.dependencies);
    runtimes.push(...parsed.runtimes);
  }
  const ecosystems: Record<string, number> = {};
  for (const item of items) ecosystems[item.ecosystem] = (ecosystems[item.ecosystem] ?? 0) + 1;
  return { manifests: Object.keys(files), total: items.length, ecosystems, runtimes: dedupeRuntimes(runtimes), items };
}

function security(repo: Row) {
  if (NO_ALERT_ACCESS.has(repo.name)) {
    const off = { available: false, open: 0, truncated: false };
    return summarizeAlerts([], { dependabot: off, codeScanning: off, secretScanning: off });
  }
  const alerts = (ALERTS[repo.name] ?? []).map((alert, index) => ({
    ...alert, url: `https://github.com/${repo.full_name}/security/${alert.source === 'dependabot' ? 'dependabot' : alert.source === 'codeScanning' ? 'code-scanning' : 'secret-scanning'}/${index + 1}`,
  }));
  const source = (name: SecurityAlert['source']) => ({
    available: true, open: alerts.filter((alert) => alert.source === name).length, truncated: false,
  });
  return summarizeAlerts(alerts, {
    dependabot: source('dependabot'), codeScanning: source('codeScanning'), secretScanning: source('secretScanning'),
  });
}

function release(repo: Row, now: number) {
  const entry = RELEASES[repo.name];
  if (!entry) return { hasRelease: false };
  const [tag, daysAgo, unreleasedCommits] = entry;
  return {
    hasRelease: true,
    source: 'release',
    tag,
    name: tag,
    publishedAt: new Date(now - daysAgo * DAY).toISOString(),
    url: `https://github.com/${repo.full_name}/releases/tag/${tag}`,
    unreleasedCommits,
    // Files attached to releases only matter for what people install: the public repos.
    downloads: repo.is_private ? 0 : DOWNLOADS[repo.name] ?? 0,
    latestDownloads: repo.is_private ? 0 : Math.round((DOWNLOADS[repo.name] ?? 0) * 0.08),
  };
}

const BRANCH_NAMES = [
  'feat/checkout-redesign', 'fix/login-timeout', 'chore/upgrade-deps', 'feat/audit-log', 'fix/flaky-tests',
  'spike/new-cache', 'feat/webhooks-v2', 'refactor/config-loader', 'fix/rounding', 'docs/api-examples',
];

function branches(repo: Row, tidy: number, now: number) {
  const rand = random(`${repo.name}:branches`);
  const leftovers = Math.round((1 - tidy) * 9);
  const inputs: BranchInput[] = [
    { name: repo.default_branch, sha: sha(rand), protected: tidy > 0.5, lastCommitAt: repo.last_commit_at, ahead: 0, behind: 0 },
  ];
  const pulls: PullInput[] = [];

  for (let i = 0; i < leftovers + 1; i++) {
    const name = BRANCH_NAMES[(i + repo.name.length) % BRANCH_NAMES.length];
    if (inputs.some((branch) => branch.name === name)) continue;
    const head = sha(rand);
    const kind = i === 0 ? 'active' : rand() < 0.55 ? 'merged' : 'stale';
    const ageDays = kind === 'active' ? 1 + Math.floor(rand() * 5) : kind === 'merged' ? 6 + Math.floor(rand() * 60) : 100 + Math.floor(rand() * 260);
    const lastCommitAt = new Date(now - ageDays * DAY).toISOString();
    inputs.push({
      name, sha: head, protected: false, lastCommitAt,
      ahead: kind === 'merged' ? 0 : 1 + Math.floor(rand() * 9), behind: Math.floor(rand() * 80),
    });
    if (kind === 'stale') continue;
    const number = 100 + Math.floor(rand() * 800);
    pulls.push({
      number, title: name.replace(/^[a-z]+\//, '').replace(/-/g, ' '), url: `https://github.com/${repo.full_name}/pull/${number}`,
      state: kind === 'merged' ? 'closed' : 'open', draft: false, headRef: name, headSha: head, sameRepo: true,
      mergedAt: kind === 'merged' ? lastCommitAt : null,
      // The less tidy repos have a pull request nobody has touched in weeks.
      updatedAt: kind === 'active' && tidy < 0.5 ? new Date(now - 45 * DAY).toISOString() : lastCommitAt,
    });
  }
  return { ...analyzeBranches(repo.default_branch, inputs, pulls, now), truncated: false };
}

function ci(repo: Row, now: number) {
  const profile = CI_PROFILE[repo.name];
  if (!repo.has_ci || !profile) return { available: false };
  const rand = random(`${repo.name}:ci`);
  const workflows = repo.homepage ? ['CI', 'Deploy'] : ['CI'];
  const runs: RunInput[] = [];

  for (let i = 0; i < 60; i++) {
    const startedAt = now - (i * 14 * DAY) / 60 - Math.floor(rand() * 3 * 3_600_000);
    const workflow = workflows[i % workflows.length === 0 ? 0 : Math.floor(rand() * workflows.length)];
    const headSha = sha(rand);
    const duration = profile.duration * (0.75 + rand() * 0.5) * (workflow === 'Deploy' ? 0.4 : 1);
    const run = (attempt: number, conclusion: string): RunInput => ({
      workflowId: workflow, name: workflow, status: 'completed', conclusion,
      startedAt: new Date(startedAt + (attempt - 1) * 20 * MINUTE).toISOString(),
      updatedAt: new Date(startedAt + (attempt - 1) * 20 * MINUTE + duration * 1000).toISOString(),
      headSha, attempt, url: `https://github.com/${repo.full_name}/actions/runs/${9_000_000 + i * 37 + attempt}`,
    });
    if (rand() < profile.flaky) {
      // Flaky: the same commit fails and then passes when run again.
      runs.push(run(1, 'failure'), run(2, 'success'));
    } else {
      runs.push(run(1, rand() < profile.success ? 'success' : 'failure'));
    }
  }
  // The newest run agrees with the status the repo list shows.
  runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  if (repo.ci_status === 'success' || repo.ci_status === 'failure') runs[0].conclusion = repo.ci_status;
  return { available: true, ...analyzeRuns(runs, now), truncated: false };
}

function config(repo: Row, tidy: number) {
  const rand = random(`${repo.name}:config`);
  const baseline = policyBaseline(POLICY);
  const repoData: Record<string, unknown> = { archived: repo.is_archived, permissions: { admin: true } };
  for (const [key, { expected }] of Object.entries(baseline)) {
    repoData[key] = rand() < tidy ? expected : !expected;
  }
  return diffConfig(repoData, baseline);
}

/**
 * Open pull requests and issues per repo: [kind, title, author, days since updated, extras].
 * "alice" is the person looking at the demo (VIEWER_LOGIN in node/demo.ts).
 */
type InboxSeed = [
  kind: 'pr' | 'issue', title: string, author: string, daysAgo: number,
  extra?: { review?: string[]; assignees?: string[]; labels?: string[]; draft?: boolean; comments?: number },
];
const bump = (pkg: string, from: string, to: string): InboxSeed =>
  ['pr', `Bump ${pkg} from ${from} to ${to}`, 'dependabot[bot]', 1, { labels: ['dependencies'] }];

const INBOX: Record<string, InboxSeed[]> = {
  'storefront-web': [
    ['pr', 'New cart flow: quantity stepper and saved items', 'bob', 0, { review: ['alice'], labels: ['feature'], comments: 6 }],
    ['pr', 'Fix hydration mismatch on the product page', 'carol', 2, { review: ['alice', 'bob'], labels: ['bug'], comments: 2 }],
    bump('next', '15.3.0', '15.3.4'), bump('@tanstack/react-query', '5.80.0', '5.84.1'), bump('eslint', '9.28.0', '9.31.0'),
    ['issue', 'Checkout button is hidden behind the cookie banner on mobile', 'dana', 1, { labels: ['bug', 'mobile'], assignees: ['alice'], comments: 4 }],
    ['issue', 'Add structured data for product pages', 'bob', 12, { labels: ['seo'] }],
  ],
  'checkout-api': [
    ['pr', 'Idempotency keys for payment intents', 'alice', 1, { review: ['carol'], labels: ['feature'], comments: 3 }],
    ['pr', 'Retry webhooks with exponential backoff', 'dana', 4, { review: ['alice'], comments: 1 }],
    ['issue', 'Intermittent 502 from the payments provider sandbox', 'carol', 3, { labels: ['bug'], assignees: ['alice', 'dana'], comments: 9 }],
  ],
  'design-system': [
    ['pr', 'Date picker: keyboard navigation', 'erin', 0, { review: ['alice'], labels: ['a11y'], comments: 5 }],
    ['issue', 'Tooltip overflows the viewport near the right edge', 'frank', 6, { labels: ['bug', 'good first issue'], comments: 2 }],
    ['issue', 'Proposal: density tokens', 'erin', 20, { labels: ['discussion'], comments: 14 }],
  ],
  'billing-worker': [
    ['pr', 'Fix flaky invoice rounding test', 'alice', 45, { draft: true, labels: ['tests'] }],
    bump('sqlalchemy', '1.4.52', '2.0.41'), bump('pydantic', '1.10.15', '2.11.5'), bump('fastapi', '0.110.0', '0.115.12'), bump('celery', '5.3.6', '5.5.3'),
    ['issue', 'Nightly reconciliation job times out', 'dana', 2, { labels: ['bug', 'priority'], assignees: ['alice'], comments: 7 }],
  ],
  'mobile-app': [
    ['pr', 'Offline mode for the order history', 'gina', 3, { review: ['bob'], labels: ['feature'], comments: 8 }],
    ['issue', 'Crash on launch on Android 12 with a restored backup', 'support-bot[bot]', 5, { labels: ['bug', 'crash'], comments: 3 }],
  ],
  'data-pipeline': [
    ['pr', 'Partition the events table by day', 'henry', 8, { review: ['alice'], comments: 2 }],
    bump('apache-airflow', '2.10.5', '2.11.0'),
  ],
  'docs-site': [
    ['pr', 'Document the webhooks API', 'alice', 2, { review: ['erin'], labels: ['docs'] }],
    ['issue', 'Search does not find pages added this month', 'frank', 9, { labels: ['bug'], comments: 1 }],
  ],
  'cli-tools': [
    ['issue', 'Shell completions for fish', 'ivan', 15, { labels: ['enhancement', 'good first issue'], comments: 2 }],
  ],
  'analytics-dashboard': [
    ['pr', 'Upgrade to React 19', 'bob', 38, { review: ['alice'], labels: ['dependencies'], comments: 11 }],
    bump('vite', '5.2.0', '5.4.19'), bump('esbuild', '0.21.5', '0.25.5'),
    ['issue', 'Funnel chart double counts returning users', 'carol', 4, { labels: ['bug'], comments: 5 }],
  ],
  'sdk-python': [
    ['pr', 'Async client', 'jules', 1, { review: ['alice'], labels: ['feature'], comments: 4 }],
    ['issue', 'Type hints are missing on paginated responses', 'ivan', 7, { labels: ['typing'], assignees: ['alice'] }],
  ],
  'legacy-monolith': [
    ['pr', 'Remove the unused reporting module', 'alice', 62, { draft: true }],
    ['issue', 'Session cookies are not marked SameSite', 'security-team', 30, { labels: ['security'], comments: 2 }],
  ],
};

const LABEL_COLORS: Record<string, string> = {
  bug: 'd73a4a', feature: 'a2eeef', dependencies: '0366d6', docs: '0075ca', security: 'b60205', 'good first issue': '7057ff',
  enhancement: 'a2eeef', discussion: 'd4c5f9', priority: 'e99695', a11y: '1d76db', tests: 'bfd4f2', mobile: 'c5def5',
  seo: 'fef2c0', crash: 'b60205', typing: 'c2e0c6',
};

function inbox(repo: Row, now: number) {
  const rand = random(`${repo.name}:inbox`);
  const issues: Row[] = [];
  const pulls: Row[] = [];
  const states = new Map<number, PullState>();
  (INBOX[repo.name] ?? []).forEach(([kind, title, author, daysAgo, extra = {}], index) => {
    const number = 200 + index * 7 + Math.floor(rand() * 5);
    const updatedAt = new Date(now - daysAgo * DAY - Math.floor(rand() * 20) * 3_600_000).toISOString();
    issues.push({
      number, title,
      html_url: `https://github.com/${repo.full_name}/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
      user: { login: author, type: author.endsWith('[bot]') ? 'Bot' : 'User' },
      labels: (extra.labels ?? []).map((name) => ({ name, color: LABEL_COLORS[name] ?? 'ededed' })),
      assignees: (extra.assignees ?? []).map((login) => ({ login })),
      comments: extra.comments ?? 0,
      created_at: new Date(new Date(updatedAt).getTime() - (2 + Math.floor(rand() * 10)) * DAY).toISOString(),
      updated_at: updatedAt,
      ...(kind === 'pr' && { pull_request: {} }),
    });
    if (kind === 'pr') {
      const branch = author.endsWith('[bot]')
        ? `dependabot/${title.split(' ')[1]}-${title.split(' ').pop()}`
        : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      pulls.push({
        number, draft: extra.draft ?? false,
        requested_reviewers: (extra.review ?? []).map((login) => ({ login })),
        head: { ref: branch, sha: sha(rand) },
      });
      // Most checks pass; a failing repo's updates fail, and drafts are still running.
      const roll = rand();
      const checks = extra.draft ? 'pending' : repo.ci_status === 'failure' && roll < 0.6 ? 'failure' : roll < 0.12 ? 'failure' : roll < 0.2 ? 'pending' : 'success';
      const bot = author.endsWith('[bot]');
      states.set(number, {
        checks,
        review: bot || extra.draft ? null : (extra.comments ?? 0) > 7 ? 'changes_requested' : (extra.review ?? []).length > 0 ? 'review_required' : 'approved',
      });
    }
  });
  issues.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return { available: true, ...buildInbox(issues, pulls, states), truncated: false };
}

// ── Uptime, saved views ─────────────────────────────

/** Checks every 30 minutes for two weeks, with a few fictional incidents. */
function serviceChecks(services: Row[], now: number): Row[] {
  const INCIDENTS: Record<string, Array<[daysAgo: number, minutes: number]>> = {
    storefront: [[9, 60]],
    'checkout-api': [[3, 30], [11, 120]],
    docs: [],
  };
  const rows: Row[] = [];
  let id = 1;
  const STEP = 30 * MINUTE;
  const slot = Math.floor(now / STEP) * STEP;
  for (const service of services) {
    const rand = random(`${service.slug}:uptime`);
    const base = service.last_check_response_ms ?? 200;
    const incidents = (INCIDENTS[service.slug] ?? []).map(([daysAgo, minutes]) => {
      const start = slot - daysAgo * DAY - 7 * 3_600_000;
      return [start, start + minutes * MINUTE];
    });
    for (let at = slot - 14 * DAY; at <= slot; at += STEP) {
      const down = incidents.some(([start, end]) => at >= start && at < end);
      const slow = !down && rand() < 0.012;
      rows.push({
        id: id++,
        service_slug: service.slug,
        status: down ? 'down' : slow ? 'degraded' : 'healthy',
        response_ms: down ? null : Math.round(base * (slow ? 4 + rand() * 3 : 0.8 + rand() * 0.5)),
        http_code: down ? 503 : 200,
        checked_at: new Date(at).toISOString(),
      });
    }
  }
  return rows;
}

function savedViews(now: number): Row[] {
  const at = new Date(now - 20 * DAY).toISOString();
  return [
    { id: 1, name: 'Security alerts', query: 'health=security-alerts', created_at: at, updated_at: at },
    { id: 2, name: 'High priority, no CI', query: 'health=needs-ci&priority=high', created_at: at, updated_at: at },
    { id: 3, name: 'Branches to clean up', query: 'health=branch-cleanup', created_at: at, updated_at: at },
    { id: 4, name: 'Bugs assigned to me', query: 'inbox=1&section=assigned&label=bug', created_at: at, updated_at: at },
  ];
}

// ── Main ────────────────────────────────────────────

const file = JSON.parse(readFileSync(FILE, 'utf8'));
const now = new Date(file.exported_at).getTime();
const checkedAt = new Date(now - 2 * 3_600_000).toISOString();

const signals: Row[] = [];
for (const repo of file.data.repos as Row[]) {
  const tidy = TIDINESS[repo.name] ?? 0.5;
  const byKind = {
    standards: standards(repo, tidy),
    dependencies: dependencies(repo.name),
    security: security(repo),
    release: release(repo, now),
    branches: branches(repo, tidy, now),
    ci: ci(repo, now),
    config: config(repo, tidy),
    inbox: inbox(repo, now),
    policy: policyChecks(repo, tidy),
    scorecard: scorecard(repo, tidy, now),
    lockfile: lockfile(repo, tidy),
  };
  (byKind as Row).vulnerabilities = vulnerabilities(byKind.lockfile);
  for (const [kind, data] of Object.entries(byKind)) {
    signals.push({ id: signals.length + 1, full_name: repo.full_name, kind, data, checked_at: checkedAt });
  }
}

file.data.repo_signals = signals;
file.data.service_checks = serviceChecks(file.data.services, now);
file.data.saved_views = savedViews(now);

writeFileSync(FILE, `${JSON.stringify(file, null, 1)}\n`);
const counts = Object.entries(file.data).map(([name, rows]) => `${name}: ${(rows as Row[]).length}`).join(', ');
console.log(`Wrote ${FILE}\n  ${counts}`);
