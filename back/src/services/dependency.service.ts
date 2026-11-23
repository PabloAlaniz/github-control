import type { AppContext } from '../application/context';

interface Usage { repo: string; version: string; major: string | null; scope: string; manifest: string }

/**
 * Cross-repo inventory built from the `dependencies` signal of active repos:
 * which packages are used, by which repo and at what version, plus the
 * runtimes each repo declares.
 */
export async function buildDependencyInventory(ctx: AppContext, now: Date = new Date()) {
  const [records, repos] = await Promise.all([
    ctx.storage.signals.listSignals('dependencies'),
    ctx.storage.repos.listRepos(),
  ]);
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
      });
      packages.set(key, entry);
    }
  }

  return {
    repos_synced: synced.length,
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
