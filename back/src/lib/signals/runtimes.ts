import { majorOf, type RuntimeDecl } from './manifests';

/**
 * End of life per runtime version. Static table: a row has to be added when a
 * new version comes out. Dates as published by each project. Go is not here:
 * its policy is "the two latest versions", with no fixed date.
 */
const EOL_DATES: Record<string, Record<string, string>> = {
  node: {
    '12': '2022-04-30', '14': '2023-04-30', '16': '2023-09-11', '18': '2025-04-30',
    '20': '2026-04-30', '22': '2027-04-30', '24': '2028-04-30',
  },
  python: {
    '3.7': '2023-06-27', '3.8': '2024-10-07', '3.9': '2025-10-31', '3.10': '2026-10-31',
    '3.11': '2027-10-31', '3.12': '2028-10-31', '3.13': '2029-10-31', '3.14': '2030-10-31',
  },
};

export interface RuntimeStatus extends RuntimeDecl {
  /** Normalized version used to look up the EOL ("18", "3.11"). null if it could not be read. */
  release: string | null;
  /** End-of-life date (YYYY-MM-DD), or null if unknown. */
  eolDate: string | null;
}

/** Release version derived from what is declared: node → major, python → major.minor. */
export function runtimeRelease(name: RuntimeDecl['name'], version: string): string | null {
  if (name === 'python') {
    const m = /(\d+)\.(\d+)/.exec(version);
    return m ? `${m[1]}.${m[2]}` : null;
  }
  if (name === 'node') {
    const m = /(\d+)/.exec(version);
    return m ? m[1] : null;
  }
  return majorOf(version);
}

export function runtimeStatus(decl: RuntimeDecl): RuntimeStatus {
  const release = runtimeRelease(decl.name, decl.version);
  return {
    ...decl,
    release,
    eolDate: (release && EOL_DATES[decl.name]?.[release]) || null,
  };
}

/** One entry per runtime: the shallowest declaration (the root one) wins. */
export function dedupeRuntimes(decls: RuntimeDecl[]): RuntimeStatus[] {
  const byName = new Map<string, RuntimeDecl>();
  const depth = (d: RuntimeDecl) => d.source.split('/').length;
  for (const decl of decls) {
    const current = byName.get(decl.name);
    if (!current || depth(decl) < depth(current)) byName.set(decl.name, decl);
  }
  return [...byName.values()].map(runtimeStatus);
}
