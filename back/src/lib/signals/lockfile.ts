import type { SignalCollector } from './types';
import { findLockfiles, parseLockfile, type LockedPackage } from './lockfiles';

/** Packages kept per repo. Beyond it the list is cut and marked as truncated. */
const MAX_PACKAGES = 5000;

/**
 * Every package the repo's lockfiles pin, direct and transitive, at its
 * resolved version. `items` holds the list as compact `[ecosystem, name,
 * version]` rows: there can be thousands per repo.
 */
export const collectLockfile: SignalCollector = async (ctx) => {
  const lockfiles = findLockfiles(await ctx.tree());
  const packages = new Map<string, LockedPackage>();
  const read: string[] = [];

  for (const path of lockfiles) {
    const text = await ctx.readFile(path);
    if (text === null) continue;
    read.push(path);
    for (const pkg of parseLockfile(path, text)) packages.set(`${pkg.ecosystem}\n${pkg.name}\n${pkg.version}`, pkg);
  }

  const all = [...packages.values()];
  const ecosystems: Record<string, number> = {};
  for (const pkg of all) ecosystems[pkg.ecosystem] = (ecosystems[pkg.ecosystem] ?? 0) + 1;

  return {
    lockfiles: read,
    total: all.length,
    ecosystems,
    truncated: all.length > MAX_PACKAGES,
    items: all.slice(0, MAX_PACKAGES).map((pkg) => [pkg.ecosystem, pkg.name, pkg.version]),
  };
};
