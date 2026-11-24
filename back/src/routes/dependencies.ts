import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { resolvePolicy } from '../domain/policy';
import { buildDependencyInventory, listVulnerabilities, locatePackage } from '../services/dependency.service';

export const dependenciesRoutes = new Hono<HttpEnv>();

// Cross-repo inventory: packages with who uses which version, plus declared runtimes.
dependenciesRoutes.get('/', async (c) => c.json(await buildDependencyInventory(serviceContext(c))));

// Where a package is across repos, transitive dependencies included: ?name=lodash
dependenciesRoutes.get('/locate', async (c) => {
  const name = (c.req.query('name') ?? '').trim();
  if (name.length < 2 || name.length > 200) return c.json({ error: 'name is required: the package to look for (2 characters or more)' }, 400);
  return c.json(await locatePackage(serviceContext(c), name));
});

// Known vulnerabilities of the pinned versions, across repos. `enabled` says whether the policy asks for the lookup.
dependenciesRoutes.get('/vulnerabilities', async (c) => {
  const ctx = serviceContext(c);
  return c.json({ enabled: resolvePolicy(ctx.config).signals.vulnerabilities, ...(await listVulnerabilities(ctx)) });
});
