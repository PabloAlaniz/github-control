import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { SearchError } from '../lib/github/search';
import { searchTrackedCode } from '../services/search.service';

export const searchRoutes = new Hono<HttpEnv>();

const REPO_NAME = /^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/;

// Search the code of the tracked repos on GitHub: ?q=words[&repo=owner/name][&language=go]
searchRoutes.get('/code', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const repo = c.req.query('repo')?.trim() || undefined;
  const language = c.req.query('language')?.trim() || undefined;

  if (!q) return c.json({ error: 'q is required: the words to look for' }, 400);
  if (q.length > 200) return c.json({ error: 'The search is too long (200 characters at most)' }, 400);
  if (repo && !REPO_NAME.test(repo)) return c.json({ error: 'repo must be owner/name' }, 400);
  if (language && !/^[\w+#. -]{1,40}$/.test(language)) return c.json({ error: 'Not a language name' }, 400);

  try {
    return c.json(await searchTrackedCode(serviceContext(c), q, { repo, language }));
  } catch (error) {
    if (error instanceof SearchError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});
