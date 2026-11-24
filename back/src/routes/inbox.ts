import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { serviceContext, type HttpEnv } from '../http/context';
import { ACTIONS } from '../domain/activity';
import { commentOn, getInbox, getItemDetail, InboxActionError, mergePullRequests, refreshInbox, reviewPullRequest } from '../services/inbox.service';

export const inboxRoutes = new Hono<HttpEnv>();

// Open pull requests and issues across the active repos, from the cached `inbox` signals.
inboxRoutes.get('/', async (c) => c.json(await getInbox(serviceContext(c))));

// Read every repo's open pull requests and issues from GitHub again.
inboxRoutes.post('/refresh', async (c) => c.json(await refreshInbox(serviceContext(c))));

const MergeSchema = z.object({
  pulls: z.array(z.object({
    repo: z.string().regex(/^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/, 'repo must be owner/name'),
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

const REPO = z.string().regex(/^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/, 'repo must be owner/name');
const NUMBER = z.number().int().positive();
const BODY = z.string().trim().max(60_000);

/** Runs an action on a tracked repo, turning its failures into answers and logging what it did. */
async function act<T>(c: Context<HttpEnv>, repo: string, run: () => Promise<T>, log: { action: string; value: string; metadata: Record<string, unknown> }) {
  const known = (await c.var.storage.repos.listRepos()).some((row) => row.full_name === repo);
  if (!known) return c.json({ error: `Not an active repo here: ${repo}` }, 400);
  try {
    const result = await run();
    await c.var.storage.activity.logActivity({
      action: log.action, entityType: 'repo', entityId: repo, fieldChanged: 'pull_request', newValue: log.value,
      actorType: c.req.header('X-Actor-Type') || 'human', actorName: c.req.header('X-Actor-Name') || 'user', metadata: log.metadata,
    }).catch(() => undefined);
    return c.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof InboxActionError) return c.json({ error: error.message }, error.status);
    throw error;
  }
}

// What a pull request or issue says, read from GitHub now: ?repo=owner/name&number=7
inboxRoutes.get('/item', async (c) => {
  const parsed = z.object({ repo: REPO, number: z.coerce.number().int().positive() }).safeParse({ repo: c.req.query('repo'), number: c.req.query('number') });
  if (!parsed.success) return c.json({ error: 'repo (owner/name) and number are required' }, 400);
  const known = (await c.var.storage.repos.listRepos()).some((row) => row.full_name === parsed.data.repo);
  if (!known) return c.json({ error: `Not an active repo here: ${parsed.data.repo}` }, 400);
  try {
    return c.json(await getItemDetail(serviceContext(c), parsed.data.repo, parsed.data.number));
  } catch (error) {
    if (error instanceof InboxActionError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

const ReviewSchema = z.object({
  repo: REPO, number: NUMBER,
  event: z.enum(['approve', 'request_changes', 'comment']),
  body: BODY.default(''),
  sha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'sha must be a commit hash'),
}).refine((review) => review.event === 'approve' || review.body.length > 0, 'A comment or a request for changes needs some text');

/**
 * Review a pull request on GitHub: approve, request changes or comment. It
 * must come with the head commit that was listed: a review of code that
 * changed since is refused.
 */
inboxRoutes.post('/review', async (c) => {
  const parsed = ReviewSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  const { repo, number, event, body, sha } = parsed.data;
  return act(c, repo, () => reviewPullRequest(serviceContext(c), { repo, number, event, body, sha }), {
    action: ACTIONS.PR_REVIEW, value: `#${number}: ${event.replace('_', ' ')}`, metadata: { number, event, sha },
  });
});

const CommentSchema = z.object({ repo: REPO, number: NUMBER, body: BODY.min(1, 'Write a comment') });

// Comment on a pull request or an issue on GitHub.
inboxRoutes.post('/comment', async (c) => {
  const parsed = CommentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  const { repo, number, body } = parsed.data;
  return act(c, repo, () => commentOn(serviceContext(c), repo, number, body), {
    action: ACTIONS.ISSUE_COMMENT, value: `#${number}: comment`, metadata: { number },
  });
});
