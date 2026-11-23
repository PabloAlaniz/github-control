import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { buildDependencyInventory } from '../services/dependency.service';

export const dependenciesRoutes = new Hono<HttpEnv>();

// Cross-repo inventory: packages with who uses which version, plus declared runtimes.
dependenciesRoutes.get('/', async (c) => c.json(await buildDependencyInventory(serviceContext(c))));
