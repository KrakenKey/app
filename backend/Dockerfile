FROM node:24 AS builder
WORKDIR /app

# 1. Setup Shared Library
COPY shared ./shared
WORKDIR /app/shared
RUN yarn install --frozen-lockfile --non-interactive && yarn build

# 2. Setup Backend
WORKDIR /app
COPY backend/package*.json backend/yarn.lock ./backend/
WORKDIR /app/backend
RUN yarn install --frozen-lockfile --non-interactive && yarn cache clean

# 3. Build Backend
COPY backend/ .
RUN yarn build

# Production Stage
FROM node:24-slim
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
ENV NODE_ENV=production

# Copy shared lib source so yarn install --production works (resolving file:../shared)
COPY --from=builder /app/shared /app/shared

COPY backend/package*.json backend/yarn.lock ./
RUN yarn install --production --frozen-lockfile --non-interactive && yarn cache clean

COPY --from=builder /app/backend/dist ./dist

EXPOSE 8888
USER node
CMD ["node", "dist/main.js"]
