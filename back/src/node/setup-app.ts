/**
 * First-run setup API. Served by the Node server only while the instance is
 * not configured; once the wizard succeeds the main app takes over.
 *
 * An unconfigured instance is claimable by whoever reaches it first, so every
 * write requires the one-time setup code printed in the server log.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { constantTimeEqual, hashPassword, randomSecret } from '../lib/password';
import type { ConfigValues } from './config-store';

export interface SetupDeps {
  /** One-time code the operator reads from the server log. */
  setupCode: string;
  /** Settings the environment already provides; the wizard does not ask for these. */
  provided: ConfigValues;
  /** Returns the GitHub login for a token, or throws when it is not usable. */
  verifyGithubToken: (token: string) => Promise<string>;
  /** Whether this Node version can open SQLite databases. */
  sqliteAvailable: boolean;
  /** Persists the new settings and switches the server out of setup mode. */
  complete: (values: ConfigValues) => void;
}

const SQLITE_OPTION = {
  id: 'sqlite', label: 'SQLite database',
  description: 'A single database file. Recommended: fast and safe as your history grows.',
} as const;

const FILE_OPTIONS = [
  { id: 'json', label: 'JSON files', description: 'One readable .json file per collection. No database needed.' },
  { id: 'csv', label: 'CSV files', description: 'One .csv file per collection, easy to open in a spreadsheet.' },
] as const;

const SetupSchema = z.object({
  setupCode: z.string().min(1),
  storage: z.object({ driver: z.enum(['sqlite', 'json', 'csv']) }).optional(),
  github: z.object({
    token: z.string().min(1),
    orgs: z.array(z.string().regex(/^[A-Za-z0-9-]+$/, 'Invalid organization name')).max(50).default([]),
  }).optional(),
  admin: z.object({
    username: z.string().min(1).max(100),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  }).optional(),
});

export function createSetupApp(deps: SetupDeps) {
  const app = new Hono();
  const { provided } = deps;
  const storageOptions = deps.sqliteAvailable ? [SQLITE_OPTION, ...FILE_OPTIONS] : [...FILE_OPTIONS];

  /** What the wizard still has to ask for. */
  const needs = {
    storage: !provided.STORAGE_DRIVER && !provided.DATABASE_URL,
    github: !provided.GITHUB_TOKEN,
    admin: provided.DISABLE_AUTH !== 'true'
      && !(provided.AUTH_USERNAME && (provided.AUTH_PASSWORD || provided.AUTH_PASSWORD_HASH)),
  };

  // Liveness for orchestrators: the process is up, just not configured yet.
  app.get('/api/health', (c) => c.json({ status: 'ok', setupRequired: true, timestamp: new Date().toISOString() }));

  app.get('/api/setup/status', (c) => c.json({ configured: false, needs, storageOptions }));

  app.post('/api/setup', async (c) => {
    const parsed = SetupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid setup data', details: parsed.error.flatten() }, 400);
    }
    const { setupCode, storage, github, admin } = parsed.data;

    if (!constantTimeEqual(setupCode, deps.setupCode)) {
      return c.json({ error: 'Invalid setup code. Check the server log for the current code.' }, 403);
    }

    const absent = (Object.keys(needs) as (keyof typeof needs)[])
      .filter((section) => needs[section] && !parsed.data[section]);
    if (absent.length > 0) {
      return c.json({ error: `Missing setup sections: ${absent.join(', ')}` }, 400);
    }

    const values: ConfigValues = {};
    let githubLogin: string | null = null;

    if (needs.github && github) {
      try {
        githubLogin = await deps.verifyGithubToken(github.token);
      } catch (error: any) {
        return c.json({ error: `GitHub rejected the token: ${error.message}` }, 400);
      }
      values.GITHUB_TOKEN = github.token;
      if (github.orgs.length > 0) values.GITHUB_ORGS = github.orgs.join(',');
    }
    if (needs.storage && storage) {
      if (!storageOptions.some((option) => option.id === storage.driver)) {
        return c.json({ error: `Storage "${storage.driver}" is not available on this server` }, 400);
      }
      values.STORAGE_DRIVER = storage.driver;
    }
    if (needs.admin && admin) {
      values.AUTH_USERNAME = admin.username;
      values.AUTH_PASSWORD_HASH = await hashPassword(admin.password);
    }
    if (!provided.JWT_SECRET) values.JWT_SECRET = randomSecret();
    if (!provided.API_KEY) values.API_KEY = randomSecret();

    deps.complete(values);
    return c.json({ ok: true, githubLogin });
  });

  app.all('/api/*', (c) => c.json({ error: 'Setup required', setupRequired: true }, 503));

  return app;
}

/** Asks GitHub who a token belongs to. */
export async function verifyGithubToken(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'github-control',
    },
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'invalid or expired token' : `HTTP ${res.status}`);
  const user = (await res.json()) as { login: string };
  return user.login;
}
