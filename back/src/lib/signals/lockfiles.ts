/**
 * Lockfile parsers. Pure functions: text → every package the lockfile pins,
 * direct and transitive, at its resolved version.
 */
import { parse as parseYaml } from 'yaml';
import type { Dependency } from './manifests';

export interface LockedPackage {
  ecosystem: Dependency['ecosystem'];
  name: string;
  version: string;
}

type Parser = (text: string) => LockedPackage[];

/** One entry per (name, version), sorted, so a lockfile always yields the same list. */
function unique(ecosystem: LockedPackage['ecosystem'], pairs: [string, string][]): LockedPackage[] {
  const seen = new Map<string, LockedPackage>();
  for (const [name, version] of pairs) {
    if (!name || !version) continue;
    seen.set(`${name}\n${version}`, { ecosystem, name, version });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** package-lock.json and npm-shrinkwrap.json, lockfile versions 1 to 3. */
function parsePackageLock(text: string): LockedPackage[] {
  const lock = JSON.parse(text);
  const pairs: [string, string][] = [];

  // v2 and v3: a flat map of install paths.
  for (const [path, entry] of Object.entries<any>(lock.packages ?? {})) {
    const at = path.lastIndexOf('node_modules/');
    if (at === -1 || entry?.link) continue;   // the root project and workspace links are not packages
    pairs.push([entry.name ?? path.slice(at + 'node_modules/'.length), String(entry.version ?? '')]);
  }
  // v1: a tree.
  const walk = (dependencies: Record<string, any> | undefined) => {
    for (const [name, entry] of Object.entries(dependencies ?? {})) {
      pairs.push([name, String(entry?.version ?? '')]);
      walk(entry?.dependencies);
    }
  };
  if (pairs.length === 0) walk(lock.dependencies);
  return unique('npm', pairs.filter(([, version]) => /^\d/.test(version)));
}

/** pnpm-lock.yaml: package keys are `/name/1.2.3` (v5), `/name@1.2.3` (v6) or `name@1.2.3` (v9), with an optional `(peer)` suffix. */
function parsePnpmLock(text: string): LockedPackage[] {
  const lock = parseYaml(text);
  const pairs: [string, string][] = [];
  for (const raw of Object.keys(lock?.packages ?? {})) {
    const key = raw.replace(/^\//, '').replace(/\(.*$/, '');
    // `name@version` (v6+), where the name may be scoped; otherwise `name/version` (v5), with an optional `_peer` suffix.
    const match = /^((?:@[^/]+\/)?[^/@]+)@(.+)$/.exec(key) ?? /^((?:@[^/]+\/)?[^/]+)\/([^_]+)/.exec(key);
    if (match) pairs.push([match[1], match[2]]);
  }
  return unique('npm', pairs.filter(([, version]) => /^\d/.test(version)));
}

/** yarn.lock, classic (v1) and berry: a block per package, headed by its specifiers. */
function parseYarnLock(text: string): LockedPackage[] {
  const pairs: [string, string][] = [];
  let name: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line && !/^\s/.test(line) && !line.startsWith('#')) {
      // `"@scope/pkg@^1.0.0", "@scope/pkg@^1.1.0":` or `pkg@npm:^1.0.0:`
      const first = line.replace(/:$/, '').split(',')[0].trim().replace(/^"|"$/g, '');
      const at = first.lastIndexOf('@');
      name = at > 0 ? first.slice(0, at) : null;
      continue;
    }
    const version = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line);
    if (version && name && name !== '__metadata') {
      pairs.push([name, version[1]]);
      name = null;
    }
  }
  return unique('npm', pairs.filter(([, version]) => /^\d/.test(version)));
}

/** Cargo.lock, poetry.lock and uv.lock: `[[package]]` tables with a name and a version. */
function parseTomlPackages(ecosystem: LockedPackage['ecosystem']): Parser {
  return (text) => {
    const pairs: [string, string][] = [];
    for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
      // Only the table's own keys: stop at the next table of any kind.
      const own = block.split(/^\[/m)[0];
      const name = /^name\s*=\s*"([^"]+)"/m.exec(own)?.[1];
      const version = /^version\s*=\s*"([^"]+)"/m.exec(own)?.[1];
      if (name && version) pairs.push([name, version]);
    }
    return unique(ecosystem, pairs);
  };
}

/** go.sum: `module version hash` and `module version/go.mod hash` lines. */
function parseGoSum(text: string): LockedPackage[] {
  const pairs: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const [module, version] = line.trim().split(/\s+/);
    if (module && version) pairs.push([module, version.replace(/\/go\.mod$/, '')]);
  }
  return unique('go', pairs);
}

/** Gemfile.lock: the `specs:` of its GEM, GIT and PATH sections, at four spaces (deeper lines are their requirements). */
function parseGemfileLock(text: string): LockedPackage[] {
  const pairs: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const spec = /^ {4}(\S+) \(([^)]+)\)$/.exec(line);
    // "1.15.5-x86_64-linux": the platform is not part of the version.
    if (spec) pairs.push([spec[1], spec[2].replace(/-(x86|x64|arm|aarch|universal|java|mingw|mswin|musl).*$/, '')]);
  }
  return unique('rubygems', pairs);
}

/** gradle.lockfile: `group:artifact:version=configurations`. */
function parseGradleLock(text: string): LockedPackage[] {
  const pairs: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const entry = /^([\w.-]+:[\w.-]+):([^=\s]+)=/.exec(line.trim());
    if (entry) pairs.push([entry[1], entry[2]]);
  }
  return unique('maven', pairs);
}

/** packages.lock.json (.NET): per target framework, each package with its resolved version. Project references have none. */
function parseNugetLock(text: string): LockedPackage[] {
  const lock = JSON.parse(text);
  const pairs: [string, string][] = [];
  for (const framework of Object.values<any>(lock.dependencies ?? {})) {
    for (const [name, entry] of Object.entries<any>(framework ?? {})) {
      if (entry?.type !== 'Project' && typeof entry?.resolved === 'string') pairs.push([name, entry.resolved]);
    }
  }
  return unique('nuget', pairs);
}

const PARSERS: [RegExp, Parser][] = [
  [/^(package-lock|npm-shrinkwrap)\.json$/, parsePackageLock],
  [/^pnpm-lock\.yaml$/, parsePnpmLock],
  [/^yarn\.lock$/, parseYarnLock],
  [/^Cargo\.lock$/, parseTomlPackages('cargo')],
  [/^(poetry|uv)\.lock$/, parseTomlPackages('pypi')],
  [/^go\.sum$/, parseGoSum],
  [/^Gemfile\.lock$/, parseGemfileLock],
  [/^gradle\.lockfile$/, parseGradleLock],
  [/^packages\.lock\.json$/, parseNugetLock],
];

const EXCLUDED_DIR = /(^|\/)(node_modules|vendor|dist|build|target|\.venv|venv|__pycache__|\.git|fixtures|testdata|examples?)(\/|$)/i;
const parserFor = (path: string) => PARSERS.find(([pattern]) => pattern.test(path.split('/').pop() ?? ''))?.[1] ?? null;

/** Supported lockfiles within a tree, shallowest first, up to `limit`. */
export function findLockfiles(paths: string[], limit = 6, maxDepth = 4): string[] {
  return paths
    .filter((path) => parserFor(path) && !EXCLUDED_DIR.test(path) && path.split('/').length <= maxDepth)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, limit);
}

/** The packages a lockfile pins. A file that does not parse yields none: a broken lockfile is not the sync's problem. */
export function parseLockfile(path: string, text: string): LockedPackage[] {
  const parser = parserFor(path);
  if (!parser) return [];
  try {
    return parser(text);
  } catch {
    return [];
  }
}
