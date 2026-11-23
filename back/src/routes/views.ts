import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import { applyRepoView, REPO_VIEW_NAMES } from '../domain/repo-views';

export const viewsRoutes = new Hono<HttpEnv>();

// One endpoint per predefined view: /backlog, /health, /needs-ci, ...
for (const name of REPO_VIEW_NAMES) {
  viewsRoutes.get(`/${name}`, async (c) => {
    const repos = await c.var.storage.repos.listRepos();
    return c.json({ repos: applyRepoView(name, repos) });
  });
}
