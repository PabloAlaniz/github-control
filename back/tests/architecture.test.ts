import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from\s+'([^']+)'|import\('([^']+)'\)/g)].map((m) => m[1] ?? m[2]);
}

/** Files under `layer` must not import anything matching `forbidden`. */
function violations(layer: string, forbidden: RegExp): string[] {
  return sourceFiles(join(SRC, layer)).flatMap((file) =>
    importsOf(file)
      .filter((spec) => forbidden.test(spec))
      .map((spec) => `${relative(SRC, file)} -> ${spec}`),
  );
}

describe('dependency rule', () => {
  it('routes and services reach storage only through the ports', () => {
    const forbidden = /infrastructure\/|@neondatabase|\/repositories\/|db\/client/;
    expect(violations('routes', forbidden)).toEqual([]);
    expect(violations('services', forbidden)).toEqual([]);
    expect(violations('middleware', forbidden)).toEqual([]);
  });

  it('domain and application do not depend on infrastructure or HTTP', () => {
    const forbidden = /infrastructure\/|\/http\/|\/routes\/|^hono|@neondatabase/;
    expect(violations('domain', forbidden)).toEqual([]);
    expect(violations('application', forbidden)).toEqual([]);
  });
});
