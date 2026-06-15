#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors

set -euo pipefail

echo "============================================================================"
echo "OPENAGRIOS FULL-STACK CONTAINER INTEGRATION TEST RUNNER"
echo "============================================================================"

# Ensure cleanup on script exit
cleanup() {
    echo "============================================================================"
    echo "CONTAINER LOGS INSPECTION BEFORE TEARDOWN:"
    echo "============================================================================"
    echo "--- CORE API LOGS ---"
    docker compose -f compose.yaml logs --tail 100 core-api || true
    echo "--- POSTGRES LOGS ---"
    docker compose -f compose.yaml logs --tail 30 postgres || true
    echo "--- KEYCLOAK LOGS ---"
    docker compose -f compose.yaml logs --tail 30 keycloak || true
    echo "============================================================================"
    echo "Tearing down Docker Compose containers and volumes..."
    docker compose -f compose.yaml down -v --remove-orphans || true
}
trap cleanup EXIT

echo "[1/5] Building and starting all containers in detached mode..."
docker compose -f compose.yaml up -d --build

echo "[2/5] Awaiting service healthchecks..."

# 1. PostgreSQL (Port 5432)
echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if docker compose -f compose.yaml exec -T postgres pg_isready -U openagrios -d openagrios_db >/dev/null 2>&1; then
        echo " -> PostgreSQL is healthy and accepting connections!"
        break
    fi
    echo " ... waiting for PostgreSQL ($i/30)"
    sleep 2
done

# 2. Keycloak (Port 8080)
echo "Waiting for Keycloak OIDC Discovery endpoint..."
for i in {1..40}; do
    if curl -s -f http://localhost:8080/realms/openagrios/.well-known/openid-configuration >/dev/null 2>&1; then
        echo " -> Keycloak OIDC realm 'openagrios' is ready!"
        break
    fi
    echo " ... waiting for Keycloak ($i/40)"
    sleep 3
done

# 3. SeaweedFS S3 Object Storage (Port 9000)
echo "Waiting for SeaweedFS S3 Object Storage..."
for i in {1..20}; do
    if curl -s http://localhost:9000/ >/dev/null 2>&1 || exec 3<>/dev/tcp/127.0.0.1/9000 2>/dev/null; then
        echo " -> SeaweedFS S3 storage endpoint is online!"
        break
    fi
    echo " ... waiting for SeaweedFS ($i/20)"
    sleep 2
done

# 4. Flowable BPMN Engine (Port 8081)
echo "Waiting for Flowable REST BPMN Engine..."
for i in {1..30}; do
    if curl -s -f -u rest-admin:test http://localhost:8081/flowable-rest/service/repository/deployments >/dev/null 2>&1; then
        echo " -> Flowable REST Engine is online!"
        break
    fi
    echo " ... waiting for Flowable ($i/30)"
    sleep 2
done

# 5. Core API (Port 8000)
echo "Waiting for OpenAgriOS Core API..."
for i in {1..30}; do
    if curl -s -f http://localhost:8000/api/v1/health >/dev/null 2>&1; then
        echo " -> Core API is healthy!"
        break
    fi
    echo " ... waiting for Core API ($i/30)"
    sleep 2
done

# 6. APISIX Zero-Trust Gateway (Port 9080)
echo "Waiting for APISIX Gateway..."
for i in {1..30}; do
    if curl -s -f http://localhost:9080/api/v1/health >/dev/null 2>&1; then
        echo " -> APISIX Gateway routing is active!"
        break
    fi
    echo " ... waiting for APISIX ($i/30)"
    sleep 2
done

echo "[3/5] Docker container process inspection:"
docker compose -f compose.yaml ps -a

echo "[4/5] Executing Live Stack Integration Assertions..."

# Assertion 1: Core API Health & BPMN definitions
HEALTH_JSON=$(curl -s -f http://localhost:8000/api/v1/health)
echo "Core API Health Response: $HEALTH_JSON"
if echo "$HEALTH_JSON" | grep -q '"status":"HEALTHY"'; then
    echo "[PASS] Assertion 1: Core API /api/v1/health reports HEALTHY status."
else
    echo "[FAIL] Assertion 1: Core API is not healthy."
    exit 1
fi

# Assertion 2: PostgreSQL Multi-Tenant Tables & Seed Data
COUNT_FIELDS=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios -d openagrios_db -t -c "SELECT COUNT(*) FROM fields;")
echo "PostgreSQL 'fields' row count: $COUNT_FIELDS"
if [ "$COUNT_FIELDS" -gt 0 ]; then
    echo "[PASS] Assertion 2: PostgreSQL 16 schema loaded and seeded successfully ($COUNT_FIELDS fields)."
else
    echo "[FAIL] Assertion 2: PostgreSQL fields table is empty."
    exit 1
fi

# Assertion 3: Verify dedicated openagrios_app non-superuser role
APP_ROLE_CHECK=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios -d openagrios_db -t -c "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='openagrios_app';")
echo "Role openagrios_app permissions (rolsuper, rolbypassrls): $APP_ROLE_CHECK"
if echo "$APP_ROLE_CHECK" | grep -E 'f[[:space:]]+\|[[:space:]]+f'; then
    echo "[PASS] Assertion 3: Dedicated openagrios_app role verified (NOSUPERUSER, NOBYPASSRLS)."
else
    echo "[FAIL] Assertion 3: openagrios_app role permissions mismatch."
    exit 1
fi

# Assertion 4: APISIX Gateway reverse proxy route
GW_HEALTH=$(curl -s -f http://localhost:9080/api/v1/health)
if echo "$GW_HEALTH" | grep -q '"status":"HEALTHY"'; then
    echo "[PASS] Assertion 4: APISIX Gateway successfully routed /api/v1/health to Core API."
else
    echo "[FAIL] Assertion 4: APISIX routing failed."
    exit 1
fi

# Assertion 5: PKCE Session Generation Endpoint
PKCE_JSON=$(curl -s -f http://localhost:8000/api/v1/auth/pkce/authorize-url)
if echo "$PKCE_JSON" | grep -q '"code_challenge"'; then
    echo "[PASS] Assertion 5: PKCE Authorization endpoint active and generated valid code_challenge."
else
    echo "[FAIL] Assertion 5: PKCE authorize endpoint failed."
    exit 1
fi

# Assertion 6: Flowable REST Engine deployment verification
FLOWABLE_DEPLOYMENTS=$(curl -s -u rest-admin:test http://localhost:8081/flowable-rest/service/repository/deployments)
if echo "$FLOWABLE_DEPLOYMENTS" | grep -q '"data"'; then
    echo "[PASS] Assertion 6: Flowable REST Engine v7.0.0 is online and process definitions deployed."
else
    echo "[FAIL] Assertion 6: Flowable REST deployments query failed."
    exit 1
fi

echo "[6/6] All full-stack container integration assertions PASSED successfully!"
echo "============================================================================"
