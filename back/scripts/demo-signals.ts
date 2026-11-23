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
import { resolveBaseline } from '../src/domain/repo-baseline';
import { analyzeBranches, type BranchInput, type PullInput } from '../src/lib/signals/branches';
import { analyzeRuns, type RunInput } from '../src/lib/signals/ci';
import { diffConfig } from '../src/lib/signals/config';
import { parseManifest, type Dependency, type RuntimeDecl } from '../src/lib/signals/manifests';
import { dedupeRuntimes } from '../src/lib/signals/runtimes';
import { summarizeAlerts, type SecurityAlert } from '../src/lib/signals/security';
import { analyzeStandards } from '../src/lib/signals/standards';

const FILE = fileURLToPath(new URL('../../docs/demo/demo-data.json', import.meta.url).href);
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

function standards(repo: Row, tidy: number) {
  const paths = ['README.md', '.gitignore'];
  if (tidy > 0.3) paths.push('LICENSE');
  if (tidy > 0.55) paths.push('.github/CODEOWNERS');
  if (tidy > 0.65) paths.push('CONTRIBUTING.md');
  if (tidy > 0.75) paths.push('SECURITY.md');
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
  const baseline = resolveBaseline(undefined);
  const repoData: Record<string, unknown> = { archived: repo.is_archived, permissions: { admin: true } };
  for (const [key, { expected }] of Object.entries(baseline)) {
    repoData[key] = rand() < tidy ? expected : !expected;
  }
  return diffConfig(repoData, baseline);
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
  };
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
