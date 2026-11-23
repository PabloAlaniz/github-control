import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { fetchReadme, generateSummary } from '../services/readme.service';

export const readmeRoutes = new Hono<HttpEnv>();

// Get README
readmeRoutes.get('/:owner/:repo/readme', async (c) => {
  const { owner, repo } = c.req.param();
  const result = await fetchReadme(serviceContext(c), owner, repo);
  if (!result) return c.json({ error: 'README not found' }, 404);
  return c.json(result);
});

// Get docs
readmeRoutes.get('/:owner/:repo/docs', async (c) => {
  const { owner, repo } = c.req.param();
  const row = await c.var.storage.health.getDocs(`${owner}/${repo}`);
  return c.json({ readme: row?.readme_content || null, summary: row?.summary || null });
});

// Save summary
readmeRoutes.post('/:owner/:repo/summary', async (c) => {
  const { owner, repo } = c.req.param();
  const summary = await c.req.json();
  await c.var.storage.health.saveSummary(`${owner}/${repo}`, summary);
  return c.json({ success: true });
});

// Generate summary from README (cached unless force=true)
readmeRoutes.post('/:owner/:repo/generate-summary', async (c) => {
  const { owner, repo } = c.req.param();
  const force = c.req.query('force') === 'true';
  try {
    const summary = await generateSummary(serviceContext(c), owner, repo, { force });
    if (!summary) return c.json({ error: 'No README available. Fetch README first.' }, 400);
    return c.json({ success: true, summary });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
