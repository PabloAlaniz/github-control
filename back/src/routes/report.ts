import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { buildReport } from '../services/report.service';

export const reportRoutes = new Hono<HttpEnv>();

// What changed over the last days (7 by default, 1 to 90), from stored data.
reportRoutes.get('/', async (c) => {
  const requested = Number(c.req.query('days') ?? 7);
  const days = Number.isInteger(requested) && requested >= 1 && requested <= 90 ? requested : 7;
  return c.json(await buildReport(serviceContext(c), days));
});
