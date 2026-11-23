import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import { internalError } from '../lib/error-handler';
import { formatLogRow } from '../domain/activity';

export const activityRoutes = new Hono<HttpEnv>();

// List activities with filters
activityRoutes.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const rows = await c.var.storage.activity.listActivities({
      entityType: c.req.query('entityType'),
      entityId: c.req.query('entityId'),
      actorType: c.req.query('actorType'),
      actorName: c.req.query('actorName'),
      action: c.req.query('action'),
      limit, offset,
    });

    return c.json({ activities: rows.map(formatLogRow), total: rows.length, limit, offset });
  } catch (e: any) {
    return internalError(c, e, { activities: [] });
  }
});

// Get activity stats by actor
activityRoutes.get('/stats/by-actor', async (c) => {
  try {
    const rows = await c.var.storage.activity.getStatsByActor();
    return c.json({
      actors: rows.map((row: any) => ({
        actorType: row.actor_type,
        actorName: row.actor_name,
        totalActions: parseInt(row.total_actions),
        entitiesTouched: parseInt(row.entities_touched),
        lastActivity: row.last_activity,
      })),
    });
  } catch (e: any) {
    return internalError(c, e, { actors: [] });
  }
});

// Get activity stats by day
activityRoutes.get('/stats/by-day', async (c) => {
  const days = parseInt(c.req.query('days') || '7');

  try {
    const rows = await c.var.storage.activity.getStatsByDay(days);
    return c.json({
      days: rows.map((row: any) => ({
        day: row.day,
        actorType: row.actor_type,
        actorName: row.actor_name,
        actions: parseInt(row.actions),
      })),
    });
  } catch (e: any) {
    return internalError(c, e, { days: [] });
  }
});

// Get activity count
activityRoutes.get('/count', async (c) => {
  try {
    const count = await c.var.storage.activity.getActivityCount(c.req.query('entityType'), c.req.query('entityId'));
    return c.json({ count });
  } catch (e: any) {
    return internalError(c, e, { count: 0 });
  }
});

// Get activity for specific repo
activityRoutes.get('/repo/:fullName', async (c) => {
  const fullName = c.req.param('fullName');
  const limit = parseInt(c.req.query('limit') || '20');

  try {
    const rows = await c.var.storage.activity.getActivitiesByEntity('repo', fullName, limit);
    return c.json({ activities: rows.map(formatLogRow) });
  } catch (e: any) {
    return internalError(c, e, { activities: [] });
  }
});

// Get activity for specific group
activityRoutes.get('/group/:slug', async (c) => {
  const slug = c.req.param('slug');
  const limit = parseInt(c.req.query('limit') || '20');

  try {
    const rows = await c.var.storage.activity.getActivitiesByEntity('group', slug, limit);
    return c.json({ activities: rows.map(formatLogRow) });
  } catch (e: any) {
    return internalError(c, e, { activities: [] });
  }
});
