# Build Stage
FROM node:24-alpine AS builder
WORKDIR /app

# 1. Setup Shared Library
COPY shared ./shared
WORKDIR /app/shared
RUN yarn install --frozen-lockfile && yarn build

# 2. Setup Frontend
WORKDIR /app
COPY frontend/package.json frontend/yarn.lock ./frontend/
WORKDIR /app/frontend
RUN yarn install --frozen-lockfile

# 3. Build Frontend
COPY frontend/ .
RUN yarn build

# Production Stage
FROM nginx:alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
