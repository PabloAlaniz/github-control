import { describe, it, expect } from 'vitest';
import { majorOf, findManifests, parseManifest } from '@back/lib/signals/manifests';
import { runtimeRelease, runtimeStatus, dedupeRuntimes } from '@back/lib/signals/runtimes';

const names = (r: ReturnType<typeof parseManifest>) => r.dependencies.map(d => `${d.name}@${d.version}:${d.scope}`);

describe('majorOf', () => {
  it('extracts a comparable major', () => {
    expect(majorOf('^18.2.0')).toBe('18');
    expect(majorOf('~0.4.1')).toBe('0.4');
    expect(majorOf('>=3.9,<4')).toBe('3');
    expect(majorOf('v1.9.1')).toBe('1');
    expect(majorOf('0')).toBe('0');
    expect(majorOf('latest')).toBeNull();
    expect(majorOf('')).toBeNull();
  });
});

describe('findManifests', () => {
  it('finds supported manifests, shallowest first, skipping vendored dirs', () => {
    const found = findManifests([
      'packages/api/package.json', 'package.json', 'node_modules/x/package.json', 'README.md',
      'requirements-dev.txt', 'go.mod', 'vendor/y/go.mod', 'a/b/c/d/package.json', '.nvmrc',
      'examples/demo/Cargo.toml', 'crates/core/Cargo.toml', 'pyproject.toml', '.python-version',
    ]);
    expect(found).toEqual([
      '.nvmrc', '.python-version', 'go.mod', 'package.json', 'pyproject.toml', 'requirements-dev.txt',
      'crates/core/Cargo.toml', 'packages/api/package.json',
    ]);
  });

  it('caps the number of manifests', () => {
    const paths = Array.from({ length: 30 }, (_, i) => `pkg${i}/package.json`);
    expect(findManifests(paths)).toHaveLength(12);
    expect(findManifests(paths, 3)).toHaveLength(3);
  });
});

describe('parseManifest', () => {
  it('ignores unsupported files', () => {
    expect(parseManifest('README.md', '# hi')).toEqual({ dependencies: [], runtimes: [] });
  });

  it('parses package.json dependencies and node engine', () => {
    const result = parseManifest('web/package.json', JSON.stringify({
      dependencies: { react: '^18.2.0', local: { path: '../x' } },
      devDependencies: { vitest: '~1.6.0' },
      peerDependencies: { ignored: '1' },
      engines: { node: '>=20' },
    }));
    expect(names(result)).toEqual(['react@^18.2.0:prod', 'vitest@~1.6.0:dev']);
    expect(result.dependencies[0]).toMatchObject({ ecosystem: 'npm', major: '18', manifest: 'web/package.json' });
    expect(result.runtimes).toEqual([{ name: 'node', version: '>=20', source: 'web/package.json' }]);
  });

  it('tolerates invalid or minimal package.json', () => {
    expect(parseManifest('package.json', '{nope')).toEqual({ dependencies: [], runtimes: [] });
    expect(parseManifest('package.json', '{}')).toEqual({ dependencies: [], runtimes: [] });
    expect(parseManifest('package.json', 'null')).toEqual({ dependencies: [], runtimes: [] });
  });

  it('parses requirements files', () => {
    const result = parseManifest('requirements.txt', [
      '# comment', '', 'Django==4.2.1', 'requests[socks]>=2.31  # inline', 'uvicorn',
      '-r base.txt', '-e .', 'git+https://example.com/x.git', 'pytest ; python_version > "3.8"',
    ].join('\n'));
    expect(names(result)).toEqual(['django@==4.2.1:prod', 'requests@>=2.31:prod', 'uvicorn@*:prod', 'pytest@*:prod']);
    expect(parseManifest('requirements-dev.txt', 'ruff==0.4').dependencies[0].scope).toBe('dev');
  });

  it('parses pyproject.toml (PEP 621)', () => {
    const result = parseManifest('pyproject.toml', `
[project]
name = "app"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "pydantic[email]~=2.6; python_version > '3.8'",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]

[tool.ruff]
line-length = 100
`);
    expect(names(result)).toEqual(['fastapi@>=0.110:prod', 'pydantic@~=2.6:prod', 'pytest@>=8:dev', 'ruff@*:dev']);
    expect(result.runtimes).toEqual([{ name: 'python', version: '>=3.11', source: 'pyproject.toml' }]);
  });

  it('parses pyproject.toml (Poetry)', () => {
    const result = parseManifest('pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.10"
httpx = "^0.27"
sqlalchemy = { version = "^2.0", extras = ["asyncio"] }
local = { path = "../local" }

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"

[tool.poetry.dev-dependencies]
black = "*"
`);
    expect(names(result)).toEqual([
      'httpx@^0.27:prod', 'sqlalchemy@^2.0:prod', 'local@*:prod', 'pytest@^8.0:dev', 'black@*:dev',
    ]);
    expect(result.runtimes[0]).toMatchObject({ name: 'python', version: '^3.10' });
  });

  it('parses go.mod, skipping indirect requirements', () => {
    const result = parseManifest('go.mod', `
module example.com/app

go 1.22.3

require github.com/single/dep v1.0.0

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/text v0.14.0 // indirect
)

replace example.com/x => ../x
`);
    expect(names(result)).toEqual(['github.com/single/dep@v1.0.0:prod', 'github.com/gin-gonic/gin@v1.9.1:prod']);
    expect(result.runtimes).toEqual([{ name: 'go', version: '1.22.3', source: 'go.mod' }]);
  });

  it('parses Cargo.toml', () => {
    const result = parseManifest('Cargo.toml', `
[package]
name = "tool"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1"
local = { path = "../local" }

[dev-dependencies]
insta = "1.38"

[build-dependencies]
cc = "1"
`);
    expect(names(result)).toEqual(['serde@1.0:prod', 'tokio@1:prod', 'local@*:prod', 'insta@1.38:dev', 'cc@1:dev']);
    expect(result.dependencies.every(d => d.ecosystem === 'cargo')).toBe(true);
  });

  it('parses runtime version files', () => {
    expect(parseManifest('.nvmrc', 'v20.11.0\n').runtimes).toEqual([{ name: 'node', version: 'v20.11.0', source: '.nvmrc' }]);
    expect(parseManifest('.node-version', '# pin\n22\n').runtimes[0].version).toBe('22');
    expect(parseManifest('.python-version', '3.12.2').runtimes[0]).toMatchObject({ name: 'python', version: '3.12.2' });
    expect(parseManifest('.nvmrc', '\n').runtimes).toEqual([]);
  });
});

describe('runtimes', () => {
  it('normalizes the release per runtime', () => {
    expect(runtimeRelease('node', 'v20.11.0')).toBe('20');
    expect(runtimeRelease('node', '>=18')).toBe('18');
    expect(runtimeRelease('node', 'lts/iron')).toBeNull();
    expect(runtimeRelease('python', '^3.10')).toBe('3.10');
    expect(runtimeRelease('python', '3')).toBeNull();
    expect(runtimeRelease('go', '1.22.3')).toBe('1');
  });

  it('attaches the end-of-life date when known', () => {
    expect(runtimeStatus({ name: 'node', version: '18', source: '.nvmrc' })).toMatchObject({ release: '18', eolDate: '2025-04-30' });
    expect(runtimeStatus({ name: 'python', version: '3.9.1', source: 'x' }).eolDate).toBe('2025-10-31');
    expect(runtimeStatus({ name: 'node', version: '99', source: 'x' }).eolDate).toBeNull();
    expect(runtimeStatus({ name: 'node', version: 'lts/*', source: 'x' })).toMatchObject({ release: null, eolDate: null });
    expect(runtimeStatus({ name: 'go', version: '1.22', source: 'go.mod' }).eolDate).toBeNull();
  });

  it('keeps one declaration per runtime, preferring the shallowest file', () => {
    const result = dedupeRuntimes([
      { name: 'node', version: '18', source: 'packages/api/package.json' },
      { name: 'node', version: '22', source: '.nvmrc' },
      { name: 'node', version: '20', source: 'package.json' },
      { name: 'python', version: '3.12', source: '.python-version' },
    ]);
    expect(result.map(r => `${r.name}:${r.version}`)).toEqual(['node:22', 'python:3.12']);
  });
});
