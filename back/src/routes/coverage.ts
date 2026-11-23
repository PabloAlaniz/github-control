import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { reportCoverage, listReports } from '../services/coverage.service';
import { dispatchCoverageCompute } from '../services/coverage-dispatch.service';

export const coverageRoutes = new Hono<HttpEnv>();

// Coverage update (from CI)
coverageRoutes.post('/:owner/:repo/coverage', async (c) => {
  const { owner, repo } = c.req.param();
  const { coverage, label, commit_sha } = await c.req.json();
  const result = await reportCoverage(serviceContext(c), `${owner}/${repo}`, coverage, label, commit_sha);
  return c.json({ success: true, ...result });
});

// Get all coverage reports for a repo
coverageRoutes.get('/:owner/:repo/coverage', async (c) => {
  const { owner, repo } = c.req.param();
  const reports = await listReports(serviceContext(c), `${owner}/${repo}`);
  return c.json(reports);
});

// Trigger coverage computation via GitHub Actions on the target repo
coverageRoutes.post('/:owner/:repo/coverage/compute', async (c) => {
  const { owner, repo } = c.req.param();
  try {
    const result = await dispatchCoverageCompute(c.env, owner, repo);
    return c.json(result);
  } catch (error: any) {
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    return c.json({ error: error.message }, status);
  }
});
