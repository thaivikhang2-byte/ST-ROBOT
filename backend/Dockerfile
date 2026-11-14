# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY prisma.config.ts tsconfig*.json nest-cli.json jest.config.cjs ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
RUN npm run prisma:generate && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl postgresql-client ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /app /app
RUN mkdir -p /app/.mail-outbox /app/.ai-secrets /app/uploads /app/backups \
    && chown -R node:node /app/.mail-outbox /app/.ai-secrets /app/uploads /app/backups
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
