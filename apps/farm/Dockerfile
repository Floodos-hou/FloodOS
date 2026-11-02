# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
#
# Build context is ./apps: the game reuses the Tier-1 API client, auth and pure helpers of apps/web by relative import.

FROM node:22-alpine AS builder
WORKDIR /app

COPY web/package*.json ./web/
COPY farm/package*.json ./farm/
RUN cd web && npm ci --fetch-retries=5 --fetch-timeout=120000 \
 && cd ../farm && npm ci --fetch-retries=5 --fetch-timeout=120000

COPY web/src ./web/src
COPY farm ./farm

# Character picker is baked in at build time and OFF unless requested (same switch as the operations portal)
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN cd farm && npm run build

FROM nginx:1.25-alpine
COPY farm/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder /app/farm/dist /usr/share/nginx/html/farm
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
