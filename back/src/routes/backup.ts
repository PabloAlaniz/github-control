import { Hono } from 'hono';
import { z } from 'zod';
import type { HttpEnv } from '../http/context';
import { SavedViewSchema } from '../schemas/saved-views';

export const backupRoutes = new Hono<HttpEnv>();

const EXPORT_VERSION = 1;

/**
 * Export a portable JSON snapshot of local configuration:
 * - groups (slug, name, description, color)
 * - repo_groups edges
 * - meta overrides per repo (priority, local_status, notes, next_action, blockers, client)
 * - saved views (name, query)
 *
 * NOT exported: repos cached from GitHub (rebuildable via refresh), metrics history.
 */
backupRoutes.get('/export', async (c) => {
  const [groups, edges, repos, savedViews] = await Promise.all([
    c.var.storage.groups.listGroups(),
    c.var.storage.groups.listAllRepoGroupEdges(),
    c.var.storage.repos.listRepos({ includeArchived: true, includePaused: true }),
    c.var.storage.savedViews.listSavedViews(),
  ]);

  const meta = (repos as any[])
    .map(r => ({
      full_name: r.full_name,
      priority: r.priority ?? null,
      local_status: r.local_status ?? null,
      client: r.client ?? null,
      notes: r.notes ?? null,
      next_action: r.next_action ?? null,
      blockers: r.blockers ?? [],
    }))
    .filter(m =>
      m.priority !== null || m.local_status !== null || m.client !== null ||
      m.notes !== null || m.next_action !== null || (m.blockers && m.blockers.length > 0),
    );

  return c.json({
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    groups: (groups as any[]).map(g => ({
      slug: g.slug, name: g.name, description: g.description, color: g.color,
    })),
    repo_groups: edges,
    meta_overrides: meta,
    saved_views: savedViews.map(v => ({ name: v.name, query: v.query })),
  });
});

const ImportSchema = z.object({
  version: z.number().int().positive(),
  exported_at: z.string().optional(),
  groups: z.array(z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  })).default([]),
  repo_groups: z.array(z.object({
    repo_full_name: z.string().min(1),
    group_slug: z.string().min(1),
  })).default([]),
  meta_overrides: z.array(z.object({
    full_name: z.string().min(1),
    priority: z.string().nullable().optional(),
    local_status: z.string().nullable().optional(),
    client: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    next_action: z.string().nullable().optional(),
    blockers: z.array(z.string()).nullable().optional(),
  })).default([]),
  // Optional: exports made before saved views existed do not have it.
  saved_views: z.array(SavedViewSchema).default([]),
});

/**
 * Import a configuration snapshot produced by /export. Idempotent:
 * - Groups upserted by slug (description/color overwrite).
 * - repo_groups added (no conflicts thanks to ON CONFLICT DO NOTHING).
 * - Meta overrides applied per-repo, skipping repos not yet in the cache.
 *
 * Returns a summary of what was applied vs skipped.
 */
backupRoutes.post('/import', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Schema validation failed', details: parsed.error.flatten() }, 400);
  }
  if (parsed.data.version !== EXPORT_VERSION) {
    return c.json({ error: `Unsupported export version: ${parsed.data.version} (expected ${EXPORT_VERSION})` }, 400);
  }

  const summary = {
    groups_upserted: 0,
    repo_groups_added: 0,
    repo_groups_skipped_missing_repo: 0,
    meta_applied: 0,
    meta_skipped_missing_repo: 0,
    saved_views_upserted: 0,
  };

  // 1) Upsert groups by slug.
  const groupIdBySlug = new Map<string, number>();
  for (const g of parsed.data.groups) {
    const inserted = await c.var.storage.groups.upsertGroupBySlug(g.slug, g.name, g.description ?? null, g.color ?? null);
    if (inserted?.id) {
      groupIdBySlug.set(g.slug, inserted.id);
      summary.groups_upserted++;
    }
  }

  // 2) Apply repo_groups edges.
  for (const edge of parsed.data.repo_groups) {
    const repo = await c.var.storage.groups.getRepoId(edge.repo_full_name);
    if (!repo) {
      summary.repo_groups_skipped_missing_repo++;
      continue;
    }
    let groupId = groupIdBySlug.get(edge.group_slug);
    if (!groupId) {
      // Group was not in the export's groups list — fetch by slug.
      const existing = await c.var.storage.groups.listGroups();
      const found = (existing as any[]).find(g => g.slug === edge.group_slug);
      if (!found) continue;
      groupId = found.id;
    }
    await c.var.storage.groups.addRepoToGroup(repo.id, groupId!);
    summary.repo_groups_added++;
  }

  // 3) Apply meta overrides per repo.
  for (const m of parsed.data.meta_overrides) {
    const updates: Record<string, any> = {};
    if (m.priority !== undefined) updates.priority = m.priority;
    if (m.local_status !== undefined) updates.local_status = m.local_status;
    if (m.client !== undefined) updates.client = m.client;
    if (m.notes !== undefined) updates.notes = m.notes;
    if (m.next_action !== undefined) updates.next_action = m.next_action;
    if (m.blockers !== undefined) updates.blockers = m.blockers;
    if (Object.keys(updates).length === 0) continue;

    const result = await c.var.storage.meta.patchRepoMeta(m.full_name, updates);
    if (result) summary.meta_applied++;
    else summary.meta_skipped_missing_repo++;
  }

  // 4) Upsert saved views by name.
  for (const view of parsed.data.saved_views) {
    await c.var.storage.savedViews.upsertSavedView(view.name, view.query);
    summary.saved_views_upserted++;
  }

  return c.json({ success: true, version: parsed.data.version, summary });
});
