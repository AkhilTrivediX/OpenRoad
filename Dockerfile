FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    OPENROAD_DATA_FILE=/data/openroad-state.json \
    OPENROAD_INTEGRATION_FILE=/data/openroad-integrations.json \
    OPENROAD_TEAM_FILE=/data/openroad-team.json \
    OPENROAD_DIST_DIR=/app/dist \
    OPENROAD_NOTIFICATION_DELIVERY_MODE=disabled \
    OPENROAD_NOTIFICATION_DELIVERY_FILE=/data/openroad-notification-deliveries.jsonl \
    OPENROAD_TOKEN_ENCRYPTION_KEY= \
    OPENROAD_TOKEN_ENCRYPTION_KEY_ID=primary \
    OPENROAD_SINGLE_USER_MODE=false \
    OPENROAD_TRUST_PROXY_HEADERS=false \
    PORT=4173

WORKDIR /app

RUN addgroup -S openroad && \
    adduser -S openroad -G openroad && \
    mkdir -p /data && \
    chown -R openroad:openroad /data

COPY --from=build --chown=openroad:openroad /app/package.json ./package.json
COPY --from=build --chown=openroad:openroad /app/dist ./dist
COPY --from=build --chown=openroad:openroad /app/server-dist ./server-dist
COPY --from=build --chown=openroad:openroad /app/scripts ./scripts

USER openroad

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server-dist/server/index.js"]
