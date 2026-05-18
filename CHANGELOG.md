# Changelog

All notable changes to the **OpenAgriOS** platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Multi-module repository structure organizing components into `core/`, `apps/`, `infra/`, `docs/`, and `tests/`.
- Automated GitHub Actions CI workflow for compilation and acceptance test verification.
- Issue templates for bug reporting and feature requests.

---

## [1.0.0-tier1] - 2026-10-30

### Added
- **Tier-1 Headless Core PaaS**:
  - `core/identity`: Keycloak OpenID Connect (OIDC) integration, RBAC claim generation, and JWT validation.
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
- **Infrastructure as Code**:
  - `infra/db/schema.sql`: Declarative PostgreSQL schema with `btree_gist`, RLS policies, and NGSI-LD entity structures.
  - `infra/keycloak/openagrios-realm.json`: Declarative Keycloak realm export with multi-tenant roles and pre-seeded accounts.
  - `infra/apisix/apisix.yaml`: Apache APISIX route and security definitions.
  - `infra/bpmn/`: Production BPMN 2.0 XML diagrams for service request lifecycle and incident replanning.
- **Testing & Verification**:
  - Automated integration test suite `AcceptanceTestRunner` covering 9 operational scenarios.
  - Postman Collection v2.1 with comprehensive assertions and environmental variables (`tests/postman/`).
