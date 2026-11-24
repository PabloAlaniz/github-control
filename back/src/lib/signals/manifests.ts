/**
 * Dependency manifest parsers. Pure functions: text → declared direct
 * dependencies. They do not resolve lockfiles or transitive dependencies.
 */

export interface Dependency {
  ecosystem: 'npm' | 'pypi' | 'go' | 'cargo' | 'rubygems' | 'maven' | 'nuget';
  name: string;
  /** Version or range exactly as declared ('*' if there is none). */
  version: string;
  /** Major version for comparing across repos ('0.x' keeps the minor). null if it cannot be read. */
  major: string | null;
  scope: 'prod' | 'dev';
  manifest: string;
}

export interface RuntimeDecl {
  name: 'node' | 'python' | 'go';
  version: string;
  source: string;
}

export interface ManifestResult {
  dependencies: Dependency[];
  runtimes: RuntimeDecl[];
}

/** "^18.2.0" → "18", "~0.4.1" → "0.4", ">=3.9,<4" → "3", "latest" → null. */
export function majorOf(version: string): string | null {
  const m = /(\d+)(?:\.(\d+))?/.exec(version || '');
  if (!m) return null;
  return m[1] === '0' && m[2] !== undefined ? `0.${m[2]}` : m[1];
}

const dep = (
  ecosystem: Dependency['ecosystem'], name: string, version: string, scope: Dependency['scope'], manifest: string,
): Dependency => ({ ecosystem, name, version: version || '*', major: majorOf(version), scope, manifest });

function parsePackageJson(text: string, manifest: string): ManifestResult {
  let pkg: any;
  try { pkg = JSON.parse(text); } catch { return { dependencies: [], runtimes: [] }; }
  const dependencies: Dependency[] = [];
  for (const [field, scope] of [['dependencies', 'prod'], ['devDependencies', 'dev']] as const) {
    for (const [name, version] of Object.entries(pkg?.[field] ?? {})) {
      if (typeof version === 'string') dependencies.push(dep('npm', name, version, scope, manifest));
    }
  }
  const node = pkg?.engines?.node;
  return {
    dependencies,
    runtimes: typeof node === 'string' ? [{ name: 'node', version: node, source: manifest }] : [],
  };
}

function parseRequirements(text: string, manifest: string): ManifestResult {
  const scope = /dev|test|lint|docs/i.test(manifest.split('/').pop() || '') ? 'dev' : 'prod';
  const dependencies: Dependency[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.split(/\s+#/)[0].trim();
    if (!line || line.startsWith('#') || line.startsWith('-') || line.includes('://')) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*([^;]*)/.exec(line);
    if (m) dependencies.push(dep('pypi', m[1].toLowerCase(), m[2].trim(), scope, manifest));
  }
  return { dependencies, runtimes: [] };
}

/** Splits a TOML into sections { '[name]': lines }. Enough to read dependency tables. */
function tomlSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = '';
  sections.set(current, []);
  for (const raw of text.split('\n')) {
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(raw);
    if (header) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, []);
    } else {
      sections.get(current)!.push(raw);
    }
  }
  return sections;
}

/** Reads `key = "value"` or `key = { version = "value", ... }` from the lines of a TOML table. */
function tomlTableEntries(lines: string[]): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const raw of lines) {
    const m = /^\s*["']?([A-Za-z0-9._-]+)["']?\s*=\s*(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const value = m[2];
    const plain = /^["']([^"']*)["']/.exec(value);
    const inline = /version\s*=\s*["']([^"']*)["']/.exec(value);
    entries.push([m[1], plain ? plain[1] : inline ? inline[1] : '']);
  }
  return entries;
}

/** TOML strings ("..." or '...') in a text, honouring the quote type that opens each one. */
function tomlStrings(text: string): string[] {
  return [...text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map(m => m[1] ?? m[2]);
}

/** Extracts the strings from `key = [ "a", "b" ]` (one or more lines). */
function tomlStringArray(lines: string[], key: string): string[] {
  const joined = lines.join('\n');
  const start = new RegExp(`^\\s*${key}\\s*=\\s*\\[`, 'm').exec(joined);
  if (!start) return [];
  // Advances to the "]" that closes the array, ignoring any inside strings.
  let quote = '';
  let end = joined.length;
  for (let i = start.index + start[0].length; i < joined.length; i++) {
    const ch = joined[i];
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ']') { end = i; break; }
  }
  return tomlStrings(joined.slice(start.index + start[0].length, end));
}

function parsePyproject(text: string, manifest: string): ManifestResult {
  const sections = tomlSections(text);
  const dependencies: Dependency[] = [];
  const runtimes: RuntimeDecl[] = [];
  const pep508 = (spec: string, scope: Dependency['scope']) => {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*([^;]*)/.exec(spec.trim());
    if (m) dependencies.push(dep('pypi', m[1].toLowerCase(), m[2].trim(), scope, manifest));
  };

  const project = sections.get('project') ?? [];
  tomlStringArray(project, 'dependencies').forEach(spec => pep508(spec, 'prod'));
  const requiresPython = tomlTableEntries(project).find(([k]) => k === 'requires-python');
  if (requiresPython?.[1]) runtimes.push({ name: 'python', version: requiresPython[1], source: manifest });

  for (const [name, lines] of sections) {
    if (name === 'project.optional-dependencies' || name === 'dependency-groups') {
      tomlStrings(lines.join('\n')).forEach(spec => pep508(spec, 'dev'));
    }
    const poetry = /^tool\.poetry\.(?:group\.[^.]+\.)?(dev-)?dependencies$/.exec(name);
    if (poetry) {
      const scope = poetry[1] || name.includes('.group.') ? 'dev' : 'prod';
      for (const [pkg, version] of tomlTableEntries(lines)) {
        if (pkg.toLowerCase() === 'python') runtimes.push({ name: 'python', version, source: manifest });
        else dependencies.push(dep('pypi', pkg.toLowerCase(), version, scope, manifest));
      }
    }
  }
  return { dependencies, runtimes };
}

function parseGoMod(text: string, manifest: string): ManifestResult {
  const dependencies: Dependency[] = [];
  const runtimes: RuntimeDecl[] = [];
  let inRequire = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const goVersion = /^go\s+(\d+\.\d+(?:\.\d+)?)/.exec(line);
    if (goVersion) { runtimes.push({ name: 'go', version: goVersion[1], source: manifest }); continue; }
    if (/^require\s*\($/.test(line)) { inRequire = true; continue; }
    if (inRequire && line === ')') { inRequire = false; continue; }
    const single = /^require\s+(\S+)\s+(\S+)/.exec(line);
    const inBlock = inRequire ? /^(\S+)\s+(\S+)/.exec(line) : null;
    const m = single ?? inBlock;
    if (!m || line.includes('// indirect')) continue;
    dependencies.push(dep('go', m[1], m[2], 'prod', manifest));
  }
  return { dependencies, runtimes };
}

function parseCargoToml(text: string, manifest: string): ManifestResult {
  const dependencies: Dependency[] = [];
  for (const [name, lines] of tomlSections(text)) {
    const m = /^(?:workspace\.)?(dev-|build-)?dependencies$/.exec(name);
    if (!m) continue;
    for (const [crate, version] of tomlTableEntries(lines)) {
      dependencies.push(dep('cargo', crate, version, m[1] ? 'dev' : 'prod', manifest));
    }
  }
  return { dependencies, runtimes: [] };
}

/** Gemfile: `gem 'name', '~> 1.2'`, with `group :development do … end` blocks and `group:` options as dev. */
function parseGemfile(text: string, manifest: string): ManifestResult {
  const dependencies: Dependency[] = [];
  const isDev = (groups: string) => /:(development|test)\b/.test(groups);
  let devDepth = 0;
  let depth = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const group = /^group\s+(.+?)\s+do\b/.exec(line);
    if (group) { depth++; if (devDepth === 0 && isDev(group[1])) devDepth = depth; continue; }
    if (/\bdo(\s*\|[^|]*\|)?$/.test(line)) { depth++; continue; }
    if (line === 'end') { if (devDepth === depth) devDepth = 0; depth = Math.max(0, depth - 1); continue; }
    const gem = /^gem\s+['"]([^'"]+)['"](.*)$/.exec(line);
    if (!gem) continue;
    const version = /^\s*,\s*['"]([^'"]+)['"]/.exec(gem[2])?.[1] ?? '';
    const dev = devDepth > 0 || isDev(/groups?:\s*(\[[^\]]*\]|:\w+)/.exec(gem[2])?.[1] ?? '');
    dependencies.push(dep('rubygems', gem[1], version, dev ? 'dev' : 'prod', manifest));
  }
  return { dependencies, runtimes: [] };
}

/** XML without its comments. Repeats until none is left, so removing one cannot leave another behind. */
function stripXmlComments(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(/<!--[\s\S]*?-->/g, '');
    if (next === current) return next;
    current = next;
  }
}

const xmlTag = (block: string, tag: string) => new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(block)?.[1] ?? '';

/** pom.xml: the project's own `<dependency>` entries, with `${property}` versions resolved from `<properties>`. */
function parsePom(text: string, manifest: string): ManifestResult {
  const xml = stripXmlComments(text);
  const properties = new Map<string, string>();
  for (const [, name, value] of (/<properties>([\s\S]*?)<\/properties>/.exec(xml)?.[1] ?? '').matchAll(/<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g)) properties.set(name, value);
  // Managed versions and plugin dependencies are not what the project itself depends on.
  const own = xml.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '').replace(/<build>[\s\S]*?<\/build>/g, '');
  const dependencies: Dependency[] = [];
  for (const [, block] of own.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const group = xmlTag(block, 'groupId');
    const artifact = xmlTag(block, 'artifactId');
    if (!group || !artifact) continue;
    const version = xmlTag(block, 'version').replace(/^\$\{([^}]+)\}$/, (whole, name) => properties.get(name) ?? whole);
    dependencies.push(dep('maven', `${group}:${artifact}`, version, xmlTag(block, 'scope') === 'test' ? 'dev' : 'prod', manifest));
  }
  return { dependencies, runtimes: [] };
}

/** build.gradle and build.gradle.kts: `implementation 'group:artifact:version'` and its variants. */
function parseGradle(text: string, manifest: string): ManifestResult {
  const dependencies: Dependency[] = [];
  const pattern = /^\s*(\w+)\s*\(?\s*(?:platform\()?['"]([\w.-]+):([\w.-]+)(?::([^'":@]+))?[^'"]*['"]/gm;
  for (const [, configuration, group, artifact, version] of text.matchAll(pattern)) {
    if (!/^(api|implementation|compile|compileOnly|runtimeOnly|runtime|annotationProcessor|kapt|ksp|\w*[tT]est\w*)$/.test(configuration)) continue;
    dependencies.push(dep('maven', `${group}:${artifact}`, version ?? '', /test/i.test(configuration) ? 'dev' : 'prod', manifest));
  }
  return { dependencies, runtimes: [] };
}

/** .csproj and friends, and Directory.Packages.props: `<PackageReference Include="X" Version="1.2.3" />`. */
function parseMsbuild(text: string, manifest: string): ManifestResult {
  const xml = stripXmlComments(text);
  const found = new Map<string, string>();
  for (const [, attributes, body] of xml.matchAll(/<Package(?:Reference|Version)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Package(?:Reference|Version)>)/g)) {
    const name = /\b(?:Include|Update)\s*=\s*"([^"]+)"/.exec(attributes)?.[1];
    if (!name) continue;
    const version = /\bVersion\s*=\s*"([^"]*)"/.exec(attributes)?.[1] ?? xmlTag(body ?? '', 'Version');
    if (!found.get(name)) found.set(name, version);
  }
  return { dependencies: [...found].map(([name, version]) => dep('nuget', name, version, 'prod', manifest)), runtimes: [] };
}

function parseVersionFile(name: RuntimeDecl['name']) {
  return (text: string, manifest: string): ManifestResult => {
    const version = text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? '';
    return { dependencies: [], runtimes: version ? [{ name, version, source: manifest }] : [] };
  };
}

type Parser = (text: string, manifest: string) => ManifestResult;

const PARSERS: Array<[RegExp, Parser]> = [
  [/^package\.json$/, parsePackageJson],
  [/^requirements[\w.-]*\.txt$/i, parseRequirements],
  [/^pyproject\.toml$/, parsePyproject],
  [/^go\.mod$/, parseGoMod],
  [/^Cargo\.toml$/, parseCargoToml],
  [/^Gemfile$/, parseGemfile],
  [/^pom\.xml$/, parsePom],
  [/^build\.gradle(\.kts)?$/, parseGradle],
  [/^([\w.-]+\.(cs|fs|vb)proj|Directory\.Packages\.props)$/, parseMsbuild],
  [/^\.(nvmrc|node-version)$/, parseVersionFile('node')],
  [/^\.python-version$/, parseVersionFile('python')],
];

const EXCLUDED_DIR = /(^|\/)(node_modules|vendor|dist|build|target|\.venv|venv|__pycache__|\.git|fixtures|testdata|examples?)(\/|$)/i;

function parserFor(path: string): Parser | null {
  const base = path.split('/').pop() || '';
  return PARSERS.find(([pattern]) => pattern.test(base))?.[1] ?? null;
}

/** Supported manifests within a tree, shallowest first, up to `limit`. */
export function findManifests(paths: string[], limit = 12, maxDepth = 4): string[] {
  return paths
    .filter(p => parserFor(p) && !EXCLUDED_DIR.test(p) && p.split('/').length <= maxDepth)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, limit);
}

export function parseManifest(path: string, text: string): ManifestResult {
  const parser = parserFor(path);
  return parser ? parser(text, path) : { dependencies: [], runtimes: [] };
}
