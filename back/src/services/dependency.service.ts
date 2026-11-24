import type { AppContext } from '../application/context';
import type { SignalRecord } from '../application/ports/storage';

interface Usage { repo: string; version: string; major: string | null; scope: string; manifest: string; resolved: string[] }

type LockRow = [ecosystem: string, name: string, version: string];

/** Python package names are compared ignoring case and `-`/`_`/`.` (PEP 503); the rest are exact. */
const normalize = (ecosystem: string, name: string) => (ecosystem === 'pypi' ? name.toLowerCase().replace(/[-_.]+/g, '-') : name);

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
