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
  - `infra/apisix/apisix.yaml`: Apache APISIX route and security definitions.
  - `infra/bpmn/`: Production BPMN 2.0 XML diagrams for service request lifecycle and incident replanning.
- **Compliance & Licensing**:
  - Added `SPDX-License-Identifier: Apache-2.0` headers to all Java, SQL, XML, Dockerfile, and YAML workflow files.
  - Comprehensive `THIRD_PARTY_NOTICES.md` documenting 100% permissive open-source compatibility.
- **Testing & Verification**:
  - Automated integration test suite `AcceptanceTestRunner` covering 9 operational scenarios with 100% pass rate.
  - Postman Collection v2.1 with comprehensive assertions and environmental variables (`tests/postman/`).
  - Cross-platform build instructions supporting Maven, Linux/macOS POSIX shell, and Windows PowerShell.
