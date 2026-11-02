# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
#
# Build context is ./apps: the twin reuses the Tier-1 API client, auth and pure helpers of apps/web by relative import.

FROM node:22-alpine AS builder
WORKDIR /app

COPY web/package*.json ./web/
COPY twin3d/package*.json ./twin3d/
RUN cd web && npm ci --fetch-retries=5 --fetch-timeout=120000 \
 && cd ../twin3d && npm ci --fetch-retries=5 --fetch-timeout=120000

COPY web/src ./web/src
COPY twin3d ./twin3d

# Character picker is baked in at build time and OFF unless requested (same switch as the operations portal)
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN cd twin3d && npm run build

FROM nginx:1.25-alpine
COPY twin3d/nginx.conf /etc/nginx/conf.d/default.conf
COPY twin3d/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder /app/twin3d/dist /usr/share/nginx/html/twin
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
