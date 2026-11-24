import { describe, expect, it, vi } from 'vitest';
import { findLockfiles, parseLockfile } from '@back/lib/signals/lockfiles';
import { collectLockfile } from '@back/lib/signals/lockfile';
import { createSignalContext } from '@back/lib/signals';

const rows = (path: string, text: string) => parseLockfile(path, text).map((pkg) => `${pkg.ecosystem}:${pkg.name}@${pkg.version}`);

describe('lockfile parsers', () => {
  it('reads package-lock.json v3, nested installs and scoped names included', () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: {
      '': { name: 'app', version: '1.0.0' },
      'node_modules/react': { version: '19.1.0' },
      'node_modules/@scope/pkg': { version: '2.0.0' },
      'node_modules/a/node_modules/react': { version: '18.3.1' },
      'node_modules/local': { link: true, resolved: 'packages/local' },
      'packages/local': { name: 'local', version: '0.0.1' },
      'node_modules/aliased': { name: 'real-name', version: '4.0.0' },
    } });
    expect(rows('package-lock.json', lock)).toEqual([
      'npm:@scope/pkg@2.0.0', 'npm:react@18.3.1', 'npm:react@19.1.0', 'npm:real-name@4.0.0',
    ]);
  });

  it('reads package-lock.json v1 trees', () => {
    const lock = JSON.stringify({ lockfileVersion: 1, dependencies: {
      express: { version: '4.18.2', dependencies: { debug: { version: '2.6.9' } } },
      debug: { version: '4.3.4' },
      'from-git': { version: 'git+https://github.com/x/y.git#abc' },
    } });
    expect(rows('npm-shrinkwrap.json', lock)).toEqual(['npm:debug@2.6.9', 'npm:debug@4.3.4', 'npm:express@4.18.2']);
  });

  it('reads pnpm-lock.yaml in its three key styles', () => {
    const lock = `lockfileVersion: '9.0'
packages:
  react@19.1.0:
    resolution: {integrity: sha512-x}
  '@scope/pkg@2.0.0(react@19.1.0)':
    resolution: {integrity: sha512-y}
  /lodash@4.17.21:
    resolution: {integrity: sha512-z}
  /old-style/1.2.3:
    resolution: {integrity: sha512-w}
  /@types/node/20.1.0_peer@1.0.0:
    resolution: {integrity: sha512-v}
`;
    expect(rows('pnpm-lock.yaml', lock)).toEqual([
      'npm:@scope/pkg@2.0.0', 'npm:@types/node@20.1.0', 'npm:lodash@4.17.21', 'npm:old-style@1.2.3', 'npm:react@19.1.0',
    ]);
  });

  it('reads yarn.lock, classic and berry', () => {
    const classic = `# yarn lockfile v1

"@babel/core@^7.0.0", "@babel/core@^7.1.0":
  version "7.24.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.24.0.tgz"
  dependencies:
    debug "^4.1.0"

debug@^4.1.0:
  version "4.3.4"
`;
    expect(rows('yarn.lock', classic)).toEqual(['npm:@babel/core@7.24.0', 'npm:debug@4.3.4']);

    const berry = `__metadata:
  version: 8

"left-pad@npm:^1.3.0":
  version: 1.3.0
  resolution: "left-pad@npm:1.3.0"

"@scope/pkg@npm:^2.0.0, @scope/pkg@npm:^2.1.0":
  version: 2.1.0
`;
    expect(rows('yarn.lock', berry)).toEqual(['npm:@scope/pkg@2.1.0', 'npm:left-pad@1.3.0']);
  });

  it('reads Cargo.lock, poetry.lock and uv.lock', () => {
    const toml = `version = 3

[[package]]
name = "serde"
version = "1.0.200"
source = "registry+https://github.com/rust-lang/crates.io-index"
dependencies = [
 "serde_derive",
]

[[package]]
name = "tokio"
version = "1.45.0"

[package.dependencies]
name = "not-a-package"
version = "9.9.9"
`;
    expect(rows('Cargo.lock', toml)).toEqual(['cargo:serde@1.0.200', 'cargo:tokio@1.45.0']);
    expect(rows('poetry.lock', toml)).toEqual(['pypi:serde@1.0.200', 'pypi:tokio@1.45.0']);
    expect(rows('uv.lock', toml)).toEqual(['pypi:serde@1.0.200', 'pypi:tokio@1.45.0']);
  });

  it('reads go.sum once per module version', () => {
    const sum = `github.com/go-chi/chi/v5 v5.2.1 h1:abc=
github.com/go-chi/chi/v5 v5.2.1/go.mod h1:def=
go.uber.org/zap v1.27.0/go.mod h1:ghi=
`;
    expect(rows('go.sum', sum)).toEqual(['go:github.com/go-chi/chi/v5@v5.2.1', 'go:go.uber.org/zap@v1.27.0']);
  });

  it('yields nothing for a broken lockfile or a file it does not know', () => {
    expect(rows('package-lock.json', '{ not json')).toEqual([]);
    expect(rows('pnpm-lock.yaml', 'packages: [1')).toEqual([]);
    expect(rows('Gemfile.lock', 'GEM\n  specs:\n')).toEqual([]);
    expect(rows('package-lock.json', '{}')).toEqual([]);
  });

  it('finds lockfiles near the root, outside vendored and example folders', () => {
    expect(findLockfiles([
      'apps/web/package-lock.json', 'package-lock.json', 'node_modules/x/package-lock.json', 'examples/demo/yarn.lock',
      'a/b/c/d/Cargo.lock', 'services/api/go.sum', 'README.md', 'package.json',
    ])).toEqual(['package-lock.json', 'apps/web/package-lock.json', 'services/api/go.sum']);
    expect(findLockfiles(Array.from({ length: 9 }, (_, i) => `p${i}/yarn.lock`))).toHaveLength(6);
  });
});

describe('lockfile signal', () => {
  const b64 = (text: string) => Buffer.from(text).toString('base64');
  const lock = JSON.stringify({ packages: { 'node_modules/react': { version: '19.1.0' }, 'node_modules/scheduler': { version: '0.26.0' } } });

  function octokit(files: Record<string, any>, blobs: Record<string, string> = {}) {
    return {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
        getContent: vi.fn(async ({ path }: any) => {
          if (!(path in files)) throw { status: 404 };
          return { data: files[path] };
        }),
      },
      git: {
        getTree: vi.fn().mockResolvedValue({ data: { tree: Object.keys(files).map((path) => ({ path })) } }),
        getBlob: vi.fn(async ({ file_sha }: any) => ({ data: { encoding: 'base64', content: b64(blobs[file_sha]) } })),
      },
    } as any;
  }
  const collect = (client: any) => collectLockfile(createSignalContext(client, 'acme', 'api'));

  it('lists every pinned package of the repo as compact rows', async () => {
    const data = await collect(octokit({
      'package-lock.json': { content: b64(lock), size: lock.length },
      'services/api/go.sum': { content: b64('go.uber.org/zap v1.27.0 h1:x=\n'), size: 30 },
      'README.md': { content: b64('hi'), size: 2 },
    }));
    expect(data).toEqual({
      lockfiles: ['package-lock.json', 'services/api/go.sum'], total: 3, ecosystems: { npm: 2, go: 1 }, truncated: false,
      items: [['npm', 'react', '19.1.0'], ['npm', 'scheduler', '0.26.0'], ['go', 'go.uber.org/zap', 'v1.27.0']],
    });
  });

  it('reads a lockfile over 1 MB as a blob, and skips one too large to be worth it', async () => {
    const client = octokit({
      'package-lock.json': { content: '', encoding: 'none', sha: 'big', size: 3_000_000 },
      'apps/web/yarn.lock': { content: '', encoding: 'none', sha: 'huge', size: 50_000_000 },
    }, { big: lock });
    const data = await collect(client);
    expect(data).toMatchObject({ lockfiles: ['package-lock.json'], total: 2 });
    expect(client.git.getBlob).toHaveBeenCalledTimes(1);
  });

  it('reports a repo without lockfiles as having none', async () => {
    expect(await collect(octokit({ 'README.md': { content: b64('hi'), size: 2 } }))).toEqual({
      lockfiles: [], total: 0, ecosystems: {}, truncated: false, items: [],
    });
  });

  it('keeps at most 5000 packages and says the list was cut', async () => {
    const many = JSON.stringify({ packages: Object.fromEntries(Array.from({ length: 5200 }, (_, i) => [`node_modules/p${i}`, { version: '1.0.0' }])) });
    const data = await collect(octokit({ 'package-lock.json': { content: b64(many), size: many.length } })) as any;
    expect(data.total).toBe(5200);
    expect(data.truncated).toBe(true);
    expect(data.items).toHaveLength(5000);
  });
});
