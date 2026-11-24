import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));
const request = vi.fn();
vi.mock('@back/lib/github/client', () => ({ getOctokit: () => ({ request }) }));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { buildCodeQuery } from '@back/services/search.service';

let env: any;
let storage: Storage;
const get = (path: string) => app.request(path, { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
const item = (repo: string, path: string, fragment = 'const createStorage = () => {}', indices = [6, 19]) => ({
  path, html_url: `https://github.com/${repo}/blob/main/${path}`, repository: { full_name: repo },
  text_matches: [{ fragment, matches: [{ text: 'createStorage', indices }] }],
});

describe('code search query', () => {
  it('scopes the words to the owners, or to one repo', () => {
    expect(buildCodeQuery('createStorage', { owners: ['acme', 'me'] })).toBe('createStorage user:acme user:me');
    expect(buildCodeQuery('  two   words ', { repo: 'acme/api' }, 'Type Script')).toBe('two words language:Type-Script repo:acme/api');
  });

  it('keeps qualifiers that narrow the search and drops those that would move it elsewhere', () => {
    expect(buildCodeQuery('TODO path:src extension:ts', { owners: ['acme'] })).toBe('TODO path:src extension:ts user:acme');
    expect(buildCodeQuery('secret org:other repo:other/x user:someone -user:acme', { owners: ['acme'] })).toBe('secret user:acme');
  });
});

describe('GET /api/search/code', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([
      repoRecord('acme/api'), repoRecord('acme/web'), repoRecord('me/tools'), repoRecord('acme/old', { is_archived: true }),
    ]);
    request.mockResolvedValue({ data: { total_count: 3, incomplete_results: false, items: [
      item('acme/api', 'src/storage.ts'), item('acme/api', 'src/index.ts'), item('acme/web', 'lib/db.js'),
    ] } });
  });

  it('searches the owners of the tracked repos and groups the files by repo', async () => {
    const res = await get('/api/search/code?q=createStorage');
    expect(res.status).toBe(200);
    expect(request).toHaveBeenCalledWith('GET /search/code', expect.objectContaining({
      q: 'createStorage user:acme user:me', headers: { accept: 'application/vnd.github.text-match+json' },
    }));
    expect(await res.json()).toEqual({
      query: 'createStorage', total: 3, shown: 3, incomplete: false, ownersSkipped: [],
      repos: [
        { repo: 'acme/api', files: [
          { path: 'src/storage.ts', url: 'https://github.com/acme/api/blob/main/src/storage.ts', matches: [{ text: 'const createStorage = () => {}', highlights: [[6, 19]] }] },
          expect.objectContaining({ path: 'src/index.ts' }),
        ] },
        { repo: 'acme/web', files: [expect.objectContaining({ path: 'lib/db.js' })] },
      ],
    });
  });

  it('leaves out repos of those owners that the dashboard does not track', async () => {
    request.mockResolvedValue({ data: { total_count: 3, items: [item('acme/api', 'a.ts'), item('acme/old', 'b.ts'), item('acme/unknown', 'c.ts')] } });
    const body = await (await get('/api/search/code?q=x')).json() as any;
    expect(body.repos.map((r: any) => r.repo)).toEqual(['acme/api']);
    expect(body).toMatchObject({ total: 3, shown: 1 });
  });

  it('narrows to one tracked repo and to a language', async () => {
    await get('/api/search/code?q=createStorage&repo=acme/api&language=typescript');
    expect(request.mock.calls[0][1].q).toBe('createStorage language:typescript repo:acme/api');

    expect((await get('/api/search/code?q=x&repo=other/secret')).status).toBe(400);
    expect((await get('/api/search/code?q=x&repo=acme/old')).status).toBe(400);   // archived
    expect((await get('/api/search/code?q=x&repo=../etc')).status).toBe(400);
    expect((await get('/api/search/code?q=x&language=%3Cb%3E')).status).toBe(400);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks for something to look for', async () => {
    expect((await get('/api/search/code')).status).toBe(400);
    expect((await get('/api/search/code?q=%20%20')).status).toBe(400);
    expect((await get('/api/search/code?q=user:acme')).status).toBe(400);
    expect((await get(`/api/search/code?q=${'x'.repeat(201)}`)).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('shows the matches in a file\'s content, not those in its path', async () => {
    request.mockResolvedValue({ data: { total_count: 1, items: [{
      path: 'src/storage.ts', html_url: 'u', repository: { full_name: 'acme/api' },
      text_matches: [
        { property: 'path', fragment: 'src/storage.ts', matches: [{ indices: [4, 11] }] },
        { property: 'content', fragment: 'new Storage()', matches: [{ indices: [4, 11] }] },
      ],
    }] } });
    const body = await (await get('/api/search/code?q=storage')).json() as any;
    expect(body.repos[0].files[0].matches).toEqual([{ text: 'new Storage()', highlights: [[4, 11]] }]);
  });

  it('copes with files that come without text matches', async () => {
    request.mockResolvedValue({ data: { total_count: 1, incomplete_results: true, items: [{ path: 'a.bin', html_url: 'u', repository: { full_name: 'acme/api' } }] } });
    const body = await (await get('/api/search/code?q=x')).json() as any;
    expect(body).toMatchObject({ incomplete: true, repos: [{ repo: 'acme/api', files: [{ path: 'a.bin', matches: [] }] }] });
  });

  it.each([
    [422, 400, /could not run that search/], [403, 429, /limiting code searches/], [429, 429, /limiting code searches/], [500, 502, /GitHub search failed/],
  ])('turns a GitHub %i into a %i with a reason', async (githubStatus, status, message) => {
    request.mockRejectedValue(Object.assign(new Error('boom'), { status: githubStatus }));
    const res = await get('/api/search/code?q=x');
    expect(res.status).toBe(status);
    expect((await res.json() as any).error).toMatch(message);
  });

  it('answers empty without asking GitHub when no repos are tracked', async () => {
    const empty = memoryEnv();
    const res = await app.request('/api/search/code?q=x', { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, empty.env);
    expect(await res.json()).toMatchObject({ total: 0, repos: [] });
    expect(request).not.toHaveBeenCalled();
  });

  it('searches at most 15 owners at once and says which were left out', async () => {
    await storage.repos.refreshFromGitHub(Array.from({ length: 17 }, (_, i) => repoRecord(`owner${String(i).padStart(2, '0')}/repo`)));
    request.mockResolvedValue({ data: { total_count: 0, items: [] } });
    const body = await (await get('/api/search/code?q=x')).json() as any;
    expect(request.mock.calls[0][1].q.match(/user:/g)).toHaveLength(15);
    expect(body.ownersSkipped).toEqual(['owner15', 'owner16']);
  });

  it('requires authentication, and is refused in a demo', async () => {
    expect((await app.request('/api/search/code?q=x', {}, env)).status).toBe(401);
    env.DEMO = 'true';
    expect((await get('/api/search/code?q=x')).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });

  it('is available to agents as an MCP tool', async () => {
    const res = await app.request('/api/mcp', {
      method: 'POST', headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_code', arguments: { query: 'createStorage', repo: 'acme/api' } } }),
    }, env);
    const { result } = await res.json() as any;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text).repos[0].repo).toBe('acme/api');
    expect(request.mock.calls[0][1].q).toBe('createStorage repo:acme/api');
  });
});
