# Changelog

All notable changes to the **OpenAgriOS** platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
