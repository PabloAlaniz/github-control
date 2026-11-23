import type { SignalCollector } from './types';
import { findManifests, parseManifest, type Dependency, type RuntimeDecl } from './manifests';
import { dedupeRuntimes } from './runtimes';

/**
 * Direct dependencies declared in the repo's manifests (npm, PyPI, Go, Cargo)
 * and runtime versions. `items` holds the full list; the rest is the summary
 * that travels in `/api/repos`.
 */
export const collectDependencies: SignalCollector = async (ctx) => {
  const manifests = findManifests(await ctx.tree());
  const items: Dependency[] = [];
  const runtimeDecls: RuntimeDecl[] = [];

  for (const path of manifests) {
    const text = await ctx.readFile(path);
    if (text === null) continue;
    const parsed = parseManifest(path, text);
    items.push(...parsed.dependencies);
    runtimeDecls.push(...parsed.runtimes);
  }

  const ecosystems: Record<string, number> = {};
  for (const item of items) ecosystems[item.ecosystem] = (ecosystems[item.ecosystem] ?? 0) + 1;

  return {
    manifests,
    total: items.length,
    ecosystems,
    runtimes: dedupeRuntimes(runtimeDecls),
    items,
  };
};
