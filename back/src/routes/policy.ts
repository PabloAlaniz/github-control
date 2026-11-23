import { Hono, type Context } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { SettingsError } from '../application/ports/settings';
import { ACTIONS } from '../domain/activity';
import { describePolicy, planPolicy } from '../services/policy.service';

export const policyRoutes = new Hono<HttpEnv>();

const MAX_BYTES = 50_000;

/** The document from the body: `{ "yaml": "..." }`, or the YAML itself as text. */
async function readDocument(c: Context<HttpEnv>): Promise<string | null> {
  const text = await c.req.text();
  if (text.length > MAX_BYTES) return null;
  if ((c.req.header('Content-Type') ?? '').includes('application/json')) {
    try {
      const body = JSON.parse(text);
      return typeof body?.yaml === 'string' ? body.yaml : null;
    } catch {
      return null;
    }
  }
  return text;
}

// The policy in force, where it comes from and whether it can be changed here.
policyRoutes.get('/', (c) => c.json(describePolicy(c.env)));

// Dry run: validate a document and say what adopting it would change. Changes nothing.
policyRoutes.post('/plan', async (c) => {
  const text = await readDocument(c);
  if (text === null) return c.json({ error: 'Send the policy as { "yaml": "..." } or as YAML text (50 kB at most)' }, 400);
  const plan = await planPolicy(serviceContext(c), text);
  return c.json(plan, plan.valid ? 200 : 422);
});

// Adopt a document. Refused when it is not valid, or when the policy comes from a file or the environment.
policyRoutes.put('/', async (c) => {
  const text = await readDocument(c);
  if (text === null) return c.json({ error: 'Send the policy as { "yaml": "..." } or as YAML text (50 kB at most)' }, 400);

  const info = describePolicy(c.env);
  if (!info.editable) {
    const why = info.source === 'file' ? 'it is read from the file POLICY_FILE points to: change that file'
      : info.source === 'env' ? 'it is set by the POLICY environment variable'
        : 'this server takes its settings from its deployment configuration: set the POLICY variable';
    return c.json({ error: `The policy cannot be changed here: ${why}` }, 409);
  }

  const plan = await planPolicy(serviceContext(c), text);
  if (!plan.valid) return c.json(plan, 422);

  try {
    await c.env.settings!.update({ policy: text });
  } catch (error) {
    if (error instanceof SettingsError) return c.json({ error: error.message }, 400);
    throw error;
  }

  await c.var.storage.activity.logActivity({
    action: ACTIONS.POLICY_UPDATE, entityType: 'system', entityId: 'policy',
    newValue: plan.changes.length === 0 ? 'No changes' : plan.changes.map((change) => `${change.section}.${change.key}`).join(', ').slice(0, 500),
    actorType: c.req.header('X-Actor-Type') || 'human', actorName: c.req.header('X-Actor-Name') || 'user',
    metadata: { changes: plan.changes },
  }).catch(() => undefined);

  return c.json({ applied: true, ...plan, policy: describePolicy(c.env) });
});
