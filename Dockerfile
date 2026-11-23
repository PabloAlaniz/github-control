# Self-hosted image: one Node process serving the API and the built frontend.
# No environment variables are required: on first start the app opens a setup
# wizard and keeps its configuration and data under /data.
#
# (Cloudflare Workers deployments do not use this image; see back/wrangler.toml.)

# The build stage runs on the builder's own architecture: its output is plain
# JavaScript, so multi-arch images (amd64, arm64) do not need emulation here.
FROM --platform=$BUILDPLATFORM node:26-slim AS build
WORKDIR /app

# Workspace dependencies (root + front + back)
COPY package*.json ./
COPY front/package.json ./front/
COPY back/package.json ./back/
RUN npm ci

# Frontend -> front/dist; server and CLI -> back/dist/*.mjs (one bundled file each)
COPY . .
RUN npm run build && npm run build:node -w github-control-back

FROM node:26-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=13337 \
    DATA_DIR=/data \
    STATIC_DIR=/app/front/dist

COPY --from=build /app/back/dist/server.mjs /app/back/dist/cli.mjs ./back/dist/
COPY --from=build /app/front/dist ./front/dist
# The fictional dataset served by demo mode (DEMO=true).
COPY --from=build /app/docs/demo/demo-data.json ./docs/demo/demo-data.json

# config.json and the file storage live here: mount a volume to keep them.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 13337
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "back/dist/server.mjs"]
