FROM node:24-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
