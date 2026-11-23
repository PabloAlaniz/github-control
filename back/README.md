# GitHub Control: backend

The Hono API. It runs on Node (`src/server.ts`) and on Cloudflare Workers (`src/index.ts`).

```bash
npm test                 # vitest
npx tsc --noEmit         # type check
npm run build:node       # dist/server.mjs and dist/cli.mjs (single-file bundles)
npm start                # run the Node server
npm run dev              # Cloudflare Workers runtime (wrangler dev)
npm run deploy           # deploy the Worker
```

See the [README](../README.md) for usage and [ARCHITECTURE.md](../ARCHITECTURE.md) for how it is put together.

`scripts/` holds the standalone PostgreSQL sync used by Cloudflare Workers deployments; the Node server has its own built-in sync and does not need them.
