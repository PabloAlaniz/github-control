/**
 * Node entrypoint (Docker / self-hosting). The Cloudflare Worker entrypoint
 * is `index.ts`; both serve the same app.
 *
 *   PORT        default 13337
 *   DATA_DIR    default ./data   (config.json + file storage)
 *   STATIC_DIR  default ../front/dist
 *   SYNC_INTERVAL_HOURS  default 24 (0 disables the automatic sync)
 *   DEMO        true | readonly: serve the bundled fictional dataset (see node/demo.ts)
 *   DEMO_DATA   default docs/demo/demo-data.json, next to the app
 *
 * Every other setting is optional: without them the app opens a setup wizard.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createServerApp } from './node/server-app';

const port = Number(process.env.PORT || 13337);
const dataDir = resolve(process.env.DATA_DIR || './data');
const staticDir = resolve(process.env.STATIC_DIR || '../front/dist');

// This file runs bundled as back/dist/server.mjs; the dataset ships two levels up.
const demoDataPath = resolve(process.env.DEMO_DATA
  || fileURLToPath(new URL('../../docs/demo/demo-data.json', import.meta.url).href));

const app = createServerApp({ env: process.env, dataDir, staticDir, autoSync: true, demoDataPath });

serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, (info) => {
  const where = process.env.DEMO ? 'demo data' : `data: ${dataDir}`;
  console.log(`GitHub Control listening on http://localhost:${info.port} (${where})`);
});
