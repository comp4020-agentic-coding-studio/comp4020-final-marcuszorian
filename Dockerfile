# syntax = docker/dockerfile:1
#
# Multi-stage: the builder has the tools to typecheck and bundle the client
# (esbuild, three, typescript — none of which the running app needs); the
# runtime stage installs only production dependencies. The server itself runs
# straight from src/ via Node's native TypeScript support — no server build
# step. See doc/adr/0001-stack.md.

FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS builder
# better-sqlite3's postinstall builds a native addon; these are the fallback
# if no prebuilt binary matches this image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY client ./client
COPY migrations ./migrations
RUN pnpm typecheck
RUN NODE_ENV=production pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/dist ./dist
COPY src ./src
# The server imports standings() out of client/src/leaderboard.ts so the coin
# payout and the leaderboard panel cannot disagree about a tie (ADR 0009,
# 0010). That makes client/ a RUNTIME dependency of the server, not only a
# build input — without this line the image boots and dies on the first
# require, with everything green locally.
COPY client ./client
COPY migrations ./migrations
COPY README.md ./README.md

ENV PORT=8080
EXPOSE 8080
# Migrations run here, at boot, on the real machine with /data mounted — NOT
# as a Fly release_command, which runs on a separate machine with no volume
# attached (fly.toml says so). `exec` hands off to node so Fly's SIGTERM
# reaches the server directly for a clean shutdown.
CMD ["sh", "-c", "node src/server/migrate.ts && exec node src/server/index.ts"]
