#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors
#
# Full-stack integration test of FloodOS (core platform + flood-response application) on the REAL Docker stack:
# APISIX -> Keycloak (PKCE) -> Core API -> PostgreSQL (row-level security) -> Flowable -> SeaweedFS -> ClamAV
# -> Mosquitto/ingestor -> Kafka -> Parquet/DuckDB. Nothing is mocked.
set -euo pipefail

echo "============================================================================"
echo "FLOODOS / HANOI FLOODOS - FULL-STACK CONTAINER INTEGRATION TEST RUNNER"
echo "============================================================================"

DC="docker compose -f compose.yaml"
GW="http://localhost:9080"
REDIRECT_ENC="http%3A%2F%2Flocalhost%3A9080%2Fauth%2Fcallback"
REDIRECT="http://localhost:9080/auth/callback"
PASSWORD="123456"   # development password of the demo realm (infra/keycloak/floodos-realm.json)

cleanup() {
    echo "============================================================================"
    echo "CONTAINER LOGS INSPECTION BEFORE TEARDOWN:"
    echo "============================================================================"
    echo "--- CORE API LOGS ---";   $DC logs --tail 60 core-api || true
    echo "--- POSTGRES LOGS ---";   $DC logs --tail 20 postgres || true
    echo "--- KEYCLOAK LOGS ---";   $DC logs --tail 20 keycloak || true
    echo "============================================================================"
    if [ "${CI:-false}" = "true" ] || [ "${PURGE_VOLUMES:-false}" = "true" ]; then
        echo "Tearing down containers and purging volumes (CI/purge mode)..."
        $DC down -v --remove-orphans || true
    else
        echo "Tearing down containers (persistent database and storage volumes are preserved)..."
        $DC down --remove-orphans || true
    fi
}
trap cleanup EXIT

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }
expect() { # description actual expected
    if [ "$2" = "$3" ]; then echo "    [OK] $1"; else echo "    got '$2' but expected '$3'"; fail "$1"; fi
}
psql_q() { $DC exec -T postgres psql -U floodos -d floodos_db -At -c "$1" | tr -d '\r'; }
# Runs SQL as the NON-superuser application role with an explicit RLS session (what the core API does per request).
rls() { # org role user sql
    $DC exec -T postgres psql -U floodos_app -d floodos_db -q -t -A \
        -c "SET LOCAL app.current_org_id='$1'; SET LOCAL app.current_user_role='$2'; SET LOCAL app.current_user_id='$3'; $4" | tail -n 1 | tr -d '\r' | xargs
}
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
# gateway call: prints the HTTP status; the body is left in /tmp/e2e_body
gw() { # method path token [json]
    curl -s -m 60 -o /tmp/e2e_body -w '%{http_code}' -X "$1" "$GW/api/v1$2" \
        -H "Authorization: Bearer $3" -H 'Content-Type: application/json' ${4:+-d "$4"}
}
body() { cat /tmp/e2e_body; }

pkce_login() { # username -> access token on stdout (client-owned verifier, S256, anti-CSRF state)
    local user="$1" verifier challenge state resp astate code tok
    verifier=$(head -c 48 /dev/urandom | openssl base64 -A | tr '+/' '-_' | tr -d '=')
    challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
    state="st-$(date +%s)-$RANDOM"
    resp=$(curl -s -f "$GW/api/v1/auth/pkce/authorize-url?state=$state&code_challenge=$challenge&redirect_uri=$REDIRECT_ENC")
    astate=$(echo "$resp" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')
    code=$(curl -s -X POST "$GW/api/v1/auth/pkce/authorize-code" -H 'Content-Type: application/json' \
        -d "{\"username\":\"$user\",\"password\":\"$PASSWORD\",\"code_challenge\":\"$challenge\",\"state\":\"$astate\",\"redirect_uri\":\"$REDIRECT\"}" \
        | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
    [ -n "$code" ] || return 1
    tok=$(curl -s -X POST "$GW/api/v1/auth/pkce/token" -H 'Content-Type: application/json' \
        -d "{\"code\":\"$code\",\"code_verifier\":\"$verifier\",\"state\":\"$astate\",\"redirect_uri\":\"$REDIRECT\"}" \
        | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
    [ -n "$tok" ] || return 1
    echo "$tok"
}

# The demo device simulator (profile "demo") keeps moving vehicles; the telemetry assertions need a quiet twin.
$DC --profile demo rm -sf device-simulator >/dev/null 2>&1 || true
echo "[1/5] Building and starting all containers in detached mode..."
$DC up -d --build

echo "[2/5] Awaiting service healthchecks..."
wait_for() { # description tries command...
    local what="$1" tries="$2"; shift 2
    for i in $(seq 1 "$tries"); do
        if "$@" >/dev/null 2>&1; then echo " -> $what is ready"; return 0; fi
        echo " ... waiting for $what ($i/$tries)"; sleep 3
    done
    fail "$what never became ready"
}
wait_for "PostgreSQL" 30 $DC exec -T postgres pg_isready -U floodos -d floodos_db
wait_for "Keycloak realm" 60 curl -sf http://localhost:8080/realms/floodos/.well-known/openid-configuration
wait_for "Flowable REST" 40 curl -sf -u rest-admin:test http://localhost:8081/flowable-rest/service/repository/deployments
wait_for "Core API" 60 curl -sf http://localhost:8000/api/v1/health
wait_for "APISIX gateway" 40 curl -sf "$GW/api/v1/health"

# A Keycloak container created before the FloodOS realm existed still holds the old realm (it is imported at first start
# only): detect that and recreate the identity-bound services so the run needs no manual step.
if ! pkce_login reporter_lan >/dev/null 2>&1; then
    echo "Keycloak has no FloodOS users yet: recreating keycloak, core-api and apisix so the realm is re-imported..."
    $DC up -d --force-recreate keycloak core-api apisix >/dev/null
    wait_for "Keycloak realm" 60 curl -sf http://localhost:8080/realms/floodos/.well-known/openid-configuration
    wait_for "Core API" 60 curl -sf http://localhost:8000/api/v1/health
    wait_for "APISIX gateway" 40 curl -sf "$GW/api/v1/health"
fi

echo "[3/5] Docker container process inspection:"
$DC ps -a

echo "[4/5] Executing Live Stack Integration Assertions..."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 1: platform health, registered roles, BPMN definitions from infra/bpmn
HEALTH=$(curl -s -f http://localhost:8000/api/v1/health)
echo "$HEALTH" | grep -q '"status":"HEALTHY"' || fail "Assertion 1: Core API is not healthy."
expect "roles are registered by the application" "$(echo "$HEALTH" | jget "','.join(d['registered_roles'])")" "PLATFORM_ADMIN,DISPATCHER,RESOURCE_MANAGER,FIELD_TEAM,REPORTER"
echo "$HEALTH" | grep -q 'flood_report_lifecycle' || fail "Assertion 1: flood_report_lifecycle BPMN not loaded."
echo "$HEALTH" | grep -q 'dispatch_replan' || fail "Assertion 1: dispatch_replan BPMN not loaded."
pass "Assertion 1: Core API HEALTHY; roles registered by the application; both BPMN processes loaded."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 2: one schema file, applied idempotently, on top of whatever the volume already holds
for t in organizations users audit_records flood_zones flood_reports rescue_teams rescue_vehicles dispatch_orders field_incidents report_resolutions safe_shelters gauge_stations; do
    expect "table $t exists" "$(psql_q "SELECT to_regclass('public.$t') IS NOT NULL;")" "t"
done
SCHEMA_RUNS=0
for run in 1 2; do
    # MSYS_NO_PATHCONV keeps Git-Bash on Windows from rewriting the container path
    MSYS_NO_PATHCONV=1 $DC exec -T postgres psql -v ON_ERROR_STOP=1 -q -U floodos -d floodos_db -f /docker-entrypoint-initdb.d/02-schema.sql >/dev/null 2>&1 && SCHEMA_RUNS=$((SCHEMA_RUNS + 1))
done
expect "schema.sql re-applies cleanly twice (idempotent migration)" "$SCHEMA_RUNS" "2"
for t in flood_zones flood_reports rescue_teams rescue_vehicles dispatch_orders field_incidents report_resolutions safe_shelters gauge_stations audit_records; do
    expect "row-level security is enabled and FORCED on $t" "$(psql_q "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname='$t';")" "t"
done
expect "the application role is not a superuser and cannot bypass RLS" "$(psql_q "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='floodos_app';")" "f"
pass "Assertion 2: single-source schema verified (all tables, idempotent re-apply, RLS forced, least-privilege app role)."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 3: the identity flow (RFC 7636 PKCE through the gateway against the real Keycloak)
V=$(head -c 48 /dev/urandom | openssl base64 -A | tr '+/' '-_' | tr -d '=')
C=$(printf '%s' "$V" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
AU=$(curl -s -f "$GW/api/v1/auth/pkce/authorize-url?state=s1&code_challenge=$C&redirect_uri=$REDIRECT_ENC")
echo "$AU" | grep -q '"code_verifier"' && fail "Assertion 3: the server returned a code_verifier although the client owns it."
expect "a malformed code_challenge is refused" "$(curl -s -o /dev/null -w '%{http_code}' "$GW/api/v1/auth/pkce/authorize-url?state=x&code_challenge=nope")" "400"
CODE=$(curl -s -X POST "$GW/api/v1/auth/pkce/authorize-code" -H 'Content-Type: application/json' \
    -d "{\"username\":\"reporter_lan\",\"password\":\"$PASSWORD\",\"code_challenge\":\"$C\",\"state\":\"s1\",\"redirect_uri\":\"$REDIRECT\"}" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
[ -n "$CODE" ] || fail "Assertion 3: Keycloak issued no authorization code."
BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/auth/pkce/token" -H 'Content-Type: application/json' \
    -d "{\"code\":\"$CODE\",\"code_verifier\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\",\"state\":\"s1\",\"redirect_uri\":\"$REDIRECT\"}")
[ "$BAD" != "200" ] || fail "Assertion 3: a tampered code_verifier was accepted."
echo "    [OK] a tampered code_verifier is rejected ($BAD)"
expect "wrong password gets no authorization code" "$(curl -s -X POST "$GW/api/v1/auth/pkce/authorize-code" -H 'Content-Type: application/json' \
    -d "{\"username\":\"reporter_lan\",\"password\":\"wrong\",\"code_challenge\":\"$C\",\"state\":\"s1\",\"redirect_uri\":\"$REDIRECT\"}" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')" ""
expect "a former rice-harvest account no longer exists in the realm" "$(curl -s -X POST "$GW/api/v1/auth/pkce/authorize-code" -H 'Content-Type: application/json' \
    -d "{\"username\":\"farmer_ba\",\"password\":\"$PASSWORD\",\"code_challenge\":\"$C\",\"state\":\"s1\",\"redirect_uri\":\"$REDIRECT\"}" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')" ""
expect "the gateway refuses protected calls without a token" "$(curl -s -o /dev/null -w '%{http_code}' "$GW/api/v1/state")" "401"
T_ADMIN=$(pkce_login platform_admin) || fail "Assertion 3: platform_admin could not sign in."
T_LAN=$(pkce_login reporter_lan) || fail "Assertion 3: reporter_lan could not sign in."
T_HUNG=$(pkce_login reporter_hung) || fail "Assertion 3: reporter_hung could not sign in."
T_HOA=$(pkce_login dispatcher_hoa) || fail "Assertion 3: dispatcher_hoa could not sign in."
T_BINH=$(pkce_login team_binh) || fail "Assertion 3: team_binh could not sign in."
T_CUONG=$(pkce_login team_cuong) || fail "Assertion 3: team_cuong could not sign in."
T_DUNG=$(pkce_login team_dung) || fail "Assertion 3: team_dung could not sign in."
T_GIANG=$(pkce_login resource_giang) || fail "Assertion 3: resource_giang could not sign in."
T_MAI=$(pkce_login reporter_mai) || fail "Assertion 3: reporter_mai could not sign in."
T_TUAN=$(pkce_login dispatcher_tuan) || fail "Assertion 3: dispatcher_tuan could not sign in."
pass "Assertion 3: PKCE flow verified against real Keycloak (tampering and bad credentials refused; 10 demo identities signed in)."

# Start every run from the documented seed (the reset endpoint is open only to PLATFORM_ADMIN and only in development).
expect "a dispatcher may not reset the demo data" "$(gw POST /sim/reset "$T_HOA" '{}')" "403"
expect "the platform admin resets the demo data" "$(gw POST /sim/reset "$T_ADMIN" '{}')" "200"

# ---------------------------------------------------------------------------------------------------------------
# Assertion 4: row-level security enforced by PostgreSQL itself, per role, as the non-superuser application role
SEES_LAN=$(rls ORG_HN_PILOT_01 REPORTER usr_reporter_lan "SELECT string_agg(report_id, ',' ORDER BY report_id) FROM flood_reports;")
SEES_HUNG=$(rls ORG_HN_PILOT_01 REPORTER usr_reporter_hung "SELECT string_agg(report_id, ',' ORDER BY report_id) FROM flood_reports;")
expect "reporter_lan sees only FR-0001 and FR-0003" "$SEES_LAN" "FR-0001,FR-0003"
expect "reporter_hung sees only FR-0002 and FR-0004" "$SEES_HUNG" "FR-0002,FR-0004"
expect "reporter_lan sees only the zone of their own reports" "$(rls ORG_HN_PILOT_01 REPORTER usr_reporter_lan "SELECT string_agg(zone_id, ',' ORDER BY zone_id) FROM flood_zones;")" "Z01"
expect "reporter_lan sees only the vehicle serving them" "$(rls ORG_HN_PILOT_01 REPORTER usr_reporter_lan "SELECT string_agg(vehicle_id, ',' ORDER BY vehicle_id) FROM rescue_vehicles;")" "V01"
expect "a reporter sees no team and no incident" "$(rls ORG_HN_PILOT_01 REPORTER usr_reporter_lan "SELECT (SELECT count(*) FROM rescue_teams) + (SELECT count(*) FROM field_incidents);")" "0"
expect "the dispatcher sees all four reports of the tenant" "$(rls ORG_HN_PILOT_01 DISPATCHER usr_dispatcher_hoa "SELECT count(*) FROM flood_reports WHERE report_id IN ('FR-0001','FR-0002','FR-0003','FR-0004');")" "4"
expect "the dispatcher never sees another tenant's report" "$(rls ORG_HN_PILOT_01 DISPATCHER usr_dispatcher_hoa "SELECT count(*) FROM flood_reports WHERE report_id='FR-0091';")" "0"
expect "the other tenant sees only its own report" "$(rls ORG_HN_PILOT_02 DISPATCHER usr_dispatcher_tuan "SELECT string_agg(report_id, ',' ORDER BY report_id) FROM flood_reports;")" "FR-0091"
expect "a field team sees only the report behind its own order" "$(rls ORG_HN_PILOT_01 FIELD_TEAM usr_team_binh "SELECT string_agg(report_id, ',' ORDER BY report_id) FROM flood_reports;")" "FR-0001"
expect "a field team without orders sees no report" "$(rls ORG_HN_PILOT_01 FIELD_TEAM usr_team_dung "SELECT count(*) FROM flood_reports;")" "0"
expect "the resource manager sees the fleet but no citizen report" "$(rls ORG_HN_PILOT_01 RESOURCE_MANAGER usr_resource_giang "SELECT (SELECT count(*) FROM flood_reports)::text || '/' || (SELECT count(*) FROM rescue_vehicles WHERE organization_id='ORG_HN_PILOT_01');")" "0/5"
expect "an unknown role sees nothing (deny by default)" "$(rls ORG_HN_PILOT_01 BOGUS usr_reporter_lan "SELECT count(*) FROM flood_reports;")" "0"
expect "an empty session sees nothing (deny by default)" "$(rls '' '' '' "SELECT count(*) FROM flood_reports;")" "0"
INSERT_OUT=$($DC exec -T postgres psql -U floodos_app -d floodos_db -q -t -A -c "SET LOCAL app.current_org_id='ORG_HN_PILOT_01'; SET LOCAL app.current_user_role='REPORTER'; SET LOCAL app.current_user_id='usr_reporter_hung'; INSERT INTO flood_reports(report_id,organization_id,zone_id,reporter_user_id,lat,lng,depth_cm,need_type,correlation_id) VALUES ('FR-E2E-FAKE','ORG_HN_PILOT_01','Z01','usr_reporter_lan',20.9,105.8,10,'PUMPING','c');" 2>&1 || true)
echo "$INSERT_OUT" | grep -qi "row-level security" || fail "Assertion 4: a reporter could write a report in someone else's name (got: $INSERT_OUT)."
echo "    [OK] a reporter cannot insert a report owned by another user (row-level security rejects it)"
OVERLAP_OUT=$($DC exec -T postgres psql -U floodos -d floodos_db -q -t -A -c "INSERT INTO dispatch_orders(order_id,organization_id,report_id,reporter_user_id,zone_id,vehicle_id,team_id,start_time,end_time,correlation_id,created_by) VALUES ('ORD-E2E-CLASH','ORG_HN_PILOT_01','FR-0001','usr_reporter_lan','Z01','V01','T03',now(),now()+interval '1 hour','c','usr_dispatcher_hoa');" 2>&1 || true)
echo "$OVERLAP_OUT" | grep -qi "exclusion constraint" || fail "Assertion 4: the database let two active orders share vehicle V01 (got: $OVERLAP_OUT)."
echo "    [OK] the database itself refuses a double-booked vehicle (GiST exclusion constraint)"
pass "Assertion 4: PostgreSQL row-level security and exclusion constraints verified per role, tenant and session."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 5: Flowable runs the processes from infra/bpmn
for KEY in flood_report_lifecycle dispatch_replan_workflow; do
    DEFS=$(curl -s -u rest-admin:test "http://localhost:8081/flowable-rest/service/repository/process-definitions?key=$KEY&latest=true")
    [ "$(echo "$DEFS" | jget "d['total']")" -ge 1 ] || { echo "$DEFS" | cut -c1-300; fail "Assertion 5: $KEY is not deployed in Flowable."; }
    echo "    [OK] Flowable holds the definition $KEY (latest version $(echo "$DEFS" | jget "d['data'][0]['version']"))"
done
# the definitions are deployed once per distinct file content, not once per restart
CONTENT_DEPLOYMENTS=$(curl -s -u rest-admin:test "http://localhost:8081/flowable-rest/service/repository/deployments?size=200&name=flood_report_lifecycle-$(sha256sum infra/bpmn/flood_report_lifecycle.bpmn20.xml | cut -c1-12)" | jget "d['total']" || echo 0)
[ "${CONTENT_DEPLOYMENTS:-0}" -ge 1 ] || fail "Assertion 5: no deployment named after the file content hash exists in Flowable."
echo "    [OK] $CONTENT_DEPLOYMENTS deployment(s) named after the file content hash (checked again after the core restart)"
INSTANCES=$(curl -s -u rest-admin:test "http://localhost:8081/flowable-rest/service/runtime/process-instances?processDefinitionKey=flood_report_lifecycle" | jget "d['total']")
[ "${INSTANCES:-0}" -ge 1 ] || fail "Assertion 5: no flood_report_lifecycle instance is running in Flowable."
pass "Assertion 5: Flowable REST has the FloodOS process definitions and live instances ($INSTANCES running)."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 6: the golden path through the gateway, one real identity per role
echo "Executing the FloodOS golden path across APISIX with real Keycloak tokens..."
expect "reporter_lan state is scoped" "$(gw GET /state "$T_LAN")" "200"
S_LAN=$(body)
echo "$S_LAN" | grep -q '"organization_name"' || fail "Assertion 6: protected state did not arrive through APISIX introspection."
echo "$S_LAN" | grep -q 'FR-0002' && fail "Assertion 6: another resident's report leaked into reporter_lan's payload."
echo "$S_LAN" | grep -q 'FR-0091' && fail "Assertion 6: another tenant's report leaked into reporter_lan's payload."
echo "    [OK] the resident's payload holds only their own reports"
echo "$S_LAN" | grep -q 'MÔ PHỎNG' || fail "Assertion 6: the state does not declare that the demo data is simulated."

DAY=$(date -u -d "2040-01-01 +$((RANDOM % 3000)) days" +%Y-%m-%d)
W_START="${DAY}T08:00:00Z"; W_END="${DAY}T10:00:00Z"; W_MID_S="${DAY}T09:00:00Z"; W_MID_E="${DAY}T11:00:00Z"

expect "a resident files a flood report" "$(gw POST /flood-reports "$T_LAN" '{"lat":20.9665,"lng":105.8712,"depth_cm":55,"need_type":"EVACUATION","people_affected":5,"description":"E2E: nước vào nhà"}')" "201"
REPORT=$(body | jget "d['report_id']")
expect "the server matched the zone by straight-line distance" "$(body | jget "d['zone_match']")" "NEAREST_ZONE_CENTER_STRAIGHT_LINE"
expect "a resident cannot verify" "$(gw POST "/flood-reports/$REPORT/verify" "$T_LAN" '{"decision":"VERIFIED","priority":"HIGH"}')" "403"
expect "a resident cannot dispatch" "$(gw POST /dispatch-orders "$T_LAN" '{}')" "403"
expect "the resource manager cannot verify" "$(gw POST "/flood-reports/$REPORT/verify" "$T_GIANG" '{"decision":"VERIFIED","priority":"HIGH"}')" "403"
expect "dispatching before verification is refused" "$(gw POST /dispatch-orders "$T_HOA" "{\"report_id\":\"$REPORT\",\"vehicle_id\":\"V02\",\"team_id\":\"T02\",\"start_time\":\"$W_START\",\"end_time\":\"$W_END\"}")" "409"
expect "the other tenant's dispatcher cannot even see the report" "$(gw POST "/flood-reports/$REPORT/verify" "$T_TUAN" '{"decision":"VERIFIED","priority":"HIGH"}')" "404"
expect "the dispatcher verifies and prioritises" "$(gw POST "/flood-reports/$REPORT/verify" "$T_HOA" '{"decision":"VERIFIED","priority":"URGENT","note":"đã gọi xác nhận"}')" "200"
expect "the dispatcher dispatches boat V02 with team T02" "$(gw POST /dispatch-orders "$T_HOA" "{\"report_id\":\"$REPORT\",\"vehicle_id\":\"V02\",\"team_id\":\"T02\",\"start_time\":\"$W_START\",\"end_time\":\"$W_END\"}")" "201"
ORDER=$(body | jget "d['order_id']")

REPORT2=$(gw POST /flood-reports "$T_HUNG" '{"lat":20.9665,"lng":105.8712,"depth_cm":40,"need_type":"EVACUATION"}' >/dev/null; body | jget "d['report_id']")
gw POST "/flood-reports/$REPORT2/verify" "$T_HOA" '{"decision":"VERIFIED","priority":"HIGH"}' >/dev/null
expect "double booking of the vehicle is blocked" "$(gw POST /dispatch-orders "$T_HOA" "{\"report_id\":\"$REPORT2\",\"vehicle_id\":\"V02\",\"team_id\":\"T03\",\"start_time\":\"$W_MID_S\",\"end_time\":\"$W_MID_E\"}")" "409"
expect "  with the conflict code" "$(body | jget "d['error']")" "RESOURCE_TIME_OVERLAP"
expect "double booking of the team is blocked" "$(gw POST /dispatch-orders "$T_HOA" "{\"report_id\":\"$REPORT2\",\"vehicle_id\":\"V01\",\"team_id\":\"T02\",\"start_time\":\"$W_MID_S\",\"end_time\":\"$W_MID_E\"}")" "409"
expect "  with the conflict code" "$(body | jget "d['error']")" "HOLDER_TIME_OVERLAP"
expect "a vehicle in maintenance cannot be booked" "$(gw POST /dispatch-orders "$T_HOA" "{\"report_id\":\"$REPORT2\",\"vehicle_id\":\"V05\",\"team_id\":\"T03\",\"start_time\":\"$W_START\",\"end_time\":\"$W_END\"}")" "409"
expect "a pump cannot be sent to evacuate people" "$(gw POST /dispatch-orders "$T_HOA" "{\"report_id\":\"$REPORT2\",\"vehicle_id\":\"V04\",\"team_id\":\"T03\",\"start_time\":\"$W_START\",\"end_time\":\"$W_END\"}")" "422"

expect "another team cannot see the order (404)" "$(gw POST "/dispatch-orders/$ORDER/status" "$T_DUNG" '{"status":"IN_PROGRESS","progress_pct":10}')" "404"
expect "the right team starts the order" "$(gw POST "/dispatch-orders/$ORDER/status" "$T_CUONG" '{"status":"IN_PROGRESS","progress_pct":20}')" "200"
expect "progress cannot go backwards" "$(gw POST "/dispatch-orders/$ORDER/status" "$T_CUONG" '{"status":"IN_PROGRESS","progress_pct":5,"note":"x"}')" "409"

expect "the field team reports a breakdown of V02" "$(gw POST /field-incidents "$T_CUONG" '{"vehicle_id":"V02","severity":"CRITICAL","incident_type":"PROPELLER_FOULED","description":"E2E vướng rác","estimated_downtime_hours":4}')" "201"
INC=$(body | jget "d['incident_id']")
OPT=$(body | jget "d['candidate_options'][0]['option_id']")
OPT_KIND=$(body | jget "d['candidate_options'][0]['distance_kind']")
OPT_VEH=$(body | jget "d['candidate_options'][0]['vehicle_id']")
expect "the ranking declares straight-line distance" "$OPT_KIND" "STRAIGHT_LINE_HAVERSINE"
[ "$OPT_VEH" != "V02" ] || fail "Assertion 6: the broken vehicle was offered as its own replacement."
expect "the field team cannot approve a re-plan" "$(gw POST "/field-incidents/$INC/approve-replan" "$T_CUONG" "{\"option_id\":\"$OPT\"}")" "403"
expect "approval needs an explicit option (no auto-dispatch)" "$(gw POST "/field-incidents/$INC/approve-replan" "$T_HOA" '{}')" "400"
expect "the dispatcher approves the replacement" "$(gw POST "/field-incidents/$INC/approve-replan" "$T_HOA" "{\"option_id\":\"$OPT\"}")" "200"
NEW_ORDER=$(body | jget "d['new_order_id']")
expect "the replacement keeps the case lineage (-R1)" "${NEW_ORDER##*-}" "R1"
expect "a field team cannot touch the repair ticket" "$(gw POST "/field-incidents/$INC/repair-ticket" "$T_DUNG" '{"diagnosis":"x"}')" "403"
expect "the resource manager closes the repair ticket" "$(gw POST "/field-incidents/$INC/repair-ticket" "$T_GIANG" '{"diagnosis":"đã gỡ rác, thay chân vịt","is_resolved":true}')" "200"

NEW_TEAM=$(psql_q "SELECT team_id FROM dispatch_orders WHERE order_id='$NEW_ORDER';")
case "$NEW_TEAM" in T01) T_NEW="$T_BINH";; T02) T_NEW="$T_CUONG";; *) T_NEW="$T_DUNG";; esac
expect "the replacement team starts" "$(gw POST "/dispatch-orders/$NEW_ORDER/status" "$T_NEW" '{"status":"IN_PROGRESS","progress_pct":30}')" "200"
expect "the replacement team completes" "$(gw POST "/dispatch-orders/$NEW_ORDER/status" "$T_NEW" '{"status":"COMPLETED","progress_pct":100,"outcome":"RESOLVED","final_depth_cm":8}')" "200"
RES=$(body | jget "d['resolution_id']")
expect "another resident cannot confirm (404)" "$(gw POST /resolutions "$T_HUNG" "{\"resolution_id\":\"$RES\",\"decision\":\"CONFIRMED\"}")" "404"
expect "the field team cannot confirm its own work" "$(gw POST /resolutions "$T_NEW" "{\"resolution_id\":\"$RES\",\"decision\":\"CONFIRMED\"}")" "403"
expect "the resident confirms the resolution" "$(gw POST /resolutions "$T_LAN" "{\"resolution_id\":\"$RES\",\"decision\":\"CONFIRMED\"}")" "200"
expect "the report is RESOLVED in PostgreSQL" "$(psql_q "SELECT status FROM flood_reports WHERE report_id='$REPORT';")" "RESOLVED"
expect "the original order is SUPERSEDED in PostgreSQL" "$(psql_q "SELECT status FROM dispatch_orders WHERE order_id='$ORDER';")" "SUPERSEDED"
expect "the replacement order is COMPLETED in PostgreSQL" "$(psql_q "SELECT status FROM dispatch_orders WHERE order_id='$NEW_ORDER';")" "COMPLETED"
expect "the resolution is CONFIRMED in PostgreSQL" "$(psql_q "SELECT confirmation_status FROM report_resolutions WHERE resolution_id='$RES';")" "CONFIRMED"

expect "the audit chain verifies end to end" "$(gw GET /audit/verify "$T_HOA" >/dev/null; body | jget "d['chain_valid']")" "True"
gw GET "/audit/lineage/CORR-$REPORT" "$T_HOA" >/dev/null
LINEAGE=$(body)
echo "$LINEAGE" | grep -q 'CREATE_FLOOD_REPORT' && echo "$LINEAGE" | grep -q 'CONFIRM_RESOLUTION_AND_SEAL_LEDGER' || fail "Assertion 6: the case lineage does not run from the report to the sealed confirmation."
echo "    [OK] lineage CORR-$REPORT runs from the report to the sealed confirmation"
pass "Assertion 6: golden path verified through APISIX with one real identity per role (RBAC, ownership, conflicts, re-plan, confirmation, audit)."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 7: malware gate on photos (ClamAV): infected -> 422, clean -> accepted, scanner down -> 503
echo "Verifying the malware gate (ClamAV)..."
SCAN_STATUS=""
for i in $(seq 1 100); do
    SCAN_STATUS=$(curl -s -m 10 http://localhost:8000/api/v1/health | jget "d['core_services']['malware_scanner']['status']" || true)
    [ "$SCAN_STATUS" = "UP" ] && break
    sleep 3
done
[ "$SCAN_STATUS" = "UP" ] || { $DC logs --tail 20 clamav || true; fail "Assertion 7: ClamAV never became ready (status='$SCAN_STATUS')."; }
EICAR_B64=$(printf '%s%s%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$' 'EICAR-STANDARD-ANTIVIRUS' '-TEST-FILE!$H+H*' | base64 | tr -d '\n')
PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
photo() { gw POST /flood-reports "$T_LAN" "{\"lat\":20.9665,\"lng\":105.8712,\"depth_cm\":30,\"need_type\":\"PUMPING\",\"evidence_filename\":\"nuoc.png\",\"evidence_data_url\":\"data:image/png;base64,$1\"}"; }
BEFORE=$(psql_q "SELECT count(*) FROM flood_reports;")
expect "an infected photo is refused with 422" "$(photo "$EICAR_B64")" "422"
expect "  as MALWARE_DETECTED" "$(body | jget "d['error']")" "MALWARE_DETECTED"
expect "  and no report was stored" "$(psql_q "SELECT count(*) FROM flood_reports;")" "$BEFORE"
expect "  and the block is in the audit trail" "$(psql_q "SELECT count(*) > 0 FROM audit_records WHERE action='UPLOAD_BLOCKED_MALWARE';")" "t"
expect "a clean photo is accepted" "$(photo "$PNG_B64")" "201"
expect "a non-image upload is refused (415) before any scan" "$(gw POST /flood-reports "$T_LAN" "{\"lat\":20.9665,\"lng\":105.8712,\"depth_cm\":30,\"need_type\":\"PUMPING\",\"evidence_data_url\":\"data:application/pdf;base64,$PNG_B64\"}")" "415"
$DC stop clamav >/dev/null 2>&1
expect "with the scanner down the upload is refused (fail-closed)" "$(photo "$PNG_B64")" "503"
$DC start clamav >/dev/null 2>&1
pass "Assertion 7: malware gate verified (EICAR -> 422 + audit + nothing stored; clean -> 201; non-image -> 415; ClamAV down -> 503)."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 8: OT telemetry: authenticated MQTT -> ACL -> ingestor -> digital twin -> Kafka -> Parquet; every sample is labelled
echo "Verifying telemetry ingestion over MQTT (vehicles and gauges, source is mandatory)..."
MQTT_USER="${MQTT_DEVICE_USER:-device}"; MQTT_PASS="${MQTT_DEVICE_PASSWORD:-device_dev_only}"
mqtt_pub() { # topic payload [user] [pass]
    $DC exec -T mosquitto mosquitto_pub -h 127.0.0.1 -q 1 -u "${3:-$MQTT_USER}" -P "${4:-$MQTT_PASS}" -t "$1" -m "$2"
}
twin_lat() { gw GET /digital-twin/entities "$T_HOA" >/dev/null; body | python3 -c "
import sys, json
for e in json.load(sys.stdin)['entities']:
    if e['id'].endswith(':V03'):
        print(e['location']['value']['coordinates'][1])" 2>/dev/null; }
twin_field() { gw GET /digital-twin/entities "$T_HOA" >/dev/null; body | python3 -c "
import sys, json
for e in json.load(sys.stdin)['entities']:
    if e['id'].endswith(':V03'):
        print(e['dataSource']['value'])" 2>/dev/null; }
ORG=ORG_HN_PILOT_01
$DC exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "floodos/$ORG/vehicles/V03/telemetry" -m '{}' >/dev/null 2>&1 && fail "Assertion 8: Mosquitto accepted an anonymous publish."
mqtt_pub "floodos/$ORG/vehicles/V03/telemetry" '{}' device wrong-password >/dev/null 2>&1 && fail "Assertion 8: Mosquitto accepted a wrong password."
echo "    [OK] the broker refuses anonymous and wrong-password clients"
# MQTT 3.1.1 drops a denied PUBLISH silently (the client still gets a PUBACK), so the exit code proves nothing here:
# check the ACL the broker actually loaded instead.
ACL=$(MSYS_NO_PATHCONV=1 $DC exec -T mosquitto cat /mosquitto/config/acl)
echo "$ACL" | grep -q 'topic write floodos/+/vehicles/+/telemetry' || fail "Assertion 8: the device may not write the vehicles topic family."
echo "$ACL" | grep -q 'topic write floodos/+/gauges/+/telemetry' || fail "Assertion 8: the device may not write the gauges topic family."
echo "$ACL" | grep -q 'topic read floodos/+/vehicles/+/telemetry' || fail "Assertion 8: the ingestor may not read the vehicles topic family."
echo "$ACL" | grep -qi 'machines' && fail "Assertion 8: the former machines/ topic family is still in the broker ACL."
echo "    [OK] the broker ACL grants write to the two new topic families only (the former machines/ family is gone)"
LAT0=$(twin_lat); NEW_LAT=$(python3 -c "print(round($LAT0 + 0.0010, 6))")
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mqtt_pub "floodos/$ORG/vehicles/V03/telemetry" "{\"ts\":\"$TS\",\"lat\":$NEW_LAT,\"lon\":105.86,\"fuel_pct\":61.5,\"speed_kmh\":6.2,\"source\":\"SIMULATOR\"}"
SEEN=""; for i in $(seq 1 15); do SEEN=$(twin_lat); [ "$SEEN" = "$NEW_LAT" ] && break; sleep 2; done
expect "a labelled sample moves the digital twin" "$SEEN" "$NEW_LAT"
expect "the twin labels the position as SIMULATOR" "$(twin_field)" "SIMULATOR"
# rejected samples must change nothing
mqtt_pub "floodos/$ORG/vehicles/V03/telemetry" "{\"ts\":\"$TS\",\"lat\":21.5,\"lon\":105.86,\"fuel_pct\":61.5}"
mqtt_pub "floodos/$ORG/vehicles/V03/telemetry" "{\"ts\":\"$TS\",\"lat\":21.5,\"lon\":105.86,\"fuel_pct\":61.5,\"source\":\"official\"}"
mqtt_pub "floodos/$ORG/vehicles/V03/telemetry" "{\"ts\":\"$TS\",\"lat\":999,\"lon\":105.86,\"fuel_pct\":61.5,\"source\":\"SIMULATOR\"}"
mqtt_pub "floodos/ORG_HN_PILOT_02/vehicles/V03/telemetry" "{\"ts\":\"$TS\",\"lat\":21.5,\"lon\":105.86,\"fuel_pct\":61.5,\"source\":\"SIMULATOR\"}"
sleep 6
expect "samples with no/unknown source, out of range, or from the wrong tenant change nothing" "$(twin_lat)" "$NEW_LAT"
# gauge: a reading moves the zone's water level and risk, labelled
mqtt_pub "floodos/$ORG/gauges/G03/telemetry" "{\"ts\":\"$TS\",\"level_cm\":130,\"source\":\"SIMULATOR\"}"
Z=""; for i in $(seq 1 15); do gw GET /state "$T_HOA" >/dev/null; Z=$(body | jget "[z['water_level_cm'] for z in d['zones'] if z['zone_id']=='Z03'][0]"); [ "$Z" = "130.0" ] && break; sleep 2; done
expect "a gauge reading updates the zone water level" "$Z" "130.0"
expect "  labelled with its source" "$(body | jget "[z['water_level_source'] for z in d['zones'] if z['zone_id']=='Z03'][0]")" "SIMULATOR"
expect "  and raises the risk level from the gauge thresholds" "$(body | jget "[z['risk_level'] for z in d['zones'] if z['zone_id']=='Z03'][0]")" "CRITICAL"
EDGE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/internal/telemetry" -H 'Content-Type: application/json' -d '{}')
DIRECT=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8000/api/v1/internal/telemetry -H 'X-Ingest-Token: wrong' -H 'Content-Type: application/json' -d '{}')
expect "the internal ingest endpoint is sealed at the edge" "$EDGE" "404"
expect "and requires the shared secret inside the network" "$DIRECT" "401"
pass "Assertion 8: telemetry verified (ACL, mandatory source label, twin update, rejections change nothing, gauge -> zone risk, internal endpoint sealed)."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 9: hot -> cold data pipeline (Core -> Kafka -> Parquet on S3 -> DuckDB analytics), gateway protected
echo "Verifying the hot/cold pipeline..."
BUS=0; for i in $(seq 1 20); do BUS=$(curl -s http://localhost:8000/api/v1/health | jget "d['core_services']['event_bus']['published']" || echo 0); [ "${BUS:-0}" -gt 0 ] && break; sleep 2; done
[ "${BUS:-0}" -gt 0 ] || fail "Assertion 9: the core published no events to Kafka."
LAKE=0; for i in $(seq 1 30); do gw GET /analytics/summary "$T_HOA" >/dev/null; LAKE=$(body | jget "d['audit']['events']" || echo 0); [ "${LAKE:-0}" -gt 0 ] && break; sleep 3; done
[ "${LAKE:-0}" -gt 0 ] || { body; fail "Assertion 9: no audit event reached the Parquet lake."; }
echo "    [OK] DuckDB counted $LAKE audit event(s) in the lake"
UTIL=""; for i in $(seq 1 30); do gw GET /analytics/asset-utilization "$T_HOA" >/dev/null; UTIL=$(body | jget "','.join(r['asset_id'] for r in d['rows'])" || true); echo "$UTIL" | grep -q 'V03' && break; sleep 3; done
echo "$UTIL" | grep -q 'V03' || { body; fail "Assertion 9: vehicle telemetry never reached the Parquet lake."; }
expect "vehicle samples in the lake carry their source" "$(body | jget "[r['sources'] for r in d['rows'] if r['asset_id']=='V03'][0].split(',')[0] in ('SIMULATOR','DEVICE')")" "True"
gw GET /analytics/water-level-summary "$T_HOA" >/dev/null
echo "$(body)" | grep -q '"engine": *"DuckDB"' || fail "Assertion 9: the water-level-summary query failed."
expect "analytics needs a token" "$(curl -s -o /dev/null -w '%{http_code}' "$GW/api/v1/analytics/summary")" "401"
expect "analytics is closed to residents" "$(gw GET /analytics/summary "$T_LAN")" "403"
curl -s -m 3 -o /dev/null http://localhost:8090/health 2>/dev/null && fail "Assertion 9: the lake archiver port is exposed on the host."
pass "Assertion 9: hot/cold pipeline verified (events -> Kafka -> Parquet in S3 -> DuckDB; role-protected, archiver not host-exposed)."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 10: public Tier-3 case traceability re-verifies the SHA-256 chain independently
echo "Verifying the public traceability module..."
TR=""; for i in $(seq 1 30); do TR=$(curl -s -m 20 "$GW/trace/CORR-$REPORT.json" || true); echo "$TR" | grep -q '"trace_id"' && break; sleep 3; done
echo "$TR" | grep -q '"trace_id"' || { echo "$TR" | cut -c1-300; fail "Assertion 10: the public trace JSON for CORR-$REPORT never became available."; }
expect "the independent verifier found a continuous chain" "$(echo "$TR" | jget "d['verification']['epoch_continuous']")" "True"
expect "  and every record of the case matches its hash" "$(echo "$TR" | jget "d['verification']['records_match'] == d['verification']['records_checked']")" "True"
curl -s -m 20 "$GW/trace/CORR-$REPORT" | grep -q 'Truy xuất vụ việc ứng phó ngập lụt' || fail "Assertion 10: the trace page is not the flood-case module."
echo "$TR" | grep -q 'usr_reporter_lan\|reporter_lan' && fail "Assertion 10: the public trace exposes a personal identity."
pass "Assertion 10: the public trace page/JSON for CORR-$REPORT is served by Tier 3, re-verifies the SHA-256 chain and hides identities."

# ---------------------------------------------------------------------------------------------------------------
# Assertion 11: state survives a restart of the core (loaded from PostgreSQL, workflow mirror rebuilt, ledger re-verified)
echo "Restarting the Core API to verify persistence..."
expect "a fresh report is created before the restart" "$(gw POST /flood-reports "$T_HUNG" '{"lat":20.9588,"lng":105.8838,"depth_cm":70,"need_type":"MEDICAL","people_affected":1}')" "201"
PERSIST=$(body | jget "d['report_id']")
gw POST "/flood-reports/$PERSIST/verify" "$T_HOA" '{"decision":"VERIFIED","priority":"URGENT"}' >/dev/null
$DC restart core-api >/dev/null 2>&1
for i in $(seq 1 40); do curl -sf "$GW/api/v1/health" >/dev/null 2>&1 && break; sleep 3; done
gw GET /state "$T_HUNG" >/dev/null
AFTER=$(body)
echo "$AFTER" | grep -q "\"report_id\":\"$PERSIST\"" || fail "Assertion 11: report $PERSIST was lost across a core restart."
expect "the report status was restored" "$(echo "$AFTER" | jget "[r['status'] for r in d['reports'] if r['report_id']=='$PERSIST'][0]")" "VERIFIED"
gw GET /state "$T_HOA" >/dev/null
expect "the workflow mirror was rebuilt and points at the dispatch step" "$(body | jget "[p['current_step_id'] for p in d['bpmn_instances'] if p['business_key']=='$PERSIST'][0]")" "taskDispatcherDispatch"
expect "the audit chain still verifies after the restart" "$(gw GET /audit/verify "$T_HOA" >/dev/null; body | jget "d['chain_valid']")" "True"
AFTER_DEPLOYMENTS=$(curl -s -u rest-admin:test "http://localhost:8081/flowable-rest/service/repository/deployments?size=200&name=flood_report_lifecycle-$(sha256sum infra/bpmn/flood_report_lifecycle.bpmn20.xml | cut -c1-12)" | jget "d['total']" || echo 0)
expect "restarting the core did not deploy the unchanged BPMN again (idempotent deployment)" "$AFTER_DEPLOYMENTS" "$CONTENT_DEPLOYMENTS"
pass "Assertion 11: state, workflow mirror and hash chain survive a core restart; BPMN deployment is idempotent (rehydrated from PostgreSQL)."


# ---------------------------------------------------------------------------------------------------------------
# Assertion 12: the remaining front-ends are still served by the gateway (they are the legacy UI, not yet reworked)
PORTAL=$(curl -s -m 20 "$GW/" || true)
echo "$PORTAL" | grep -q 'id="root"' || fail "Assertion 12: the operations portal is not served at /."
expect "the API stays token-protected next to the static front-ends" "$(curl -s -o /dev/null -w '%{http_code}' "$GW/api/v1/state")" "401"
echo "[WARN] apps/web and apps/twin3d still target the former rice-harvest API: they are served, but they are NOT FloodOS front-ends yet."
pass "Assertion 12: static front-ends are served and the API remains protected."

echo "[5/5] All full-stack container integration assertions PASSED successfully!"
echo "============================================================================"
