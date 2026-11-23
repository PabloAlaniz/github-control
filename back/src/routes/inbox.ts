import { Hono } from 'hono';
import { z } from 'zod';
import { serviceContext, type HttpEnv } from '../http/context';
import { ACTIONS } from '../domain/activity';
import { getInbox, mergePullRequests, refreshInbox } from '../services/inbox.service';

export const inboxRoutes = new Hono<HttpEnv>();

// Open pull requests and issues across the active repos, from the cached `inbox` signals.
inboxRoutes.get('/', async (c) => c.json(await getInbox(serviceContext(c))));

// Read every repo's open pull requests and issues from GitHub again.
inboxRoutes.post('/refresh', async (c) => c.json(await refreshInbox(serviceContext(c))));

const MergeSchema = z.object({
  pulls: z.array(z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be owner/name'),
    number: z.number().int().positive(),
    sha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'sha must be a commit hash'),
  })).min(1).max(50),
  method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
});

/**
 * Merge pull requests on GitHub. Each one must come with the head commit it
 * had when it was listed; one that moved, is a draft, is closed or has failing
 * or running checks is skipped. Every merge is logged.
 */
inboxRoutes.post('/merge', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = MergeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  // Only repos the dashboard tracks: the token may reach others.
  const known = new Set((await c.var.storage.repos.listRepos()).map((repo) => repo.full_name));
  const unknown = parsed.data.pulls.filter((pull) => !known.has(pull.repo)).map((pull) => pull.repo);
  if (unknown.length > 0) return c.json({ error: `Not an active repo here: ${[...new Set(unknown)].join(', ')}` }, 400);

  const { pulls, method } = parsed.data;
  const results = await mergePullRequests(serviceContext(c), pulls, method);

  for (const result of results.filter((r) => r.merged)) {
    const target = pulls.find((pull) => pull.repo === result.repo && pull.number === result.number)!;
    await c.var.storage.activity.logActivity({
      action: ACTIONS.PR_MERGE,
      entityType: 'repo',
      entityId: result.repo,
      fieldChanged: 'pull_request',
      newValue: `#${result.number}`,
      actorType: c.req.header('X-Actor-Type') || 'human',
      actorName: c.req.header('X-Actor-Name') || 'user',
      metadata: { number: result.number, sha: target.sha, method },
    }).catch(() => undefined);
  }

  const merged = results.filter((r) => r.merged).length;
  return c.json({ merged, skipped: results.length - merged, results });
});
