import { describe, it, expect, vi } from 'vitest';
import { collectSecurity, summarizeAlerts } from '@back/lib/signals/security';
import { createSignalContext } from '@back/lib/signals';

const ctxWith = (request: any) => createSignalContext({ request } as any, 'me', 'api');
const byRoute = (responses: Record<string, any>) => vi.fn(async (route: string) => {
  const key = Object.keys(responses).find(k => route.includes(k))!;
  const value = responses[key];
  if (value instanceof Error || value?.status) throw value;
  return { data: value };
});

describe('collectSecurity', () => {
  it('normalizes alerts from the three sources and sorts by severity', async () => {
    const request = byRoute({
      dependabot: [
        { security_advisory: { severity: 'medium', summary: 'ReDoS' }, dependency: { package: { name: 'semver' } }, html_url: 'u1' },
        { security_vulnerability: { severity: 'high' }, html_url: 'u2' },
      ],
      'code-scanning': [
        { rule: { security_severity_level: 'critical', description: 'SQL injection' }, html_url: 'u3' },
        { rule: { severity: 'warning', id: 'js/unused' } },
        { rule: { severity: 'note' } },
        { rule: { severity: 'error' } },
      ],
      'secret-scanning': [{ secret_type_display_name: 'API Key', html_url: 'u4' }, { secret_type: 'token' }, {}],
    });

    const result: any = await collectSecurity(ctxWith(request));

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/dependabot/alerts', {
      owner: 'me', repo: 'api', state: 'open', per_page: 100,
    });
    expect(result.available).toBe(true);
    expect(result.total).toBe(9);
    expect(result.bySeverity).toEqual({ critical: 4, high: 2, medium: 2, low: 1 });
    expect(result.worst).toBe('critical');
    expect(result.sources.dependabot).toEqual({ available: true, open: 2, truncated: false });
    expect(result.items[0].severity).toBe('critical');
    expect(result.items.at(-1).severity).toBe('low');
    expect(result.items.map((i: any) => i.title)).toEqual(expect.arrayContaining([
      'semver: ReDoS', 'dependency: vulnerability', 'SQL injection', 'js/unused', 'code scanning alert',
      'API Key', 'token', 'exposed secret',
    ]));
    expect(result.items.find((i: any) => i.title === 'js/unused').url).toBeNull();
  });

  it('marks sources as unavailable on 403/404/400 without failing', async () => {
    const request = byRoute({
      dependabot: { status: 403 },
      'code-scanning': { status: 404 },
      'secret-scanning': { status: 400 },
    });

    const result: any = await collectSecurity(ctxWith(request));

    expect(result.available).toBe(false);
    expect(result.total).toBe(0);
    expect(result.worst).toBeNull();
    expect(result.sources.codeScanning).toEqual({ available: false, open: 0, truncated: false });
  });

  it('reports a clean repo and flags truncated sources', async () => {
    const request = byRoute({
      dependabot: Array.from({ length: 100 }, () => ({ security_advisory: { severity: 'low' } })),
      'code-scanning': [],
      'secret-scanning': { message: 'not a list' },
    });

    const result: any = await collectSecurity(ctxWith(request));

    expect(result.sources.dependabot.truncated).toBe(true);
    expect(result.sources.codeScanning).toEqual({ available: true, open: 0, truncated: false });
    expect(result.sources.secretScanning.open).toBe(0);
    expect(result.items).toHaveLength(50);
    expect(result.top).toHaveLength(5);
  });

  it('propagates unexpected errors', async () => {
    const request = byRoute({ dependabot: { status: 500 } });
    await expect(collectSecurity(ctxWith(request))).rejects.toEqual({ status: 500 });
  });
});

describe('summarizeAlerts', () => {
  it('handles no alerts and no sources', () => {
    expect(summarizeAlerts([], {})).toMatchObject({ available: false, total: 0, worst: null, items: [] });
  });
});
