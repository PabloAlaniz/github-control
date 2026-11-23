import { Hono } from 'hono';
import { z } from 'zod';
import { deleteBranches } from '../services/branch-cleanup.service';
import { syncSignals } from '../services/signal.service';
import { serviceContext, type HttpEnv } from '../http/context';
import { ACTIONS } from '../domain/activity';

export const branchesRoutes = new Hono<HttpEnv>();

const DeleteSchema = z.object({
  branches: z.array(z.object({
    name: z.string().min(1).max(255),
    sha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'sha must be a commit hash'),
  })).min(1).max(50),
});

/**
 * Delete branches on GitHub. Each branch must come with the commit sha it had
 * when it was listed; a branch that moved since, is protected or is the default
 * branch is skipped. Logs every deletion and refreshes the branches signal.
 */
branchesRoutes.post('/:owner/:repo/branches/delete', async (c) => {
  const { owner, repo } = c.req.param();
  const fullName = `${owner}/${repo}`;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  let results;
  try {
    results = await deleteBranches(c.env, owner, repo, parsed.data.branches);
  } catch (err: any) {
    const status = err?.status === 404 ? 404 : 502;
    return c.json({ error: `Could not read ${fullName}: ${err?.message ?? 'unknown error'}` }, status);
  }

  const deleted = results.filter(r => r.deleted);
  for (const branch of deleted) {
    const target = parsed.data.branches.find(b => b.name === branch.name)!;
    await c.var.storage.activity.logActivity({
      action: ACTIONS.BRANCH_DELETE,
      entityType: 'repo',
      entityId: fullName,
      fieldChanged: 'branch',
      oldValue: branch.name,
      actorType: c.req.header('X-Actor-Type') || 'human',
      actorName: c.req.header('X-Actor-Name') || 'user',
      metadata: { branch: branch.name, sha: target.sha },
    });
  }

  // Refresh the cached signal so the UI stops offering the deleted branches.
  if (deleted.length > 0) await syncSignals(serviceContext(c), owner, repo, ['branches']);

  return c.json({ repo: fullName, deleted: deleted.length, skipped: results.length - deleted.length, results });
});
