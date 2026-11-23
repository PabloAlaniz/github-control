/**
 * Node entrypoint (Docker / self-hosting). The Cloudflare Worker entrypoint
 * is `index.ts`; both serve the same app.
 *
 *   PORT        default 13337
 *   DATA_DIR    default ./data   (config.json + file storage)
 *   STATIC_DIR  default ../front/dist
 *   SYNC_INTERVAL_HOURS  default 24 (0 disables the automatic sync)
 *
 * Every other setting is optional: without them the app opens a setup wizard.
 */
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createServerApp } from './node/server-app';

const port = Number(process.env.PORT || 13337);
const dataDir = resolve(process.env.DATA_DIR || './data');
const staticDir = resolve(process.env.STATIC_DIR || '../front/dist');

const app = createServerApp({ env: process.env, dataDir, staticDir, autoSync: true });

serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, (info) => {
  console.log(`GitHub Control listening on http://localhost:${info.port} (data: ${dataDir})`);
});
