import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAdvisoryCache, collectVulnerabilities, compareVersions, describeFinding, summarizeFindings, type Finding,
} from '@back/lib/signals/vulnerabilities';

const lodash = { ecosystem: 'npm' as const, name: 'lodash', version: '4.17.15' };
const advisory = (extra: Record<string, unknown> = {}) => ({
  id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', aliases: ['SNYK-1', 'CVE-2021-23337'],
  database_specific: { severity: 'HIGH' },
  affected: [
    { package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] },
    { package: { name: 'lodash-rails', ecosystem: 'RubyGems' }, ranges: [{ type: 'ECOSYSTEM', events: [{ fixed: '9.9.9' }] }] },
  ],
  ...extra,
});
const finding = (extra: Partial<Finding> = {}): Finding => ({
  id: 'GHSA-aaaa', aliases: [], ecosystem: 'npm', name: 'lodash', version: '4.17.15', severity: 'high', summary: '', fixed: null, url: '', ...extra,
});

describe('compareVersions', () => {
  it.each([
    ['1.10.0', '1.9.3', 1], ['1.2', '1.2.0', 0], ['v0.1.0', '0.1.0', 0], ['2.0.0', '10.0.0', -1],
    ['1.0.0-rc.1', '1.0.0', -1], ['1.0.0', '1.0.0-beta', 1], ['1.0.0-alpha', '1.0.0-beta', -1], ['1.0.0+build', '1.0.0', 0],
  ])('%s against %s', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });
});

describe('describeFinding', () => {
  it('keeps what matters, with the fix of this package and the CVE first', () => {
    expect(describeFinding(advisory(), lodash)).toEqual({
      id: 'GHSA-35jh-r3h4-6jhm', aliases: ['CVE-2021-23337', 'SNYK-1'], ecosystem: 'npm', name: 'lodash', version: '4.17.15',
      severity: 'high', summary: 'Command Injection in lodash', fixed: '4.17.21', url: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm',
    });
  });

  it('picks the nearest fix after the pinned version, or none', () => {
    const ranges = [
      { type: 'GIT', events: [{ fixed: 'abc123' }] },
      { type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '3.4.1' }] },
      { type: 'SEMVER', events: [{ introduced: '4.0.0' }, { fixed: '4.17.21' }, { fixed: '4.17.19' }] },
    ];
    const several = advisory({ affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges }] });
    expect(describeFinding(several, lodash).fixed).toBe('4.17.19');
    expect(describeFinding(several, { ...lodash, version: '5.0.0' }).fixed).toBeNull();
    expect(describeFinding({ id: 'X-1' }, lodash)).toMatchObject({ severity: 'unknown', summary: '', fixed: null, aliases: [] });
  });

  it('reads severities and Python names loosely', () => {
    expect(describeFinding(advisory({ database_specific: { severity: 'MEDIUM' } }), lodash).severity).toBe('moderate');
    expect(describeFinding(advisory({ database_specific: { severity: 'weird' } }), lodash).severity).toBe('unknown');
    const yaml = advisory({ summary: '', details: 'First line\nmore', affected: [{ package: { name: 'pyyaml', ecosystem: 'PyPI' }, ranges: [{ type: 'ECOSYSTEM', events: [{ fixed: '5.4' }] }] }] });
    expect(describeFinding(yaml, { ecosystem: 'pypi', name: 'PyYAML', version: '5.1' })).toMatchObject({ fixed: '5.4', summary: 'First line' });
    const json = advisory({ affected: [{ package: { name: 'Newtonsoft.Json', ecosystem: 'NuGet' }, ranges: [{ type: 'ECOSYSTEM', events: [{ fixed: '13.0.1' }] }] }] });
    expect(describeFinding(json, { ecosystem: 'nuget', name: 'newtonsoft.json', version: '12.0.3' }).fixed).toBe('13.0.1');
    expect(describeFinding(json, { ecosystem: 'maven', name: 'Newtonsoft.Json', version: '12.0.3' }).fixed).toBeNull();
  });
});

describe('summarizeFindings', () => {
  it('counts by severity, worst first, and one advisory under two names once', () => {
    const summary = summarizeFindings([
      finding({ id: 'PYSEC-1', aliases: ['GHSA-bbbb', 'CVE-1'], severity: 'unknown' }),
      finding({ id: 'GHSA-bbbb', aliases: ['CVE-1'], severity: 'low' }),
      finding({ id: 'GHSA-cccc', severity: 'critical', name: 'zlib' }),
      finding({ id: 'GHSA-aaaa', severity: 'high' }),
    ], 40);
    expect(summary.items.map((item) => item.id)).toEqual(['GHSA-cccc', 'GHSA-aaaa', 'GHSA-bbbb']);
    expect(summary.worst).toEqual(summary.items);
    expect(summary).toMatchObject({ checked: 40, total: 3, packages: 2, truncated: false, bySeverity: { critical: 1, high: 1, moderate: 0, low: 1, unknown: 0 } });
  });

  it('says so when findings were left out', () => {
    expect(summarizeFindings([finding()], 10, 4)).toMatchObject({ total: 5, truncated: true });
    const many = Array.from({ length: 320 }, (_, i) => finding({ id: `GHSA-${i}` }));
    expect(summarizeFindings(many, 10)).toMatchObject({ total: 320, truncated: true });
    expect(summarizeFindings(many, 10).items).toHaveLength(300);
  });
});

describe('collectVulnerabilities', () => {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: {
    '': { name: 'app' }, 'node_modules/lodash': { version: '4.17.15' }, 'node_modules/react': { version: '19.1.0' },
  } });
  const ctx = (extra: Record<string, unknown> = {}): any => ({
    owner: 'acme', repo: 'api', policy: { checks: [], scorecard: false, vulnerabilities: true },
    tree: async () => ['package-lock.json', 'go.sum', 'src/index.ts'],
    readFile: async (path: string) => (path === 'package-lock.json' ? lock : path === 'go.sum' ? 'golang.org/x/net v0.1.0 h1:abc=\n' : null),
    ...extra,
  });
  const json = (body: unknown) => new Response(JSON.stringify(body));
  let fetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearAdvisoryCache();
    fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks nothing unless the policy turns it on, or when nothing is pinned', async () => {
    expect(await collectVulnerabilities(ctx({ policy: { checks: [], scorecard: false, vulnerabilities: false } }))).toEqual({ enabled: false });
    expect(await collectVulnerabilities(ctx({ tree: async () => ['README.md'] }))).toMatchObject({ enabled: true, checked: 0, total: 0, items: [] });
    expect(await collectVulnerabilities(ctx({ readFile: async () => null }))).toMatchObject({ enabled: true, checked: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends packages and versions, never the repo, and describes what comes back', async () => {
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/querybatch')) {
        const { queries } = JSON.parse(String(init!.body));
        return json({ results: queries.map((q: any) => (q.package.name === 'lodash' ? { vulns: [{ id: 'GHSA-35jh-r3h4-6jhm' }] } : {})) });
      }
      return json(advisory());
    });

    const first = await collectVulnerabilities(ctx());
    expect(first).toMatchObject({ enabled: true, checked: 3, total: 1, packages: 1, bySeverity: { high: 1 } });
    expect((first.items as Finding[])[0]).toMatchObject({ name: 'lodash', fixed: '4.17.21' });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.osv.dev/v1/querybatch');
    const sent = JSON.parse(String(init.body)).queries;
    expect(sent).toContainEqual({ package: { name: 'golang.org/x/net', ecosystem: 'Go' }, version: '0.1.0' });
    expect(sent).toContainEqual({ package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.15' });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('acme');

    // The advisory is remembered: a second repo costs only the lookup.
    await collectVulnerabilities(ctx());
    expect(fetcher.mock.calls.filter(([u]) => String(u).includes('/vulns/'))).toHaveLength(1);
  });

  it('fails when the database does', async () => {
    fetcher.mockResolvedValue(new Response('', { status: 503 }));
    await expect(collectVulnerabilities(ctx())).rejects.toThrow(/HTTP 503/);
  });
});
