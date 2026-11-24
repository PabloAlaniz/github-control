import type { AppContext } from '../application/context';
import type { SignalRecord } from '../application/ports/storage';

interface Usage { repo: string; version: string; major: string | null; scope: string; manifest: string; resolved: string[] }

type LockRow = [ecosystem: string, name: string, version: string];

/** Python package names are compared ignoring case and `-`/`_`/`.` (PEP 503), NuGet ones ignoring case; the rest are exact. */
const normalize = (ecosystem: string, name: string) =>
  (ecosystem === 'pypi' ? name.toLowerCase().replace(/[-_.]+/g, '-') : ecosystem === 'nuget' ? name.toLowerCase() : name);

/** `repo \n ecosystem \n name` → the versions that repo's lockfiles pin for it. */
function resolvedVersions(locks: SignalRecord[]): Map<string, string[]> {
  const byPackage = new Map<string, string[]>();
  for (const record of locks) {
    for (const [ecosystem, name, version] of (record.data.items ?? []) as LockRow[]) {
      const key = `${record.full_name}\n${ecosystem}\n${normalize(ecosystem, name)}`;
      byPackage.set(key, [...(byPackage.get(key) ?? []), version]);
    }
  }
  return byPackage;
}

/**
 * Cross-repo inventory built from the `dependencies` signal of active repos:
 * which packages are used, by which repo and at what version, plus the
 * runtimes each repo declares.
 */
export async function buildDependencyInventory(ctx: AppContext, now: Date = new Date()) {
  const [records, repos, locks] = await Promise.all([
    ctx.storage.signals.listSignals('dependencies'),
    ctx.storage.repos.listRepos(),
    ctx.storage.signals.listSignals('lockfile'),
  ]);
  const resolved = resolvedVersions(locks);
  const active = new Set(repos.map((repo) => repo.full_name as string));
  const synced = records.filter((record) => active.has(record.full_name));
  const today = now.toISOString().slice(0, 10);

  const packages = new Map<string, { ecosystem: string; name: string; usages: Usage[] }>();
  for (const record of synced) {
    for (const item of (record.data.items ?? []) as Record<string, any>[]) {
      const key = `${item.ecosystem}\n${item.name}`;
      const entry = packages.get(key) ?? { ecosystem: item.ecosystem, name: item.name, usages: [] as Usage[] };
      entry.usages.push({
        repo: record.full_name, version: item.version, major: item.major ?? null,
        scope: item.scope, manifest: item.manifest,
        resolved: resolved.get(`${record.full_name}\n${item.ecosystem}\n${normalize(item.ecosystem, item.name)}`) ?? [],
      });
      packages.set(key, entry);
    }
  }

  const lockedRepos = locks.filter((record) => active.has(record.full_name) && record.data.total > 0);
  return {
    repos_synced: synced.length,
    /** Repos with a lockfile, and how many pinned packages they add up to. */
    locked: { repos: lockedRepos.length, packages: lockedRepos.reduce((sum, record) => sum + (Number(record.data.total) || 0), 0) },
    packages: [...packages.values()]
      .map((pkg) => {
        const majors = [...new Set(pkg.usages.map((u) => u.major).filter((m): m is string => !!m))].sort();
        return {
          ecosystem: pkg.ecosystem,
          name: pkg.name,
          repo_count: new Set(pkg.usages.map((u) => u.repo)).size,
          majors,
          divergent: majors.length > 1,
          usages: pkg.usages,
        };
      })
      // Most shared first.
      .sort((a, b) => b.repo_count - a.repo_count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    runtimes: synced.flatMap((record) =>
      ((record.data.runtimes ?? []) as Record<string, any>[]).map((runtime) => ({
        repo: record.full_name,
        ...runtime,
        eol: runtime.eolDate ? runtime.eolDate <= today : null,
      }))),
  };
}

export interface PackageLocation {
  repo: string;
  ecosystem: string;
  name: string;
  /** Every version of it the repo's lockfiles pin. */
  versions: string[];
  /** Whether the repo declares it itself, or only gets it through another package. */
  direct: boolean;
}

/**
 * Where a package is, anywhere in the dependency trees of the active repos:
 * the question to ask when a package turns out to be vulnerable. `query`
 * matches the name exactly, or as a substring when no exact match exists.
 */
export async function locatePackage(ctx: AppContext, query: string): Promise<{ query: string; exact: boolean; repos: number; locations: PackageLocation[] }> {
  const [locks, declared, repos] = await Promise.all([
    ctx.storage.signals.listSignals('lockfile'),
    ctx.storage.signals.listSignals('dependencies'),
    ctx.storage.repos.listRepos(),
  ]);
  const active = new Set(repos.map((repo) => repo.full_name as string));
  const wanted = query.trim().toLowerCase();

  const direct = new Set<string>();
  for (const record of declared) {
    for (const item of (record.data.items ?? []) as Record<string, any>[]) {
      direct.add(`${record.full_name}\n${item.ecosystem}\n${normalize(item.ecosystem, item.name)}`);
    }
  }

  const collect = (matches: (name: string) => boolean) => {
    const found = new Map<string, PackageLocation>();
    for (const record of locks) {
      if (!active.has(record.full_name)) continue;
      for (const [ecosystem, name, version] of (record.data.items ?? []) as LockRow[]) {
        if (!matches(name.toLowerCase())) continue;
        const key = `${record.full_name}\n${ecosystem}\n${name}`;
        const location = found.get(key) ?? {
          repo: record.full_name, ecosystem, name, versions: [],
          direct: direct.has(`${record.full_name}\n${ecosystem}\n${normalize(ecosystem, name)}`),
        };
        location.versions.push(version);
        found.set(key, location);
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.repo.localeCompare(b.repo));
  };

  let locations = collect((name) => name === wanted);
  const exact = locations.length > 0;
  if (!exact) locations = collect((name) => name.includes(wanted)).slice(0, 200);
  return { query: query.trim(), exact, repos: new Set(locations.map((location) => location.repo)).size, locations };
}

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'unknown'];

export interface VulnerablePackage {
  id: string;
  aliases: string[];
  ecosystem: string;
  name: string;
  version: string;
  severity: string;
  summary: string;
  fixed: string | null;
  url: string;
  /** The repos whose lockfiles pin this version. */
  repos: string[];
}

/**
 * Known vulnerabilities across the active repos, one row per advisory and
 * pinned version with the repos it is in, worst and most widespread first.
 * Built from the `vulnerabilities` signal: no lookups at request time.
 */
export async function listVulnerabilities(ctx: AppContext) {
  const [records, repos] = await Promise.all([
    ctx.storage.signals.listSignals('vulnerabilities'),
    ctx.storage.repos.listRepos(),
  ]);
  const active = new Set(repos.map((repo) => repo.full_name as string));
  const checked = records.filter((record) => active.has(record.full_name) && record.data.enabled === true);

  const rows = new Map<string, VulnerablePackage>();
  const bySeverity: Record<string, number> = Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, 0]));
  const affected = new Set<string>();
  for (const record of checked) {
    for (const item of (record.data.items ?? []) as Record<string, any>[]) {
      const key = `${item.ecosystem}\n${item.name}\n${item.version}\n${item.id}`;
      const row = rows.get(key) ?? { ...(item as Omit<VulnerablePackage, 'repos'>), repos: [] };
      row.repos.push(record.full_name);
      rows.set(key, row);
      affected.add(record.full_name);
    }
  }
  const items = [...rows.values()].sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.repos.length - a.repos.length || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const row of items) bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;

  return {
    /** Repos whose pinned versions were looked up, and how many of them have a finding. */
    repos_checked: checked.length,
    repos_affected: affected.size,
    packages_checked: checked.reduce((sum, record) => sum + (Number(record.data.checked) || 0), 0),
    total: items.length,
    bySeverity,
    truncated: checked.filter((record) => record.data.truncated === true).map((record) => record.full_name),
    items,
  };
}
