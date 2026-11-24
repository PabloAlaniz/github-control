import type { SignalCollector } from './types';
import { findLockfiles, parseLockfile, type LockedPackage } from './lockfiles';

const API = 'https://api.osv.dev/v1';
const TIMEOUT_MS = 15_000;
/** Packages per batch query: the API's own limit. */
const BATCH = 1000;
/** Packages checked per repo, as many as the lockfile signal keeps. */
const MAX_PACKAGES = 5000;
/** Advisories read in full per repo. Beyond it the findings are counted but not described. */
const MAX_ADVISORIES = 150;
const MAX_ITEMS = 300;
const TOP = 6;
const CONCURRENCY = 8;

/** How the vulnerability database names each ecosystem. */
const ECOSYSTEMS: Record<LockedPackage['ecosystem'], string> = { npm: 'npm', pypi: 'PyPI', go: 'Go', cargo: 'crates.io' };

export const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'unknown'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  id: string;
  /** Other names of the same advisory, CVE first. */
  aliases: string[];
  ecosystem: string;
  name: string;
  version: string;
  severity: Severity;
  summary: string;
  /** The first version, after the pinned one, that fixes it. Null when none is known. */
  fixed: string | null;
  url: string;
}

/** Compares versions number by number ("1.10.0" after "1.9.3"); a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.replace(/^v/, '').split(/[+]/)[0].split('-');
  const [mainA, ...preA] = parts(a);
  const [mainB, ...preB] = parts(b);
  const numsA = mainA.split('.').map((n) => parseInt(n, 10) || 0);
  const numsB = mainB.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(numsA.length, numsB.length); i++) {
    const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (preA.length === 0 || preB.length === 0) return preB.length - preA.length === 0 ? 0 : preA.length === 0 ? 1 : -1;
  return preA.join('-').localeCompare(preB.join('-'));
}

const samePackage = (ecosystem: string, a: string, b: string) =>
  (ecosystem === 'pypi' ? a.toLowerCase().replace(/[-_.]+/g, '-') === b.toLowerCase().replace(/[-_.]+/g, '-') : a === b);

function severityOf(advisory: any): Severity {
  const label = String(advisory?.database_specific?.severity ?? '').toLowerCase();
  if (label === 'medium') return 'moderate';
  return (SEVERITIES as readonly string[]).includes(label) ? (label as Severity) : 'unknown';
}

/** What one advisory means for one pinned package. Pure. */
export function describeFinding(advisory: any, pkg: LockedPackage): Finding {
  const fixes: string[] = [];
  for (const affected of Array.isArray(advisory?.affected) ? advisory.affected : []) {
    if (affected?.package?.ecosystem !== ECOSYSTEMS[pkg.ecosystem] || !samePackage(pkg.ecosystem, String(affected.package.name ?? ''), pkg.name)) continue;
    for (const range of Array.isArray(affected.ranges) ? affected.ranges : []) {
      if (range?.type === 'GIT') continue;
      for (const event of Array.isArray(range.events) ? range.events : []) {
        if (typeof event?.fixed === 'string') fixes.push(event.fixed);
      }
    }
  }
  const later = fixes.filter((fix) => compareVersions(fix, pkg.version) > 0).sort(compareVersions);
  const aliases: string[] = (Array.isArray(advisory?.aliases) ? advisory.aliases : []).filter((alias: unknown) => typeof alias === 'string');
  const id = String(advisory?.id ?? '');
  return {
    id,
    aliases: [...aliases].sort((a, b) => Number(b.startsWith('CVE-')) - Number(a.startsWith('CVE-'))),
    ecosystem: pkg.ecosystem,
    name: pkg.name,
    version: pkg.version,
    severity: severityOf(advisory),
    summary: String(advisory?.summary || advisory?.details || '').split('\n')[0].slice(0, 200),
    fixed: later[0] ?? null,
    url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
  };
}

/** Counts and the list, worst first. The same advisory under two names (GHSA and PYSEC, say) counts once per package. Pure. */
export function summarizeFindings(findings: Finding[], checked: number, undescribed = 0) {
  const preferred = [...findings].sort((a, b) => Number(b.id.startsWith('GHSA-')) - Number(a.id.startsWith('GHSA-')));
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const finding of preferred) {
    const names = [finding.id, ...finding.aliases].map((name) => `${finding.ecosystem}\n${finding.name}\n${finding.version}\n${name}`);
    if (names.some((name) => seen.has(name))) continue;
    names.forEach((name) => seen.add(name));
    unique.push(finding);
  }
  unique.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  for (const finding of unique) bySeverity[finding.severity]++;
  return {
    /** Pinned packages that were looked up. */
    checked,
    total: unique.length + undescribed,
    packages: new Set(unique.map((finding) => `${finding.ecosystem}\n${finding.name}\n${finding.version}`)).size,
    bySeverity,
    truncated: undescribed > 0 || unique.length > MAX_ITEMS,
    /** The worst few, for the summary that travels with the repo list. */
    worst: unique.slice(0, TOP),
    items: unique.slice(0, MAX_ITEMS),
  };
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}${path}`, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`The vulnerability database answered HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Advisories already read in this process: the same ones come up in repo after repo. */
const advisoryCache = new Map<string, any>();
const CACHE_LIMIT = 2000;

async function readAdvisory(id: string): Promise<any> {
  if (advisoryCache.has(id)) return advisoryCache.get(id);
  const advisory = await request(`/vulns/${encodeURIComponent(id)}`);
  if (advisoryCache.size >= CACHE_LIMIT) advisoryCache.clear();
  advisoryCache.set(id, advisory);
  return advisory;
}

/** For tests. */
export function clearAdvisoryCache() { advisoryCache.clear(); }

/** The advisory ids that apply to each package, in the order given. */
async function lookUp(packages: LockedPackage[]): Promise<string[][]> {
  const ids: string[][] = [];
  for (let start = 0; start < packages.length; start += BATCH) {
    const queries = packages.slice(start, start + BATCH).map((pkg) => ({
      package: { name: pkg.name, ecosystem: ECOSYSTEMS[pkg.ecosystem] },
      version: pkg.ecosystem === 'go' ? pkg.version.replace(/^v/, '') : pkg.version,
    }));
    const body = await request('/querybatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries }) });
    const results: any[] = Array.isArray(body?.results) ? body.results : [];
    queries.forEach((_, index) => ids.push((results[index]?.vulns ?? []).map((vuln: any) => String(vuln?.id ?? '')).filter(Boolean)));
  }
  return ids;
}

/**
 * Known vulnerabilities of the versions the repo's lockfiles pin, from the
 * OSV database. Only asked when the policy turns it on: package names and
 * versions are sent to api.osv.dev (never the repo's name).
 */
export const collectVulnerabilities: SignalCollector = async (ctx) => {
  if (!ctx.policy.vulnerabilities) return { enabled: false };

  const packages = new Map<string, LockedPackage>();
  for (const path of findLockfiles(await ctx.tree())) {
    const text = await ctx.readFile(path);
    if (text === null) continue;
    for (const pkg of parseLockfile(path, text)) packages.set(`${pkg.ecosystem}\n${pkg.name}\n${pkg.version}`, pkg);
  }
  const checked = [...packages.values()].slice(0, MAX_PACKAGES);
  if (checked.length === 0) return { enabled: true, ...summarizeFindings([], 0) };

  const ids = await lookUp(checked);
  const pairs = checked.flatMap((pkg, index) => ids[index].map((id) => ({ pkg, id })));
  const wanted = [...new Set(pairs.map((pair) => pair.id))].slice(0, MAX_ADVISORIES);

  const advisories = new Map<string, any>();
  for (let start = 0; start < wanted.length; start += CONCURRENCY) {
    const batch = wanted.slice(start, start + CONCURRENCY);
    (await Promise.all(batch.map(readAdvisory))).forEach((advisory, index) => advisories.set(batch[index], advisory));
  }

  const described = pairs.filter((pair) => advisories.has(pair.id));
  const findings = described.map((pair) => describeFinding(advisories.get(pair.id), pair.pkg));
  return { enabled: true, ...summarizeFindings(findings, checked.length, pairs.length - described.length) };
};
