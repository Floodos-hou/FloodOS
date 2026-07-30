# Changelog

All notable changes to the **OpenAgriOS** platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Hot/Cold Data Pipeline (feat/hot-cold-data-pipeline)
- **Hot path**: `ImmutableAuditLedger` publishes every audit event to Apache Kafka topic `openagrios.audit.v1` through the new asynchronous `EventBusPublisher` (Kafka REST Proxy / Karapace over HTTP, bounded queue, retry with backoff, drop/fail counters exposed on `/api/v1/health`). The core stays free of extra Java dependencies.
- **Cold path**: new `services/lake-archiver` consumes the topics (at-least-once, offsets committed only after the file is written) and writes Hive-partitioned ZSTD Parquet to `s3://openagrios-lake/` on SeaweedFS.
- **Analytics**: DuckDB queries over Parquet exposed as `GET /api/v1/analytics/{summary|actions-by-day|machine-utilization}`, restricted to `COORDINATOR`/`PLATFORM_ADMIN`, scoped by the token's `organization_id`; the archiver port is never published to the host.
- **Infra**: `kafka` (KRaft, Apache-2.0), idempotent `kafka-init` (topic bootstrap on every start), `kafka-rest` (Karapace, Apache-2.0) and `lake-archiver` services in `compose.yaml`; no broker port is published to the host and `compose.prod.yaml` sets `restart: always`.
- **Tests**: `tests/e2e_full_stack_test.sh` Assertion 11 verifies bus publish, Parquet objects in S3, DuckDB query, gateway protection and no host exposure.
- **Licensing**: the broker was switched from Redpanda (BSL 1.1, not on the project's allowed-licence list) to Apache Kafka + Karapace (both Apache-2.0).

### Live Map Visual Feedback
- KPI strip above the map (working / broken / average fuel / harvest progress / active shifts) with animated counters and a pulsing card while a machine is broken.
- Machine icons turn towards their direction of travel (compass bearing corrected for the map rotation; a parked machine never spins on GPS noise).
- The rescue route is drawn with a glow and "marching ants" animation, and the destination field gets a pulsing ring.
- A slide-in event feed reports status changes (breakdown, rescue proposal, rescuer moving/working, recovery); the first snapshot is a baseline, not news.
- All of it honours `prefers-reduced-motion`. The pure logic (heading, KPIs, event detection) has 13 `node --test` tests and runs in `tests/run_unit_tests.sh`; the effects were verified in real Chrome (DOM probes + screenshots).

### Malware Gate (ClamAV) for Client Uploads
- New `MalwareScanner` (pure-Java clamd `zINSTREAM` client, 64 KiB chunks, `zPING` liveness) and a `clamav` service. Evidence attached to an incident report is scanned **before** anything is stored: infected -> `422 MALWARE_DETECTED` (signature returned, `UPLOAD_BLOCKED_MALWARE` audited, no object, no incident); scanner unreachable/erroring -> `503 MALWARE_SCANNER_UNAVAILABLE` (**fail-closed**, audited); malformed base64 -> `400`; oversized (> 10 MiB) -> `413`.
- Production: `OPENAGRIOS_MALWARE_SCAN=REQUIRED` makes the core refuse to start without `CLAMAV_HOST`. Standalone development without ClamAV runs with scanning explicitly `DISABLED` (visible in `/api/v1/health` under `malware_scanner`).
- Tests: 22 unit tests against a protocol-faithful fake clamd (framing, multi-chunk, fail-closed on error/garbage/timeout/closed connection, limits, config, upload gate), 9/9 injected defects caught; e2e Assertion 16 with the real daemon and the EICAR test file (assembled at run time so no file in the repository contains it).
- Not covered: the document upload paths of the farmer/acceptance flow generate their evidence server-side; only the one client-supplied attachment is a scan point today.

### Tier 3: Rice Traceability Module, and Cold-Path Defects Found While Verifying It
- **New `apps/traceability` (Tier 3)**: public read-only pages `/trace/{id}` (+ `.json`, `/qr.svg`) behind a dedicated APISIX route (rate limited, no token). It reads only the cold lake and **recomputes the SHA-256 of every record itself**, checking that the whole ledger epoch is unbroken (`VERIFIED` / `PARTIAL` / `FAILED`); identities are redacted. The core now streams the exact hashed bytes (`before_canonical`, `after_canonical`); the archiver stores them. A golden hash vector is asserted by both the Java and the Python test suites. 34 module tests, 9/9 injected defects caught; e2e Assertion 15.
- **Fixed (archiver)**: offsets were **never committed** (the REST consumer API wants `{"offsets": [...]}`, the archiver sent `{"partitions": [...]}`, Karapace answered HTTP 500). Consequences: the written batch was re-written on every cycle (quadratic growth), the whole topic was replayed after every restart, and telemetry (not de-duplicated) double-counted distances. Now: correct payload; write and commit are separate steps so a failed commit never re-writes data; offsets are retried; telemetry reads are de-duplicated.
- **Fixed (archiver)**: the consumer thread could die silently (concurrent `LOAD httpfs` -> "secret type 's3' already registered") while the API still reported UP. Extension setup is serialised and workers are supervised (restart + `worker_restarts` + state `crashed`).
- **New (archiver)**: compaction of small files per day partition (verifies the row count before deleting sources; idempotent; skips fresh files). On the real S3 lake it merged 1,968 files into 4 and cut the trace query from ~3 s to 0.27 s.
- 13 new archiver tests (commit protocol, pump behaviour with a scripted consumer, dedupe, compaction safety, worker supervision); 7/7 injected defects caught.

### Live Fleet Map and Automated Incident Demo (web)
- `useLiveFleet` polls the digital twin every 2 s (roles with fleet access only; paused when the tab is hidden; the snapshot is bound to the session token so a switched persona never sees another tenant's positions) and keeps a trail per machine.
- `TacticalMap`: machine markers are reused and glide to new positions, trails layer, `LiveFleetPanel` HUD (live/waiting/disconnected, moving count, fuel bars, click-to-fly), field labels rebuilt only when fields change, default zone is now the real Can Tho data (the Nam Dinh fixture is labelled sample data). Map updates are guarded by the MapLibre `load` event instead of `isStyleLoaded()`, which stays false when tiles are slow or unreachable and froze all live updates.
- `IncidentScenario` (demo builds, COORDINATOR): drives the real API end to end (incident -> scored rescue options -> approval -> rescuer starts -> ticks -> audit chain verification) with narration per step and a reset button.
- Simulator: `SIM_TIMELAPSE` (default 12 under the `demo` profile, 1 otherwise; reported speed capped at 80 km/h) and a 5 s roster resync so a reset is followed quickly.
- Verified in a real Chrome session (login, live HUD, markers moving, 7/7 scenario steps) and by e2e Assertions 13 and 14.

### Defects Found While Verifying the Live Demo on the Real Stack (all fixed, all covered by tests)
- **Machines lost their operator on PostgreSQL**: `machines` had no `assigned_operator_id` column although the loader read it, so after any reload the rescue algorithm fell back to "the first operator" (the broken machine's own driver) and the replacement shift violated the operator exclusion constraint (`approve-replan` failed). Added the column (idempotent upgrade of existing volumes), persisted it, and the algorithm no longer guesses a driver.
- **Audit chain could not be re-verified after a restart**: the hash covers sequence, timestamp and canonical JSON, but PostgreSQL stored `NOW()`, re-formatted JSONB and its own serial. The exact hashed material is now persisted and the newest ledger epoch is restored (`GET /api/v1/audit/verify` stays valid across restarts).
- **Records written after a simulator reset were silently dropped** (`UNIQUE(event_id)` + `ON CONFLICT DO NOTHING` while ids restart at `EVT-2026-0001`). Event ids are now unique per ledger epoch and duplicates are reported, not ignored.
- **`sim/reset` did not reset PostgreSQL**: incident/replacement rows survived and resurrected on restart. Reset now deletes transactional rows (the append-only audit ledger starts a new epoch instead).
- Persistence failures of machines, assignments and audit records are now logged instead of swallowed.

### Unit Test Suites and Defects Found by Them
- Added `tests/run_unit_tests.sh` (wired into CI): 127 Java tests (`tests/unit/`, dependency-free harness), 26 Python tests for `lake-archiver` (real DuckDB + Parquet in a temp dir) and 29 for `telemetry`. Mutation-checked: 29/29 deliberately injected defects are caught.
- **Fixed**: `JsonCodec.parseObject` silently turned garbage request bodies (e.g. `not-json`) into `{}`, so handlers applied their defaults (`machine_id=M01`, `field_id=F07`...). Client bodies now go through the new strict `JsonCodec.parseObjectStrict`; malformed JSON returns `400 INVALID_JSON`. The lenient parser is kept only for trusted upstream responses.
- **Fixed**: `NaN`/`Infinity` were serialised verbatim (invalid JSON); they are now emitted as `null`.
- **Fixed**: `lake-archiver` returned `datetime.date` values un-serialised from `rows_as_dicts`.
- Testability: `EventBusPublisher.forUrl(...)`, `AnalyticsLakeClient(String)` and the `LAKE_ROOT` setting of the archiver (default behaviour unchanged).
- CI: the production-compose validation step now supplies every required secret (it was missing `KEYCLOAK_PUBLIC_URL`/`KEYCLOAK_PUBLIC_ISSUER` and the new MQTT/ingest secrets).

### OT Telemetry Ingestion over MQTT
- `mosquitto` (EPL-2.0/EDL-1.0) with mandatory authentication and a least-privilege ACL regenerated from env on every boot (`infra/mosquitto/`); no anonymous access.
- `services/telemetry`: `telemetry-ingestor` (schema validation, topic/payload tenant check, Prometheus-style `/metrics`, never drops silently) and `device-simulator` (**simulated devices**, `demo` profile, off by default).
- Core: `POST /api/v1/internal/telemetry` and `GET /api/v1/internal/fleet`, guarded by `X-Ingest-Token` (fail-closed `503` if unset; required in `compose.prod.yaml`) and blocked with `404` by APISIX. Telemetry updates the NGSI-LD twin, is persisted to PostgreSQL at most every 10 s per machine and streamed to Kafka `openagrios.telemetry.v1` -> Parquet.
- Tests: in-process validation cases in `AcceptanceTestRunner`; `tests/e2e_full_stack_test.sh` Assertion 12 (broker auth, twin update, rejection of out-of-range/cross-tenant/malformed samples, sealed internal endpoint, DuckDB `machine-utilization`).

---

## [0.1.0-alpha] - 2026-10-30

### User-Level RLS (app.current_user_id), Production Storage Fail-Fast, PKCE State CSRF Protection & Live APISIX Golden Path (Update 6)
- **Multi-Tenant & Multi-User Row-Level Security (`app.current_user_id` & `TenantRlsContext`)**:
  - Propagated authenticated `userId` directly from `AuthContext` down through `AgriOpsService`, `AgriDataStore`, and `PostgreSqlDataService`.
  - Enforced `SET LOCAL app.current_user_id = ?` alongside `app.current_org_id` and `app.current_user_role` in all JDBC transactions (`syncField`, `syncMachine`, `syncOperator`, `syncServiceRequest`, `syncAssignment`, `syncIncident`, `syncWorkAcceptance`, `syncAuditRecord`, and `queryWithRls`).
  - Successfully verified user-level isolation within the same cooperative (`farmer_ba` vs `farmer_nam`) and multi-tenant isolation across cooperatives (`HTX_CANTHO_01` vs `HTX_SOCTRANG_02`).
- **PostgreSQL Production Mode Hardening & Zero In-Memory Drift (`AgriDataStore` & `compose.yaml`)**:
  - Explicitly declared `OPENAGRIOS_STORAGE_MODE: ${OPENAGRIOS_STORAGE_MODE:-POSTGRESQL_PRODUCTION}` under `core-api.environment` in `compose.yaml`.
  - Re-architected `AgriDataStore.persist*`: when in production mode, immediately fail-fast (`IllegalStateException`) if PostgreSQL is unreachable or transaction sync fails. Domain entities are NEVER added to in-memory maps upon failure, guaranteeing single source of truth (SSOT).
- **PKCE State Validation & RFC 9700 Password Grant Deprecation (`KeycloakOidcEngine` & `AgriOpsService`)**:
  - Added anti-CSRF `state` parameter tracking and validation to `PkceSession` and `KeycloakOidcEngine.verifyPkceCodeChallenge(code, verifier, state)`.
  - Formally marked `AgriOpsService.loginOidc(body)` as `@Deprecated(since = "0.2.0")` with RFC 9700 Security Best Practices warning in response payload.
  - Implemented unified `AgriOpsService.exchangePkceToken(body)` handling both `KEYCLOAK_PRODUCTION` upstream calls and cryptographic `DEV_MOCK_STANDALONE` PKCE verification with audit logging.
- **Live Integration Tests & APISIX Golden Path (`AcceptanceTestRunner` & `tests/e2e_full_stack_test.sh`)**:
  - Added live integration test asserting `compiled_rls_sql` includes all 3 session variables (`app.current_org_id`, `app.current_user_role`, `app.current_user_id`).
  - Added live integration test for PKCE CSRF rejection on state tampering.
  - Added live integration test verifying fail-fast behavior and zero-leakage in production storage mode.
  - Added Assertion 7 in `e2e_full_stack_test.sh`: Live Multi-Tenant & Multi-User RLS query execution on PostgreSQL container via `openagrios_app` non-superuser role.
  - Added Assertion 8 in `e2e_full_stack_test.sh`: End-to-end Live Golden Path across APISIX Gateway (`:9080`), verifying PKCE session generation, token exchange, protected service request registration, and PostgreSQL row persistence.

### Full-Stack CI Testing, Cold-Start DB Rehydration, Production Hardening & PKCE Verification (Update 5)
- **Full-Stack Container Testing in CI (`.github/workflows/ci.yml` & `tests/e2e_full_stack_test.sh`)**:
  - Extended GitHub Actions CI beyond static compilation and in-process tests: added automated container spinup with `docker compose up -d --build`.
  - Added multi-service healthcheck waiting loop covering PostgreSQL 16, Keycloak 24, SeaweedFS S3, Flowable BPMN, Core API, and APISIX Zero-Trust Gateway.
  - Added live container assertions validating Core API `/api/v1/health`, APISIX reverse proxy routing, PostgreSQL RLS schema row population, dedicated `openagrios_app` non-superuser role verification (`rolsuper = f`, `rolbypassrls = f`), and PKCE authorization endpoint.
  - Added automated Docker teardown trap on script completion (`docker compose down -v --remove-orphans`).
- **Database Cold-Start Rehydration & Single Source of Truth (`AgriDataStore` & `PostgreSqlDataService`)**:
  - Eliminated dependence on in-memory fixtures on restart: implemented `loadFromDatabase()` in `AgriDataStore` which queries PostgreSQL 16 on startup when existing data is detected (`hasExistingData()`), preserving user data across Core API process restarts.
  - Implemented `PostgreSqlDataService.queryAll()` using `PLATFORM_ADMIN` RLS context to cleanly rehydrate `organizations`, `users`, `fields` (with `season_window` bounds and GeoJSON boundaries), `machines`, `operators`, `service_requests`, `assignments`, `incidents`, and `work_acceptances`.
  - Added `ImmutableAuditLedger.rehydrateLedger()` to restore cryptographic SHA-256 audit chain state directly from `audit_records` table on cold start.
  - Added automated test in `AcceptanceTestRunner` verifying that newly persisted business entities (`REQ-COLD-START-99`) are preserved and rehydrated after instantiating new data store instances.
- **Production Compose Specification & Secret Hardening (`compose.prod.yaml` & `docs/security.md`)**:
  - Created production compose override `compose.prod.yaml` utilizing `${VAR:?error}` syntax to fail fast if sensitive credentials (`POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`) are missing.
  - Isolated internal service boundaries: internal PostgreSQL (5432), S3 storage (9000/8888), and BPMN (8081) ports are restricted to internal Docker networks; only APISIX Gateway and Core API ingress ports are exposed.
  - Enforced `OPENAGRIOS_AUTH_MODE=KEYCLOAK_PRODUCTION` and `OPENAGRIOS_STORAGE_MODE=POSTGRESQL_PRODUCTION` in production profile.
  - Created `.env.production.example` and published `docs/security.md` detailing the Zero-Trust threat model, cryptographic secret generation (`openssl rand -hex 32`), and secret rotation procedures.
- **End-to-End RFC 7636 PKCE Flow Verification**:
  - Implemented mathematical PKCE verification in `KeycloakOidcEngine.verifyPkceCodeChallenge()`: verifies that SHA-256 base64url hash of `code_verifier` matches `code_challenge` generated in authorization session.
  - Enforced RFC 7636 Section 4.1 code_verifier length constraints (43 to 128 characters), rejecting out-of-spec verifiers with HTTP 400 `INVALID_CODE_VERIFIER`.
  - Enforced fail-fast rejection without mock fallback in `KEYCLOAK_PRODUCTION` mode if upstream PKCE exchange fails (HTTP 401 `KEYCLOAK_TOKEN_EXCHANGE_FAILED`).
  - Adhered to RFC 6749 Section 2.3.1 single client authentication by removing redundant `client_secret` in body when sending HTTP Basic header in `exchangeAuthorizationCodeWithPkce()`.
  - Added end-to-end integration test verifying that access tokens issued via PKCE successfully authenticate to protected endpoints (`/api/v1/state`).

### Docker Compose Fix, Mandatory Season Window & Hardened Non-Superuser RLS (Update 4)
- **Deployment-Critical Compose Fix (`compose.yaml`)**:
  - Restored superuser password `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-openagrios_dev_only}` in `postgres` container service, eliminating startup termination on clean volumes.
  - Relocated and configured `KEYCLOAK_INTROSPECTION_CLIENT_ID` and `KEYCLOAK_INTROSPECTION_CLIENT_SECRET` specifically on `core-api`.
- **Mandatory Season Window (`season_window TSTZRANGE NOT NULL`)**:
  - Synchronized `season_window TSTZRANGE NOT NULL` in both `infra/db/schema.sql` and `PostgreSqlDataService.java`.
  - Added `windowStart` and `windowEnd` timestamp range parameters to `syncField()` to prevent NOT NULL database constraint rejections.
  - Added fail-fast validation in `AgriDataStore.persistField()`.
- **Hardened Multi-Tenant RLS & Non-Superuser Application Role**:
  - Enforced `FORCE ROW LEVEL SECURITY` across all 8 multi-tenant entity tables (`fields`, `machines`, `operators`, `service_requests`, `assignments`, `incidents`, `work_acceptances`, `audit_records`) to prevent table owners from bypassing RLS policies.
  - Added explicit RLS isolation policies for `operators` and `work_acceptances`.
  - Provisioned dedicated application database role `openagrios_app` (`NOSUPERUSER NOBYPASSRLS`) in `schema.sql` and configured `core-api` to connect with it.

### Database Schema Harmonization, Business Entity Persistence & RFC 6749 Single Auth (Update 3)
- **Database Schema Harmonization (infra/db/schema.sql & PostgreSqlDataService)**:
  - Unified table and column names across `PostgreSqlDataService.java` and `infra/db/schema.sql`: `fields` (`field_id`, `organization_id`, `owner_user_id`, `crop`, `area_ha`, `readiness_status`, `harvest_progress_pct`, `center_lat`, `center_lng`, `boundary_geojson`), `machines` (`machine_id`, `organization_id`, `owner_user_id`, `capacity_ha_per_hr`), `assignments` (`assignment_id`, `organization_id`), `incidents` (`incident_id`, `organization_id`), and `audit_records` (`seq_no`, `event_id`, `organization_id`, `correlation_id`).
  - Added bootstrap idempotent seed records for organizations and users in `infra/db/schema.sql` ensuring foreign keys succeed during container startup.
- **Full Business Operation Persistence**:
  - Connected `AgriDataStore` and `AgriOpsService` to PostgreSQL: every business operation (`createServiceRequest`, `dispatchAssignment`, `reportMachineIncident`, `approveRescueReplan`, `updateRepairTicket`, `confirmAcceptance`) executes persistent mutator methods (`store.persistField`, `store.persistMachine`, `store.persistServiceRequest`, `store.persistAssignment`, `store.persistIncident`, `store.persistWorkAcceptance`) through `PostgreSqlDataService` with tenant RLS isolation (`SET LOCAL app.current_org_id = ?; SET LOCAL app.current_user_role = ?;`).
  - Connected `ImmutableAuditLedger`: every appended audit block automatically syncs to PostgreSQL `audit_records` table with JSONB state snapshots.
- **RFC 6749 Single Client Authentication Compliance in Keycloak Introspection**:
  - Fixed duplicate authentication in `KeycloakOidcEngine.introspectLiveKeycloakToken()`: strictly adheres to RFC 6749 Section 2.3.1 ("The client MUST NOT use more than one authentication method in each request") by sending HTTP Basic Authorization header (`client_secret_basic`) and omitting `client_secret` from the request body.
- **Security & Demo Credentials Advisory**:
  - Parameterized `KEYCLOAK_INTROSPECTION_CLIENT_ID` and `KEYCLOAK_INTROSPECTION_CLIENT_SECRET` in `compose.yaml` and `.env.example`.
  - Added prominent `[!CAUTION]` security advisory in `README.md` and `.env.example` warning that all passwords (`123456`) and gateway secrets (`agriops-gateway-secret-2026`) are strictly for local development and CI testing fixtures.

### Strict Integration, Real Persistence & Fail-Fast Hardening (Update 2)
- **Keycloak OIDC Confidential Client Introspection & PKCE Standard**:
  - Configured `DEFAULT_INTROSPECTION_CLIENT_ID` (`agriops-gateway`) and `DEFAULT_INTROSPECTION_CLIENT_SECRET` (`agriops-gateway-secret-2026`).
  - RFC 7662 token introspection now sends HTTP Basic authentication credentials alongside form parameters, fulfilling Keycloak requirements for confidential client introspection.
  - Implemented `exchangeAuthorizationCodeWithPkce()` and exposed public endpoint `POST /api/v1/auth/pkce/token` for OAuth 2.0 / OIDC Authorization Code + PKCE token exchange.
  - Formally deprecated `tryLiveKeycloakLogin()` with JavaDoc guidance citing **RFC 9700** (deprecating ROPC grant for web clients).
- **PostgreSQL 16 Real JDBC Persistence & Truthful Storage Reporting**:
  - Expanded `PostgreSqlDataService` with live JDBC connectivity check (`isConnectionLive()`), schema initialization DDL (`initSchema()`), and multi-tenant RLS CRUD methods (`syncField`, `syncMachine`, `syncShift`, `syncIncident`, `syncAuditBlock`).
  - Integrated `PostgreSqlDataService` into `AgriDataStore`: `getStorageEngineMode()` now dynamically checks live JDBC connectivity, returning truthful connection status (`POSTGRESQL_16_JDBC_RLS (Active JDBC Pool... Status: CONNECTED)` vs `IN_MEMORY_MAP_WITH_POSTGRES_RLS_COMPILER (PostgreSQL unreachable: fallback active)`).
- **Elimination of Silent Fallbacks in Production Services**:
  - `BpmnWorkflowEngine`: Configured dynamic credentials (`FLOWABLE_REST_USER`, `FLOWABLE_REST_PASSWORD`). Under `FLOWABLE_PRODUCTION` mode, connection or HTTP errors fail fast and throw exceptions instead of silently switching to embedded mock.
  - `SeaweedS3StorageService`: Configured dynamic credentials (`S3_ACCESS_KEY`, `S3_SECRET_KEY`). Under `S3_PRODUCTION` mode, S3 PUT/GET errors fail fast and throw exceptions. Live S3 uploads now persist metadata JSON (`.meta.json`) directly into the object store alongside the payload.

### Integration & Security Hardening
- **Zero-Trust Token Rejection & Strict Identity**:
  - Validated strict rejection of expired tokens and tokens with incorrect audience (`aud != openagrios-api`).
  - Added Authorization Code + PKCE generation endpoint (`GET /api/v1/auth/pkce/authorize-url`) with `S256` code challenge and cryptographically secure random verifier.
  - Aligned APISIX `openid-connect` plugin with confidential client `agriops-gateway` and introspection credentials in `infra/keycloak/openagrios-realm.json`.
- **Database & Storage Real Persistence**:
  - Hardened PostgreSQL Row-Level Security initialization with idempotent schema creation and explicit session context variables (`app.current_org_id`, `app.current_user_role`).
  - Upgraded S3 client to verify connection health and calculate payload SHA-256 digests.
- **Workflow & Audit Ledger**:
  - Connected Flowable REST deployment and query endpoints.
  - Implemented immutable audit ledger with SHA-256 chain verification.
