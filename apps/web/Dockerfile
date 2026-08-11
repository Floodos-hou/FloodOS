# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors

# Stage 1: Build Frontend Assets
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./
RUN npm ci --fetch-retries=5 --fetch-timeout=120000

# Copy application source
COPY . .

# Demo mode (character picker + storyline) is baked in at build time and OFF unless requested
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE

# Build production bundle
RUN npm run build

# Stage 2: Serve via Nginx (Permissive Open-Source 2-Clause BSD-like)
FROM nginx:1.25-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
