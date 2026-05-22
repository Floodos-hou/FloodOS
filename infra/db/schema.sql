-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 OpenAgriOS Contributors

-- ============================================================================
-- OPENAGRIOS PLATFORM — MULTI-TENANT DATABASE SCHEMA
-- PostgreSQL 16 + btree_gist + GeoJSON JSONB + Row-Level Security (RLS)
-- License: Apache-2.0
-- Architecture:
--   - Hot Data (OLTP): Transactional service requests, resource dispatch, incidents
--   - Warm Data (Spatial & Digital Twin): GeoJSON field boundaries & ETSI NGSI-LD telemetry
--   - Cold Data (Immutable Ledger): SHA-256 Hash-Chain audit records & Data Lineage
--   - Multi-Tenancy: PostgreSQL Row-Level Security (RLS) & GiST time-window exclusion
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ORGANIZATION (Đơn vị thuê ước / Multi-tenancy)
CREATE TABLE organizations (
    organization_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    org_type VARCHAR(50) NOT NULL CHECK (org_type IN ('COOPERATIVE', 'SERVICE_PROVIDER', 'REPAIR_UNIT')),
    province VARCHAR(100) NOT NULL DEFAULT 'Cần Thơ',
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. USERS & ROLES (Ánh xạ định danh từ Keycloak SSO - Apache-2.0)
CREATE TABLE users (
    user_id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    role VARCHAR(50) NOT NULL CHECK (role IN ('FARMER', 'COORDINATOR', 'MACHINE_OWNER', 'OPERATOR', 'REPAIR_TEAM', 'PLATFORM_ADMIN')),
    keycloak_sub VARCHAR(128) UNIQUE,
    phone VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. FIELDS / SEASONS (Vùng canh tác & Mùa vụ — Kho Ấm GeoJSON JSONB)
CREATE TABLE fields (
    field_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    owner_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    name VARCHAR(255) NOT NULL,
    hamlet VARCHAR(255) NOT NULL,
    crop VARCHAR(100) NOT NULL DEFAULT 'Lúa Đông Xuân (OM18)',
    area_ha NUMERIC(8,2) NOT NULL CHECK (area_ha > 0),
    readiness_status VARCHAR(32) NOT NULL DEFAULT 'READY_HARVEST'
        CHECK (readiness_status IN ('GROWING', 'READY_HARVEST', 'SCHEDULED', 'HARVESTING', 'IMPACTED', 'COMPLETED')),
    harvest_progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (harvest_progress_pct BETWEEN 0 AND 100),
    season_window TSTZRANGE NOT NULL,
    boundary_geojson JSONB NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. MACHINES (Máy cơ giới — Bản sao số IT/OT Digital Twin)
CREATE TABLE machines (
    machine_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    owner_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    name VARCHAR(255) NOT NULL,
    machine_type VARCHAR(64) NOT NULL DEFAULT 'COMBINE_HARVESTER',
    model VARCHAR(128) NOT NULL DEFAULT 'Kubota DC-70 Plus',
    capacity_ha_per_hr NUMERIC(6,2) NOT NULL CHECK (capacity_ha_per_hr > 0),
    status VARCHAR(32) NOT NULL DEFAULT 'IDLE'
        CHECK (status IN ('IDLE', 'MOVING', 'WORKING', 'BREAKDOWN', 'MAINTENANCE')),
    fuel_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
    health_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
    location_geojson JSONB,
    current_lat DOUBLE PRECISION NOT NULL,
    current_lng DOUBLE PRECISION NOT NULL,
    telemetry_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. OPERATORS (Người vận hành máy)
CREATE TABLE operators (
    operator_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL REFERENCES users(user_id),
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    full_name VARCHAR(255) NOT NULL,
    skills TEXT[] NOT NULL DEFAULT ARRAY['COMBINE_HARVESTER'],
    rating NUMERIC(3,2) NOT NULL DEFAULT 4.8,
    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'ON_SHIFT', 'OFF_DUTY'))
);

-- 6. SERVICE REQUESTS (Yêu cầu dịch vụ thu hoạch từ Nông hộ)
CREATE TABLE service_requests (
    request_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    field_id VARCHAR(64) NOT NULL REFERENCES fields(field_id),
    requester_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    area_ha NUMERIC(8,2) NOT NULL,
    requested_start TIMESTAMPTZ NOT NULL,
    requested_end TIMESTAMPTZ NOT NULL,
    priority VARCHAR(32) NOT NULL DEFAULT 'HIGH',
    status VARCHAR(40) NOT NULL DEFAULT 'PENDING_SCHEDULE'
        CHECK (status IN ('PENDING_SCHEDULE', 'SCHEDULED', 'IN_PROGRESS', 'IMPACTED_BY_INCIDENT', 'RESCHEDULED', 'WAITING_ACCEPTANCE', 'COMPLETED', 'CANCELLED')),
    bpmn_process_id VARCHAR(128),
    correlation_id VARCHAR(64) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (requested_end > requested_start)
);

-- 7. ASSIGNMENTS (Lịch phân công Máy + Người vận hành — Ràng buộc GiST chống trùng lịch)
CREATE TABLE assignments (
    assignment_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    request_id VARCHAR(64) NOT NULL REFERENCES service_requests(request_id),
    field_id VARCHAR(64) NOT NULL REFERENCES fields(field_id),
    machine_id VARCHAR(64) NOT NULL REFERENCES machines(machine_id),
    operator_id VARCHAR(64) NOT NULL REFERENCES operators(operator_id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    time_window TSTZRANGE GENERATED ALWAYS AS (tstzrange(start_time, end_time, '[)')) STORED,
    status VARCHAR(40) NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('CONFIRMED', 'IN_PROGRESS', 'IMPACTED', 'SUPERSEDED', 'COMPLETED', 'CANCELLED')),
    replaces_assignment_id VARCHAR(64) REFERENCES assignments(assignment_id),
    superseded_by_assignment_id VARCHAR(64) REFERENCES assignments(assignment_id),
    bpmn_task_id VARCHAR(128),
    correlation_id VARCHAR(64) NOT NULL,
    created_by VARCHAR(64) NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time),
    -- Time-window exclusion constraint: a machine cannot have two overlapping CONFIRMED/IN_PROGRESS shifts
    EXCLUDE USING gist (
        machine_id WITH =,
        time_window WITH &&
    ) WHERE (status IN ('CONFIRMED', 'IN_PROGRESS')),
    -- Time-window exclusion constraint: an operator cannot have two overlapping CONFIRMED/IN_PROGRESS shifts
    EXCLUDE USING gist (
        operator_id WITH =,
        time_window WITH &&
    ) WHERE (status IN ('CONFIRMED', 'IN_PROGRESS'))
);

-- 8. INCIDENTS & REPAIR TICKETS (Sự cố máy hỏng & Phiếu sửa chữa)
CREATE TABLE incidents (
    incident_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    machine_id VARCHAR(64) NOT NULL REFERENCES machines(machine_id),
    reported_by_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    severity VARCHAR(32) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    incident_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    estimated_downtime_hours NUMERIC(6,2) NOT NULL DEFAULT 24,
    evidence_object_key VARCHAR(512),
    evidence_etag VARCHAR(128),
    repair_ticket_id VARCHAR(64) UNIQUE NOT NULL,
    assigned_repair_user_id VARCHAR(64) REFERENCES users(user_id),
    status VARCHAR(40) NOT NULL DEFAULT 'OPEN_REPLANNING'
        CHECK (status IN ('OPEN_REPLANNING', 'REPLAN_APPROVED', 'UNDER_REPAIR', 'RESOLVED')),
    bpmn_process_id VARCHAR(128),
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. WORK RESULTS & ACCEPTANCE (Biên bản hoàn thành & Nghiệm thu dịch vụ)
CREATE TABLE work_acceptances (
    acceptance_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    assignment_id VARCHAR(64) UNIQUE NOT NULL REFERENCES assignments(assignment_id),
    request_id VARCHAR(64) NOT NULL REFERENCES service_requests(request_id),
    completed_area_ha NUMERIC(8,2) NOT NULL,
    evidence_object_key VARCHAR(512),
    operator_submitted_by VARCHAR(64) NOT NULL REFERENCES users(user_id),
    farmer_confirmed_by VARCHAR(64) REFERENCES users(user_id),
    confirmation_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_FARMER'
        CHECK (confirmation_status IN ('PENDING_FARMER', 'CONFIRMED', 'DISPUTED')),
    notes TEXT,
    correlation_id VARCHAR(64) NOT NULL,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. IMMUTABLE AUDIT LEDGER (Kho Lạnh Bất Biến — SHA-256 Hash Chain & Data Lineage)
CREATE TABLE audit_records (
    seq_no BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(64) UNIQUE NOT NULL,
    organization_id VARCHAR(64) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    action VARCHAR(100) NOT NULL,
    actor_user_id VARCHAR(64) NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    before_state JSONB,
    after_state JSONB,
    prev_hash VARCHAR(64) NOT NULL,
    record_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce append-only immutability on audit_records (Cold Audit Storage)
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Immutable Audit Ledger Violation: UPDATE or DELETE on audit_records is strictly prohibited!';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON audit_records
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) — ĐA THUÊ ƯỚC (MULTI-TENANCY) & FOG OF WAR
-- ============================================================================
ALTER TABLE fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_fields ON fields
    USING (organization_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_machines ON machines
    USING (organization_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_requests ON service_requests
    USING (
        organization_id = current_setting('app.current_org_id', true)
        AND (
            current_setting('app.current_user_role', true) <> 'FARMER'
            OR requester_user_id = current_setting('app.current_user_id', true)
        )
    );

CREATE POLICY tenant_isolation_assignments ON assignments
    USING (organization_id = current_setting('app.current_org_id', true));

CREATE POLICY tenant_isolation_incidents ON incidents
    USING (organization_id = current_setting('app.current_org_id', true));
