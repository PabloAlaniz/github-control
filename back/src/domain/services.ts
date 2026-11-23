/** Rules for deriving a service from a repo that declares a homepage. Pure. */

type Repo = Record<string, any>;

const PROVIDER_BY_HOST: [needle: string, provider: string][] = [
  ['.run.app', 'gcp'],
  ['.pages.dev', 'cloudflare'],
  ['.workers.dev', 'cloudflare'],
  ['.vercel.app', 'vercel'],
  ['.herokuapp.com', 'heroku'],
];

export function providerForUrl(url: string): string {
  return PROVIDER_BY_HOST.find(([needle]) => url.includes(needle))?.[1] ?? 'other';
}

/** Cloud Run region embedded in a `*.run.app` hostname, e.g. `us-central1`. */
export function regionForUrl(url: string): string | null {
  return url.match(/\.([a-z]+-[a-z]+\d)\.run\.app/)?.[1] ?? null;
}

export function serviceSlugForRepo(repoName: string): string {
  return repoName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export function hasHomepage(repo: Repo): boolean {
  return typeof repo.homepage === 'string' && repo.homepage !== '';
}

/** The service a repo with a homepage maps to. */
export function serviceFromRepo(repo: Repo) {
  const homepage: string = repo.homepage;
  return {
    name: repo.name as string,
    slug: serviceSlugForRepo(repo.name),
    url: homepage.startsWith('http') ? homepage : `https://${homepage}`,
    provider: providerForUrl(homepage),
    region: regionForUrl(homepage),
    source_repo_full_name: repo.full_name as string,
    env: 'production',
  };
}
