FROM node:24 AS builder
WORKDIR /app
# Retries installs that fail on transient registry errors
COPY .github/scripts/retry.sh /usr/local/bin/retry

# 1. Setup Shared Library
COPY shared ./shared
WORKDIR /app/shared
RUN retry yarn install --frozen-lockfile --non-interactive && yarn build

# 2. Setup Backend
WORKDIR /app
COPY backend/package*.json backend/yarn.lock ./backend/
WORKDIR /app/backend
RUN retry yarn install --frozen-lockfile --non-interactive && yarn cache clean

# 3. Build Backend
COPY backend/ .
RUN yarn build

# Production Stage
FROM node:24-slim
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
ENV NODE_ENV=production
COPY .github/scripts/retry.sh /usr/local/bin/retry

# Copy shared lib source so yarn install --production works (resolving file:../shared)
COPY --from=builder /app/shared /app/shared

COPY backend/package*.json backend/yarn.lock ./
RUN retry yarn install --production --frozen-lockfile --non-interactive && yarn cache clean

COPY --from=builder /app/backend/dist ./dist

# The commit this image was built from, reported by GET /. Last, so a new
# commit doesn't invalidate the cached layers above.
ARG KK_GIT_SHA=unknown
ENV KK_GIT_SHA=${KK_GIT_SHA}

EXPOSE 8888
USER node
CMD ["node", "dist/main.js"]
