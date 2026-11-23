import { Hono, type Context } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import type { AlertChannel } from '../application/ports/storage';
import { ACTIONS } from '../domain/activity';
import { ALERT_KINDS, ALERT_KIND_LABELS, resolveAlertOptions } from '../domain/alerts';
import { CHANNEL_TYPES, maskConfig, mergeConfig } from '../lib/alerts/channels';
import { AlertChannelSchema, type AlertChannelBody } from '../schemas/alerts';
import { evaluateAlerts, testChannel } from '../services/alert.service';

export const alertsRoutes = new Hono<HttpEnv>();

/** A channel as the API shows it: the destination is masked. */
function publicChannel(channel: AlertChannel) {
  return { ...channel, config: maskConfig(channel.type, channel.config) };
}

const channelId = (c: Context<HttpEnv>) => {
  const id = Number(c.req.param('id'));
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function readChannelBody(c: Context<HttpEnv>): Promise<{ data: AlertChannelBody } | { response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { response: c.json({ error: 'Invalid JSON body' }, 400) };
  }
  const parsed = AlertChannelSchema.safeParse(body);
  if (!parsed.success) {
    return { response: c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400) };
  }
  return { data: parsed.data };
}

function logChannel(c: Context<HttpEnv>, action: string, channel: { id: number; name: string; type: string }) {
  return c.var.storage.activity.logActivity({
    action, entityType: 'alert_channel', entityId: String(channel.id),
    newValue: `${channel.name} (${channel.type})`,
    actorType: c.req.header('X-Actor-Type') || 'human', actorName: c.req.header('X-Actor-Name') || 'user',
  }).catch(() => undefined);
}

// Alerts: open ones by default, `status=resolved` or `status=all` for the history.
alertsRoutes.get('/', async (c) => {
  const status = c.req.query('status') ?? 'open';
  if (!['open', 'resolved', 'all'].includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 200, 1), 1000);

  const alerts = await c.var.storage.alerts.listAlerts({
    ...(status !== 'all' && { status: status as 'open' | 'resolved' }), limit,
  });
  // The count covers every open alert, whatever this page of the listing holds.
  const open = status === 'open' && alerts.length < limit
    ? alerts.length
    : (await c.var.storage.alerts.listAlerts({ status: 'open', limit: 10_000 })).length;
  return c.json({ alerts, open, kinds: ALERT_KIND_LABELS, rules: resolveAlertOptions(c.env) });
});

// Re-evaluate now, from what is stored (no GitHub calls). Runs on its own after every sync and service check.
alertsRoutes.post('/evaluate', async (c) => c.json(await evaluateAlerts(serviceContext(c))));

alertsRoutes.get('/channels', async (c) => {
  const channels = await c.var.storage.alertChannels.listChannels();
  return c.json({
    channels: channels.map(publicChannel),
    types: Object.entries(CHANNEL_TYPES).map(([type, { label, fields }]) => ({ type, label, fields })),
    kinds: ALERT_KINDS.map((kind) => ({ kind, label: ALERT_KIND_LABELS[kind] })),
  });
});

alertsRoutes.post('/channels', async (c) => {
  const body = await readChannelBody(c);
  if ('response' in body) return body.response;
  const config = mergeConfig(body.data.type, {}, body.data.config);
  const invalid = CHANNEL_TYPES[body.data.type].validate(config);
  if (invalid) return c.json({ error: invalid }, 400);

  // Whatever is already wrong is recorded first, so the new channel only hears about what changes from now on.
  await evaluateAlerts(serviceContext(c), { notify: false });
  const channel = await c.var.storage.alertChannels.createChannel({ ...body.data, config });
  await logChannel(c, ACTIONS.ALERT_CHANNEL_CREATE, channel);
  return c.json({ success: true, channel: publicChannel(channel) }, 201);
});

alertsRoutes.put('/channels/:id', async (c) => {
  const id = channelId(c);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const body = await readChannelBody(c);
  if ('response' in body) return body.response;

  const stored = await c.var.storage.alertChannels.getChannel(id);
  if (!stored) return c.json({ error: 'Channel not found' }, 404);
  // Secrets only carry over within the same type: a new type needs its own.
  const config = mergeConfig(body.data.type, stored.type === body.data.type ? stored.config : {}, body.data.config);
  const invalid = CHANNEL_TYPES[body.data.type].validate(config);
  if (invalid) return c.json({ error: invalid }, 400);

  const channel = await c.var.storage.alertChannels.updateChannel(id, { ...body.data, config });
  if (!channel) return c.json({ error: 'Channel not found' }, 404);
  await logChannel(c, ACTIONS.ALERT_CHANNEL_UPDATE, channel);
  return c.json({ success: true, channel: publicChannel(channel) });
});

alertsRoutes.delete('/channels/:id', async (c) => {
  const id = channelId(c);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const stored = await c.var.storage.alertChannels.getChannel(id);
  if (!stored || !(await c.var.storage.alertChannels.deleteChannel(id))) return c.json({ error: 'Channel not found' }, 404);
  await logChannel(c, ACTIONS.ALERT_CHANNEL_DELETE, stored);
  return c.json({ success: true });
});

// Sends a test message. 200 either way: `ok` says whether the destination accepted it.
alertsRoutes.post('/channels/:id/test', async (c) => {
  const id = channelId(c);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const channel = await c.var.storage.alertChannels.getChannel(id);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);
  const error = await testChannel(serviceContext(c), channel);
  return c.json({ ok: error === null, error });
});
