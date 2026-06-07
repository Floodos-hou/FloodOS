# Changelog

All notable changes to the **OpenAgriOS** platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0-alpha] - 2026-10-30

### Added
- **Tier-1 Headless Core PaaS (Developer Preview MVP)**:
  - `core/identity`:
    - Keycloak OpenID Connect (OIDC 1.0) dual-mode engine.
    - Live Keycloak OIDC token exchange client (`tryLiveKeycloakLogin`).
    - Standalone Dev Mock Engine with cryptographically secure ephemeral 256-bit random keys per process lifecycle (prevents static secret vulnerability).
    - RBAC claim generation and multi-tenant contextual verification.
  - `core/api-gateway`: Apache APISIX Zero-Trust gateway simulation with declarative authorization headers and rate limiting.
  - `core/workflow`: Flowable BPMN 2.0 XML workflow parser and execution engine supporting Service Requests and Incident Re-planning.
  - `core/data-services`:
    - `ImmutableAuditLedger`: Cryptographic SHA-256 hash-chain immutable ledger with full data lineage reconstruction.
    - `TenantRlsContext`: PostgreSQL Row-Level Security (RLS) policy compiler and multi-tenant isolation guard.
    - `NgsiLdTwinMapper`: ETSI GS CIM 009 / FIWARE NGSI-LD v1.6 digital twin entity serialization.
    - `SeaweedS3StorageService`: S3-compatible unstructured object storage for photos and inspection evidence.
    - `ScheduleConflictEngine`: Temporal overlap and machine availability verification using GiST exclusion semantics.
    - `SpatialMatchingEngine`: PostGIS Haversine distance and multi-criteria scoring algorithm for machine dispatching.
- **Reference Application**:
  - `apps/agriops`: Agricultural Mechanization Dispatch & Incident Recovery reference implementation with full REST API suite.
- **Infrastructure as Code (Pinned Versions & Healthchecks)**:
  - `compose.yaml`: Single unified container orchestration with pinned images:
    - PostgreSQL `16.2-alpine` with healthcheck.
    - Keycloak `24.0.5` with TCP healthcheck.
    - SeaweedFS `3.64` with S3 TCP healthcheck (pinned, no `latest`).
    - Flowable `7.0.0` (pinned, no `latest`).
    - APISIX `3.9.0-debian`.
  - `infra/db/schema.sql`: Declarative PostgreSQL schema with `btree_gist`, RLS policies, and NGSI-LD entity structures.
  - `infra/keycloak/openagrios-realm.json`: Declarative Keycloak realm export with multi-tenant roles and pre-seeded accounts.
  - `infra/apisix/apisix.yaml`: Apache APISIX route and security definitions including `openid-connect` plugin.
  - `infra/bpmn/`: Production BPMN 2.0 XML diagrams for service request lifecycle and incident replanning.
- **Compliance & Licensing**:
  - Added `SPDX-License-Identifier: Apache-2.0` headers to all Java, SQL, XML, Dockerfile, and YAML workflow files.
  - Comprehensive `THIRD_PARTY_NOTICES.md` documenting 100% permissive open-source compatibility.
- **Testing & Verification**:
  - Automated integration test suite `AcceptanceTestRunner` covering 10 operational scenarios with 100% pass rate.
  - Postman Collection v2.1 with comprehensive assertions and environmental variables (`tests/postman/`).
  - Cross-platform build instructions supporting Maven, Linux/macOS POSIX shell, and Windows PowerShell.

### Security
- **Strict OIDC RS256 Verification & Fail-Fast Protection**:
  - Explicitly reject RS256 tokens in `DEV_MOCK_STANDALONE` mode to prevent unverified RSA signature bypass.
  - Enforce `KEYCLOAK_PRODUCTION` strict failure mode: returns HTTP 401 `KEYCLOAK_LOGIN_FAILED` immediately when Keycloak is offline; strictly prohibits falling back to mock tokens.
  - Fail-fast configuration check: Invalid `OPENAGRIOS_AUTH_MODE` environment variable values throw an immediate `IllegalStateException`.
  - Added test cases in `AcceptanceTestRunner` Suite 4 verifying rejection of forged RS256 tokens and mock fallback prevention.

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
  - Implemented `PostgreSqlDataService` supporting JDBC connection to PostgreSQL 16 and tenant session isolation policies (`SET LOCAL app.current_org_id = ?; SET LOCAL app.current_user_role = ?;`).
  - Implemented SeaweedFS S3 read-back persistence verification (`readEvidenceObject`) with HTTP GET against port 9000.
- **Maven & Test Automation**:
  - Bound `AcceptanceTestRunner` to `mvn test` in `pom.xml` via `exec-maven-plugin:3.2.0` while maintaining 100% zero-dependency raw `javac` compilation.
- **Visual System Architecture & Documentation**:
  - Designed and generated 3 SVG vector diagrams in `docs/assets/`:
    - `architecture_diagram.svg`: DX-OS 3-tier layered system architecture.
    - `security_zero_trust.svg`: Zero-trust security, APISIX gateway introspection, and PostgreSQL 16 RLS multi-tenant isolation.
    - `incident_recovery_flow.svg`: 6-step golden demo incident recovery & automated replanning flow.
  - Embedded visual diagrams across `README.md`, `docs/architecture.md`, and `docs/demo-guide.md`.

### Infrastructure Integrations
- **Dual-Mode Container & In-Process Adapters**:
  - `SeaweedS3StorageService`: Real HTTP REST client PUT/GET against SeaweedFS S3 endpoint (:8333) with fallback to in-memory cryptographic MD5 ETag storage.
  - `BpmnWorkflowEngine`: Live Flowable REST Engine v7.0.0 integration via REST API with in-process W3C DOM BPMN 2.0 XML parser fallback.
  - `APISIX`: Configured `openid-connect` plugin in `infra/apisix/apisix.yaml` for Keycloak OIDC bearer token authentication at gateway boundary.
