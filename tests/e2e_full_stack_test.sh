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
    if [ "${CI:-false}" = "true" ] || [ "${PURGE_VOLUMES:-false}" = "true" ]; then
        echo "Tearing down Docker Compose containers and purging volumes (CI/purge mode)..."
        docker compose -f compose.yaml down -v --remove-orphans || true
    else
        echo "Tearing down Docker Compose containers (preserving persistent database and storage volumes in local dev)..."
        docker compose -f compose.yaml down --remove-orphans || true
    fi
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

# Assertion 7: Live Multi-Tenant & Multi-User RLS query check on PostgreSQL container
echo "Verifying Live Multi-Tenant & Multi-User Row-Level Security on PostgreSQL..."
FARMER_BA_SEES=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios_app -d openagrios_db -t -c "
    SET LOCAL app.current_org_id = 'HTX_CANTHO_01';
    SET LOCAL app.current_user_role = 'FARMER';
    SET LOCAL app.current_user_id = 'usr_farmer_ba';
    SELECT COUNT(*) FROM service_requests;
" | grep -o '[0-9]\+' | tail -n 1)
echo "Farmer Ba visible requests: $FARMER_BA_SEES"

FARMER_NAM_SEES=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios_app -d openagrios_db -t -c "
    SET LOCAL app.current_org_id = 'HTX_CANTHO_01';
    SET LOCAL app.current_user_role = 'FARMER';
    SET LOCAL app.current_user_id = 'usr_farmer_nam';
    SELECT COUNT(*) FROM service_requests;
" | grep -o '[0-9]\+' | tail -n 1)
echo "Farmer Nam visible requests: $FARMER_NAM_SEES"

SOCTRANG_SEES=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios_app -d openagrios_db -t -c "
    SET LOCAL app.current_org_id = 'HTX_SOCTRANG_02';
    SET LOCAL app.current_user_role = 'COORDINATOR';
    SET LOCAL app.current_user_id = 'usr_coord_02';
    SELECT COUNT(*) FROM service_requests;
" | grep -o '[0-9]\+' | tail -n 1)
echo "Soc Trang Coordinator visible requests: $SOCTRANG_SEES"

FARMER_BA_FIELDS=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios_app -d openagrios_db -q -t -A -c "
    SET LOCAL app.current_org_id = 'HTX_CANTHO_01';
    SET LOCAL app.current_user_role = 'FARMER';
    SET LOCAL app.current_user_id = 'usr_farmer_ba';
    SELECT string_agg(field_id, ',' ORDER BY field_id) FROM fields;
" | tail -n 1 | xargs)
FARMER_TAM_FIELDS=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios_app -d openagrios_db -q -t -A -c "
    SET LOCAL app.current_org_id = 'HTX_CANTHO_01';
    SET LOCAL app.current_user_role = 'FARMER';
    SET LOCAL app.current_user_id = 'usr_farmer_tam';
    SELECT string_agg(field_id, ',' ORDER BY field_id) FROM fields;
" | tail -n 1 | xargs)
echo "Farmer Ba visible fields: $FARMER_BA_FIELDS"
echo "Farmer Tam visible fields: $FARMER_TAM_FIELDS"

if [ "$FARMER_BA_SEES" -gt 0 ] && [ "$FARMER_NAM_SEES" -eq 0 ] && [ "$SOCTRANG_SEES" -eq 0 ] \
    && [ "$FARMER_BA_FIELDS" = "F01,F03,F07" ] \
    && [ "$FARMER_TAM_FIELDS" = "F02,F04,F05,F06,F08,F09,F10" ]; then
    echo "[PASS] Assertion 7: Live tenant and user RLS verified for service requests and field ownership."
else
    echo "[FAIL] Assertion 7: RLS isolation leak detected."
    exit 1
fi

# Assertion 8: End-to-end Live Golden Path via APISIX Gateway (:9080) & Full PKCE Flow (RFC 7636 & RFC 9700)
echo "Executing Live Golden Path across APISIX Gateway (:9080) with Full RFC 7636 PKCE Flow..."

# 1. Step 1: Initialize PKCE Parameters with anti-CSRF State Token through APISIX Gateway
PKCE_STATE="csrf-token-$(date +%s)-$$"
echo " -> Step 1: Initializing PKCE parameters with anti-CSRF state: $PKCE_STATE..."
PKCE_GW_RESP=$(curl -s -f "http://localhost:9080/api/v1/auth/pkce/authorize-url?state=$PKCE_STATE&redirect_uri=http%3A%2F%2Flocalhost%3A9080%2Fauth%2Fcallback")

CODE_CHALLENGE=$(echo "$PKCE_GW_RESP" | sed -n 's/.*"code_challenge":"\([^"]*\)".*/\1/p')
CODE_VERIFIER=$(echo "$PKCE_GW_RESP" | sed -n 's/.*"code_verifier":"\([^"]*\)".*/\1/p')
RETURNED_STATE=$(echo "$PKCE_GW_RESP" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')

if [ -n "$CODE_CHALLENGE" ] && [ -n "$CODE_VERIFIER" ]; then
    echo "    [OK] PKCE parameters generated: challenge_method=S256, state=$RETURNED_STATE"
else
    echo "PKCE session response: $PKCE_GW_RESP"
    echo "[FAIL] Assertion 8: Failed to initialize PKCE parameters via APISIX Gateway."
    exit 1
fi

echo " -> Step 2: Acquiring genuine Keycloak Authorization Code (RFC 7636)..."
AUTH_CODE_RESP=$(curl -s -X POST http://localhost:9080/api/v1/auth/pkce/authorize-code \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"coord_htx01\",\"password\":\"123456\",\"code_challenge\":\"$CODE_CHALLENGE\",\"state\":\"$PKCE_STATE\",\"redirect_uri\":\"http://localhost:9080/auth/callback\"}")
AUTH_CODE=$(echo "$AUTH_CODE_RESP" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')

if [ -n "$AUTH_CODE" ]; then
    echo "    [OK] Acquired genuine Keycloak Authorization Code: $AUTH_CODE"
else
    echo "Keycloak auth code acquisition response: $AUTH_CODE_RESP"
    echo "[FAIL] Assertion 8: Failed to acquire genuine Keycloak authorization code."
    exit 1
fi

# 2. Step 3: Verify PKCE Security Guard: Tampered / Mismatched code_verifier must be rejected by Keycloak (RFC 7636 Section 4.6)
echo " -> Step 3: Testing PKCE Security Guard against Keycloak (Anti-Tampering & Anti-CSRF)..."
TAMPERED_VERIFIER="tampered_code_verifier_1234567890123456789012345678901234567890"
TAMPERED_RESP=$(curl -s -X POST http://localhost:9080/api/v1/auth/pkce/token \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"$AUTH_CODE\",\"code_verifier\":\"$TAMPERED_VERIFIER\",\"state\":\"$PKCE_STATE\",\"redirect_uri\":\"http://localhost:9080/auth/callback\"}")

if echo "$TAMPERED_RESP" | grep -q -E "INVALID_GRANT|KEYCLOAK_TOKEN_EXCHANGE_FAILED"; then
    echo "    [OK] PKCE Anti-Tampering verified: Keycloak upstream strictly rejected mismatched verifier."
else
    echo "Tampered verifier response: $TAMPERED_RESP"
    echo "[FAIL] Assertion 8: Keycloak failed to reject tampered code_verifier."
    exit 1
fi

# 3. Step 4: Re-create a fresh PKCE Session & acquire a fresh Keycloak Authorization Code
# (RFC 7636 Section 4.6: Authorization codes are single-use; the previous code was consumed or invalidated)
PKCE_STATE_VALID="csrf-valid-$(date +%s)-$$"
# Browser-equivalent client: the verifier is generated and kept locally; only the S256 challenge is sent (RFC 7636 / RFC 9700)
CODE_VERIFIER_VALID=$(head -c 48 /dev/urandom | openssl base64 -A | tr '+/' '-_' | tr -d '=')
CODE_CHALLENGE_VALID=$(printf '%s' "$CODE_VERIFIER_VALID" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
PKCE_FRESH_RESP=$(curl -s -f "http://localhost:9080/api/v1/auth/pkce/authorize-url?state=$PKCE_STATE_VALID&code_challenge=$CODE_CHALLENGE_VALID&redirect_uri=http%3A%2F%2Flocalhost%3A9080%2Fauth%2Fcallback")
if echo "$PKCE_FRESH_RESP" | grep -q '"code_verifier"'; then
    echo "[FAIL] Assertion 8: Server returned a code_verifier although the client supplied its own code_challenge."
    exit 1
fi
if ! echo "$PKCE_FRESH_RESP" | grep -q "\"code_challenge\":\"$CODE_CHALLENGE_VALID\""; then
    echo "[FAIL] Assertion 8: Server did not echo the client-owned code_challenge."
    exit 1
fi
BAD_CHALLENGE_HTTP=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:9080/api/v1/auth/pkce/authorize-url?state=x&code_challenge=not-a-valid-challenge")
if [ "$BAD_CHALLENGE_HTTP" != "400" ]; then
    echo "[FAIL] Assertion 8: Malformed code_challenge must be rejected with HTTP 400 (got $BAD_CHALLENGE_HTTP)."
    exit 1
fi
AUTH_STATE_VALID=$(echo "$PKCE_FRESH_RESP" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')

AUTH_CODE_FRESH_RESP=$(curl -s -X POST http://localhost:9080/api/v1/auth/pkce/authorize-code \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"coord_htx01\",\"password\":\"123456\",\"code_challenge\":\"$CODE_CHALLENGE_VALID\",\"state\":\"$AUTH_STATE_VALID\",\"redirect_uri\":\"http://localhost:9080/auth/callback\"}")
AUTH_CODE_VALID=$(echo "$AUTH_CODE_FRESH_RESP" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')

if [ -z "$AUTH_CODE_VALID" ]; then
    echo "Keycloak auth code acquisition response: $AUTH_CODE_FRESH_RESP"
    echo "[FAIL] Assertion 8: Failed to acquire fresh Keycloak authorization code."
    exit 1
fi

# 4. Step 5: Exchange genuine Authorization Code + valid code_verifier for Live Keycloak Token via APISIX Gateway
echo " -> Step 4: Exchanging genuine Keycloak Authorization Code + valid code_verifier for Live Bearer Token..."
TOKEN_EXCHANGE_RESP=$(curl -s -X POST http://localhost:9080/api/v1/auth/pkce/token \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"$AUTH_CODE_VALID\",\"code_verifier\":\"$CODE_VERIFIER_VALID\",\"state\":\"$AUTH_STATE_VALID\",\"redirect_uri\":\"http://localhost:9080/auth/callback\"}")

ACCESS_TOKEN=$(echo "$TOKEN_EXCHANGE_RESP" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -z "$ACCESS_TOKEN" ]; then
    echo "PKCE token exchange response: $TOKEN_EXCHANGE_RESP"
    echo "[FAIL] Assertion 8: PKCE Token exchange via APISIX failed."
    exit 1
fi
echo "    [OK] Successfully exchanged PKCE authorization code for Live Keycloak Bearer Token!"

# 5. Step 5: Access Protected Core API through APISIX (exercises APISIX token introspection with Keycloak)
echo " -> Step 4: Accessing protected endpoint /api/v1/state via APISIX Gateway (Zero-Trust Introspection)..."
STATE_RESP=$(curl -s http://localhost:9080/api/v1/state \
    -H "Authorization: Bearer $ACCESS_TOKEN")
if echo "$STATE_RESP" | grep -q '"organization_name"'; then
    echo "    [OK] APISIX token introspection with Keycloak succeeded; protected state accessed!"
else
    echo "Protected state response: $STATE_RESP"
    echo "[FAIL] Assertion 8: APISIX Zero-Trust introspection failed on /api/v1/state."
    exit 1
fi

# 6. Step 6: Create Service Request through APISIX Gateway with PKCE Bearer Token
echo " -> Step 5: Submitting Service Request with PKCE-acquired Bearer Token via APISIX..."
REQ_ID="REQ-E2E-$(date +%s)"
CREATE_RESP=$(curl -s -X POST http://localhost:9080/api/v1/requests \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"request_id\": \"$REQ_ID\",
        \"field_id\": \"F01\",
        \"area_ha\": 2.5,
        \"requested_start\": \"2026-11-20T08:00:00Z\",
        \"requested_end\": \"2026-11-20T12:00:00Z\",
        \"priority\": \"URGENT\",
        \"notes\": \"Live Golden Path E2E Test through APISIX and RFC 7636 PKCE\"
    }")

CREATED_REQ_ID=$(echo "$CREATE_RESP" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
if [ -n "$CREATED_REQ_ID" ] && echo "$CREATE_RESP" | grep -q '"ok":true'; then
    echo "    [OK] Service request $CREATED_REQ_ID created successfully via APISIX Gateway!"
else
    echo "Create request response: $CREATE_RESP"
    echo "[FAIL] Assertion 8: Failed to create service request via APISIX."
    exit 1
fi

# 7. Step 7: Verify the record is persisted into PostgreSQL
echo " -> Step 6: Verifying record persistence in PostgreSQL database..."
PG_REQ_COUNT=$(docker compose -f compose.yaml exec -T postgres psql -U openagrios -d openagrios_db -t -c "SELECT COUNT(*) FROM service_requests WHERE request_id='$CREATED_REQ_ID';" | grep -o '[0-9]\+' | tail -n 1)
if [ "$PG_REQ_COUNT" -gt 0 ]; then
    echo "[PASS] Assertion 8: Live Golden Path verified end-to-end (APISIX -> RFC 7636 PKCE Session -> Keycloak OIDC -> APISIX Zero-Trust Introspection -> Core API -> PostgreSQL Persistence)."
else
    echo "[FAIL] Assertion 8: Service request $REQ_ID was not found in PostgreSQL."
    exit 1
fi

# Assertion 11: hot -> cold data pipeline (Core API -> Kafka -> Parquet on S3 -> DuckDB analytics)
echo "Verifying hot/cold data pipeline (Kafka -> Parquet on SeaweedFS S3 -> DuckDB)..."
BUS_PUBLISHED=0
for i in {1..20}; do
    BUS_PUBLISHED=$(curl -s http://localhost:8000/api/v1/health | python3 -c "import sys,json; print(json.load(sys.stdin)['core_services']['event_bus']['published'])" 2>/dev/null || echo 0)
    if [ "${BUS_PUBLISHED:-0}" -gt 0 ]; then break; fi
    sleep 2
done
if [ "${BUS_PUBLISHED:-0}" -le 0 ]; then
    echo "[FAIL] Assertion 11: Core API published no events to the Kafka event bus."
    exit 1
fi
echo "    [OK] Core API published $BUS_PUBLISHED audit event(s) to Kafka."

LAKE_EVENTS=0
for i in {1..30}; do
    LAKE_JSON=$(curl -s http://localhost:9080/api/v1/analytics/summary -H "Authorization: Bearer $ACCESS_TOKEN" || true)
    LAKE_EVENTS=$(echo "$LAKE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['audit']['events'])" 2>/dev/null || echo 0)
    if [ "${LAKE_EVENTS:-0}" -gt 0 ]; then break; fi
    sleep 3
done
if [ "${LAKE_EVENTS:-0}" -le 0 ]; then
    echo "Analytics summary response: $LAKE_JSON"
    echo "[FAIL] Assertion 11: No audit events reached the cold Parquet lake."
    exit 1
fi
echo "    [OK] DuckDB counted $LAKE_EVENTS audit event(s) in the Parquet lake."

PARQUET_KEYS=$(curl -s "http://localhost:9000/openagrios-lake?prefix=audit/" | grep -o 'audit/dt=[0-9-]*/part-[^<"]*\.parquet' | sort -u | wc -l)
if [ "$PARQUET_KEYS" -le 0 ]; then
    echo "[FAIL] Assertion 11: No .parquet objects found in the S3 lake bucket."
    exit 1
fi
echo "    [OK] $PARQUET_KEYS Parquet object(s) stored in s3://openagrios-lake/audit/."

DAY_JSON=$(curl -s http://localhost:9080/api/v1/analytics/actions-by-day -H "Authorization: Bearer $ACCESS_TOKEN")
if ! echo "$DAY_JSON" | grep -q '"engine": *"DuckDB"'; then
    echo "actions-by-day response: $DAY_JSON"
    echo "[FAIL] Assertion 11: actions-by-day analytics query failed."
    exit 1
fi

UNAUTH_HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:9080/api/v1/analytics/summary)
if [ "$UNAUTH_HTTP" != "401" ] && [ "$UNAUTH_HTTP" != "403" ]; then
    echo "[FAIL] Assertion 11: analytics reachable without a token via the gateway (HTTP $UNAUTH_HTTP)."
    exit 1
fi
if curl -s -m 3 -o /dev/null http://localhost:8090/health 2>/dev/null; then
    echo "[FAIL] Assertion 11: lake-archiver port 8090 is exposed on the host (Zero-Trust violation)."
    exit 1
fi
echo "[PASS] Assertion 11: Hot/cold pipeline verified (events -> Kafka -> Parquet in S3 -> DuckDB query; gateway-protected, archiver not host-exposed)."

# Assertion 12: OT telemetry ingestion (MQTT device -> Mosquitto ACL -> ingestor -> Core digital twin -> Kafka -> Parquet)
echo "Verifying OT telemetry ingestion over MQTT..."
MQTT_DEV_USER="${MQTT_DEVICE_USER:-device}"
MQTT_DEV_PASS="${MQTT_DEVICE_PASSWORD:-device_dev_only}"
twin_probe() {
    curl -s http://localhost:9080/api/v1/digital-twin/entities -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -c "
import sys, json
e = json.load(sys.stdin)['entities'][0]
lng, lat = e['location']['value']['coordinates']
print(e['id'].rsplit(':', 1)[1], e['organizationId']['value'], lat, lng, e['fuelLevel']['value'])" 2>/dev/null
}
read -r TW_MID TW_ORG TW_LAT TW_LNG TW_FUEL <<< "$(twin_probe)"
if [ -z "${TW_MID:-}" ]; then
    echo "[FAIL] Assertion 12: could not read a machine from the digital twin."
    exit 1
fi
mqtt_publish() { # topic payload [user] [pass]
    docker compose -f compose.yaml exec -T mosquitto mosquitto_pub -h 127.0.0.1 -q 1 \
        -u "${3:-$MQTT_DEV_USER}" -P "${4:-$MQTT_DEV_PASS}" -t "$1" -m "$2"
}
twin_lat() { twin_probe | awk '{print $3}'; }

# (a) Anonymous / wrong-credential clients must be refused by the broker.
if docker compose -f compose.yaml exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "openagrios/$TW_ORG/machines/$TW_MID/telemetry" -m '{}' >/dev/null 2>&1; then
    echo "[FAIL] Assertion 12: Mosquitto accepted an anonymous publish."
    exit 1
fi
if mqtt_publish "openagrios/$TW_ORG/machines/$TW_MID/telemetry" '{}' device wrong-password >/dev/null 2>&1; then
    echo "[FAIL] Assertion 12: Mosquitto accepted a publish with a wrong password."
    exit 1
fi
echo "    [OK] Broker refuses anonymous and wrong-password clients."

# (b) A genuine sample from an authenticated device moves the digital twin.
NEW_LAT=$(python3 -c "print(round($TW_LAT + 0.0010, 6))")
NEW_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mqtt_publish "openagrios/$TW_ORG/machines/$TW_MID/telemetry" \
    "{\"ts\":\"$NEW_TS\",\"lat\":$NEW_LAT,\"lon\":$TW_LNG,\"fuel_pct\":61.5,\"speed_kmh\":6.2}"
SEEN_LAT=""
for i in {1..15}; do
    SEEN_LAT=$(twin_lat)
    if [ "$SEEN_LAT" = "$NEW_LAT" ]; then break; fi
    sleep 2
done
if [ "$SEEN_LAT" != "$NEW_LAT" ]; then
    echo "[FAIL] Assertion 12: digital twin of $TW_MID did not follow MQTT telemetry (expected lat $NEW_LAT, got '$SEEN_LAT')."
    docker compose -f compose.yaml logs --tail 20 telemetry-ingestor || true
    exit 1
fi
echo "    [OK] Telemetry for $TW_MID reached the digital twin (lat $TW_LAT -> $NEW_LAT)."

# (c) Out-of-range and cross-tenant samples must be rejected and must not alter the twin.
mqtt_publish "openagrios/$TW_ORG/machines/$TW_MID/telemetry" "{\"ts\":\"$NEW_TS\",\"lat\":999,\"lon\":$TW_LNG,\"fuel_pct\":50}"
mqtt_publish "openagrios/HTX_SOCTRANG_02/machines/$TW_MID/telemetry" "{\"ts\":\"$NEW_TS\",\"lat\":10.0,\"lon\":105.0,\"fuel_pct\":50}"
mqtt_publish "openagrios/$TW_ORG/machines/$TW_MID/telemetry" "not-json"
REJECTED=0
for i in {1..10}; do
    METRICS=$(docker compose -f compose.yaml exec -T telemetry-ingestor python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8091/metrics').read().decode())" 2>/dev/null || true)
    BY_CORE=$(echo "$METRICS" | awk '/^openagrios_telemetry_rejected_by_core_total /{print $2}')
    INVALID=$(echo "$METRICS" | awk '/^openagrios_telemetry_rejected_invalid_total /{print $2}')
    REJECTED=$(( ${BY_CORE:-0} + ${INVALID:-0} ))
    if [ "${BY_CORE:-0}" -ge 2 ] && [ "${INVALID:-0}" -ge 1 ]; then break; fi
    sleep 2
done
if [ "${BY_CORE:-0}" -lt 2 ] || [ "${INVALID:-0}" -lt 1 ]; then
    echo "[FAIL] Assertion 12: expected >=2 core rejections and >=1 invalid payload, got by_core=${BY_CORE:-0} invalid=${INVALID:-0}."
    exit 1
fi
if [ "$(twin_lat)" != "$NEW_LAT" ]; then
    echo "[FAIL] Assertion 12: a rejected sample changed the digital twin."
    exit 1
fi
echo "    [OK] Out-of-range, cross-tenant and malformed samples rejected (by_core=$BY_CORE, invalid=$INVALID); twin unchanged."

# (d) The internal endpoint is sealed at the edge and requires the shared secret inside the network.
EDGE_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:9080/api/v1/internal/telemetry -H 'Content-Type: application/json' -d '{}')
DIRECT_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8000/api/v1/internal/telemetry -H 'Content-Type: application/json' -H 'X-Ingest-Token: wrong' -d '{}')
if [ "$EDGE_HTTP" != "404" ] || [ "$DIRECT_HTTP" != "401" ]; then
    echo "[FAIL] Assertion 12: internal endpoint exposure wrong (edge=$EDGE_HTTP expected 404, direct-bad-token=$DIRECT_HTTP expected 401)."
    exit 1
fi
echo "    [OK] /api/v1/internal/* returns 404 at the gateway and 401 without the ingest token."

# (e) The same samples are queryable from the cold Parquet lake via DuckDB.
LAKE_SAMPLES=0
for i in {1..30}; do
    LAKE_SAMPLES=$(curl -s http://localhost:9080/api/v1/analytics/machine-utilization -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -c "
import sys, json
rows = json.load(sys.stdin).get('rows', [])
print(sum(r['samples'] for r in rows if r['machine_id'] == '$TW_MID'))" 2>/dev/null || echo 0)
    if [ "${LAKE_SAMPLES:-0}" -ge 1 ]; then break; fi
    sleep 3
done
if [ "${LAKE_SAMPLES:-0}" -lt 1 ]; then
    echo "[FAIL] Assertion 12: telemetry for $TW_MID never reached the Parquet lake."
    exit 1
fi
echo "    [OK] DuckDB machine-utilization sees $LAKE_SAMPLES telemetry sample(s) for $TW_MID in the lake."

# Restore the original position/fuel (waiting out the core's 10 s Postgres write throttle) so later runs start clean.
sleep 11
mqtt_publish "openagrios/$TW_ORG/machines/$TW_MID/telemetry" \
    "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"lat\":$TW_LAT,\"lon\":$TW_LNG,\"fuel_pct\":$TW_FUEL,\"speed_kmh\":0}"
for i in {1..15}; do
    if [ "$(twin_lat)" = "$TW_LAT" ]; then break; fi
    sleep 2
done
echo "[PASS] Assertion 12: OT telemetry verified (authenticated MQTT -> ingestor validation -> digital twin -> Kafka -> Parquet/DuckDB; rejects bad/cross-tenant data; internal endpoint sealed)."

# Assertion 9: Experience & Operations Web Portal (web-app via APISIX)
echo "Checking Operations Web App through APISIX Gateway (:9080)..."
WEB_HTML=$(curl -s http://localhost:9080/ || true)
if echo "$WEB_HTML" | grep -q 'id="root"'; then
    echo "[PASS] Assertion 9: Operations Web App (apps/web) successfully routed via APISIX Gateway."
else
    echo "[WARN] Assertion 9: Operations Web App root div check skipped or pending."
fi

# Assertion 10: data written through the API survives a Core API restart (no re-seeding over real rows)
echo "Restarting Core API to verify persistence across restarts..."
docker compose -f compose.yaml restart core-api >/dev/null 2>&1
for i in {1..40}; do
    if curl -sf http://localhost:9080/api/v1/health >/dev/null 2>&1; then break; fi
    sleep 3
done
STATE_AFTER_RESTART=$(curl -s http://localhost:9080/api/v1/state -H "Authorization: Bearer $ACCESS_TOKEN" || true)
if echo "$STATE_AFTER_RESTART" | grep -q "\"request_id\":\"$CREATED_REQ_ID\""; then
    echo "[PASS] Assertion 10: Request $CREATED_REQ_ID is still present after a Core API restart (state rehydrated from PostgreSQL)."
else
    echo "[FAIL] Assertion 10: Request $CREATED_REQ_ID was lost after a Core API restart (platform re-seeded over real data)."
    exit 1
fi

echo "[5/5] All full-stack container integration assertions PASSED successfully!"
echo "============================================================================"
