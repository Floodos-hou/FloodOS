-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 FloodOS Contributors

-- ============================================================================
-- FLOODOS PLATFORM — MULTI-TENANT DATABASE SCHEMA (single source of truth for DDL)
-- PostgreSQL 16 + btree_gist + GeoJSON JSONB + Row-Level Security (RLS)
-- License: Apache-2.0
-- This file is applied idempotently on EVERY start of the postgres container
-- (infra/db/docker-entrypoint-sync.sh), whether the volume is new or already exists.
-- The Java services never create tables: they only verify that the tables they need exist (fail-fast).
-- Layers:
--   - Platform (domain-neutral): organizations, users, audit_records (hash-chained, append-only)
--   - Application "FloodOS": flood_zones, flood_reports, rescue_teams, rescue_vehicles,
--     dispatch_orders, field_incidents, report_resolutions, safe_shelters, gauge_stations
--   - Multi-tenancy: PostgreSQL Row-Level Security keyed by app.current_org_id / _user_role / _user_id
-- Legacy note: tables of the former rice-harvest prototype (fields, machines, operators, service_requests,
-- assignments, incidents, work_acceptances) are NOT touched or dropped here; nothing reads them any more.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ORGANIZATION (Đơn vị thuê ước / Multi-tenancy)
CREATE TABLE IF NOT EXISTS organizations (
    organization_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    org_type VARCHAR(50) NOT NULL,
    province VARCHAR(100) NOT NULL DEFAULT 'Hà Nội',
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The allowed values changed with the application. NOT VALID keeps rows written by an older version of the
-- platform readable while still enforcing the constraint for every new or updated row.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_org_type_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_org_type_check
    CHECK (org_type IN ('LOCAL_COMMAND')) NOT VALID;

-- 2. USERS & ROLES (Ánh xạ định danh từ Keycloak SSO - Apache-2.0)
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    role VARCHAR(50) NOT NULL,
    keycloak_sub VARCHAR(128) UNIQUE,
    phone VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('REPORTER', 'DISPATCHER', 'FIELD_TEAM', 'RESOURCE_MANAGER', 'PLATFORM_ADMIN')) NOT VALID;

-- 3. FLOOD ZONES (Vùng ảnh hưởng ngập — ranh giới GeoJSON, mức nước kèm NGUỒN)
-- water_level_source says where the number came from; the platform never claims official gauge data.
CREATE TABLE IF NOT EXISTS flood_zones (
    zone_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    name VARCHAR(255) NOT NULL,
    risk_level VARCHAR(16) NOT NULL DEFAULT 'WATCH'
        CHECK (risk_level IN ('NORMAL', 'WATCH', 'WARNING', 'CRITICAL')),
    water_level_cm NUMERIC(6,1) CHECK (water_level_cm IS NULL OR water_level_cm >= 0),
    water_level_source VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN'
        CHECK (water_level_source IN ('UNKNOWN', 'SEED', 'SIMULATOR', 'REPORTED')),
    water_level_updated_at TIMESTAMPTZ,
    boundary_geojson JSONB NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
    center_lng DOUBLE PRECISION NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
    data_origin VARCHAR(16) NOT NULL DEFAULT 'SEED' CHECK (data_origin IN ('SEED', 'SIMULATOR', 'MANUAL')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. RESCUE TEAMS (Đội ứng cứu)
CREATE TABLE IF NOT EXISTS rescue_teams (
    team_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    lead_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    name VARCHAR(255) NOT NULL,
    member_count INTEGER NOT NULL DEFAULT 4 CHECK (member_count > 0),
    skills TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    rating NUMERIC(3,2) NOT NULL DEFAULT 4.5 CHECK (rating BETWEEN 0 AND 5),
    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'ON_MISSION', 'OFF_DUTY'))
);

-- 5. RESCUE VEHICLES (Phương tiện ứng cứu: xuồng, xe gầm cao, máy bơm di động)
CREATE TABLE IF NOT EXISTS rescue_vehicles (
    vehicle_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    manager_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    name VARCHAR(255) NOT NULL,
    vehicle_type VARCHAR(32) NOT NULL
        CHECK (vehicle_type IN ('RESCUE_BOAT', 'HIGH_CLEARANCE_TRUCK', 'MOBILE_PUMP')),
    capacity_value NUMERIC(8,1) NOT NULL CHECK (capacity_value > 0),
    capacity_unit VARCHAR(16) NOT NULL CHECK (capacity_unit IN ('PERSONS', 'M3_PER_HOUR')),
    status VARCHAR(32) NOT NULL DEFAULT 'IDLE'
        CHECK (status IN ('IDLE', 'MOVING', 'WORKING', 'BREAKDOWN', 'MAINTENANCE')),
    fuel_pct NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (fuel_pct BETWEEN 0 AND 100),
    health_pct NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (health_pct BETWEEN 0 AND 100),
    current_lat DOUBLE PRECISION NOT NULL CHECK (current_lat BETWEEN -90 AND 90),
    current_lng DOUBLE PRECISION NOT NULL CHECK (current_lng BETWEEN -180 AND 180),
    assigned_team_id VARCHAR(64) REFERENCES rescue_teams(team_id),
    telemetry_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    telemetry_source VARCHAR(16) NOT NULL DEFAULT 'SEED'
        CHECK (telemetry_source IN ('SEED', 'SIMULATOR', 'DEVICE'))
);

-- 6. FLOOD REPORTS (Tin báo / sự kiện ngập do người dân hoặc điều phối viên ghi nhận)
CREATE TABLE IF NOT EXISTS flood_reports (
    report_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    zone_id VARCHAR(64) NOT NULL REFERENCES flood_zones(zone_id),
    reporter_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    channel VARCHAR(16) NOT NULL DEFAULT 'APP' CHECK (channel IN ('APP', 'PHONE')),
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    depth_cm NUMERIC(6,1) NOT NULL CHECK (depth_cm >= 0),
    need_type VARCHAR(24) NOT NULL
        CHECK (need_type IN ('EVACUATION', 'FOOD_WATER', 'MEDICAL', 'PUMPING', 'ROAD_BLOCKED')),
    people_affected INTEGER NOT NULL DEFAULT 0 CHECK (people_affected >= 0),
    description TEXT,
    priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'VERIFIED', 'REJECTED', 'DISPATCHED', 'IN_PROGRESS', 'IMPACTED',
                          'RESCHEDULED', 'AWAITING_CONFIRMATION', 'RESOLVED')),
    verified_by_user_id VARCHAR(64) REFERENCES users(user_id),
    verification_note TEXT,
    evidence_object_key VARCHAR(255),
    bpmn_process_id VARCHAR(128),
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. DISPATCH ORDERS (Lệnh điều phối: đội + phương tiện + khung giờ; GiST chặn trùng lịch)
CREATE TABLE IF NOT EXISTS dispatch_orders (
    order_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    report_id VARCHAR(64) NOT NULL REFERENCES flood_reports(report_id),
    -- copied from the report when the order is created; lets the RLS policies of dispatch_orders and
    -- flood_reports avoid referring to each other (PostgreSQL rejects recursive policies)
    reporter_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    zone_id VARCHAR(64) NOT NULL REFERENCES flood_zones(zone_id),
    vehicle_id VARCHAR(64) NOT NULL REFERENCES rescue_vehicles(vehicle_id),
    team_id VARCHAR(64) NOT NULL REFERENCES rescue_teams(team_id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    time_window TSTZRANGE GENERATED ALWAYS AS (tstzrange(start_time, end_time, '[)')) STORED,
    status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('CONFIRMED', 'IN_PROGRESS', 'IMPACTED', 'SUPERSEDED', 'COMPLETED', 'CANCELLED')),
    progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
    replaces_order_id VARCHAR(64) REFERENCES dispatch_orders(order_id),
    superseded_by_order_id VARCHAR(64) REFERENCES dispatch_orders(order_id),
    bpmn_task_id VARCHAR(128),
    correlation_id VARCHAR(64) NOT NULL,
    created_by VARCHAR(64) NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time),
    EXCLUDE USING gist (
        vehicle_id WITH =,
        time_window WITH &&
    ) WHERE (status IN ('CONFIRMED', 'IN_PROGRESS')),
    EXCLUDE USING gist (
        team_id WITH =,
        time_window WITH &&
    ) WHERE (status IN ('CONFIRMED', 'IN_PROGRESS'))
);

-- 8. FIELD INCIDENTS (Sự cố hiện trường làm đứt gãy lệnh điều phối)
CREATE TABLE IF NOT EXISTS field_incidents (
    incident_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    vehicle_id VARCHAR(64) NOT NULL REFERENCES rescue_vehicles(vehicle_id),
    reported_by_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('MINOR', 'MAJOR', 'CRITICAL')),
    incident_type VARCHAR(32) NOT NULL
        CHECK (incident_type IN ('ENGINE_FAILURE', 'PROPELLER_FOULED', 'PUMP_CLOGGED', 'ROUTE_BLOCKED', 'OTHER')),
    description TEXT,
    estimated_downtime_hours NUMERIC(6,1) NOT NULL DEFAULT 0 CHECK (estimated_downtime_hours >= 0),
    evidence_object_key VARCHAR(255),
    evidence_etag VARCHAR(128),
    repair_ticket_id VARCHAR(64),
    assigned_repair_user_id VARCHAR(64) REFERENCES users(user_id),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN_REPLANNING'
        CHECK (status IN ('OPEN_REPLANNING', 'REPLAN_APPROVED', 'UNDER_REPAIR', 'RESOLVED')),
    bpmn_process_id VARCHAR(128),
    impacted_order_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    candidate_options JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_option JSONB,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. REPORT RESOLUTIONS (Kết quả xử lý hiện trường và xác nhận hoàn tất)
CREATE TABLE IF NOT EXISTS report_resolutions (
    resolution_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    report_id VARCHAR(64) NOT NULL REFERENCES flood_reports(report_id),
    order_id VARCHAR(64) NOT NULL REFERENCES dispatch_orders(order_id),
    outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('RESOLVED', 'PARTIAL', 'UNRESOLVED')),
    final_depth_cm NUMERIC(6,1) CHECK (final_depth_cm IS NULL OR final_depth_cm >= 0),
    evidence_object_key VARCHAR(255),
    field_submitted_by VARCHAR(64) NOT NULL REFERENCES users(user_id),
    confirmed_by VARCHAR(64) REFERENCES users(user_id),
    confirmation_status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (confirmation_status IN ('PENDING', 'CONFIRMED', 'DISPUTED')),
    notes TEXT,
    correlation_id VARCHAR(64) NOT NULL,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. SAFE SHELTERS (Điểm trú an toàn). occupancy_source says whether the headcount is a seed value or reported.
CREATE TABLE IF NOT EXISTS safe_shelters (
    shelter_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    name VARCHAR(255) NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    occupancy INTEGER NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
    occupancy_source VARCHAR(16) NOT NULL DEFAULT 'SEED' CHECK (occupancy_source IN ('SEED', 'REPORTED')),
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FULL', 'CLOSED')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (occupancy <= capacity)
);

-- 11. GAUGE STATIONS (Trạm đo mực nước). In this repository every station is a SIMULATOR source:
-- no physical or official gauge is connected.
CREATE TABLE IF NOT EXISTS gauge_stations (
    station_id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
    zone_id VARCHAR(64) NOT NULL REFERENCES flood_zones(zone_id),
    name VARCHAR(255) NOT NULL,
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    warn_level_cm NUMERIC(6,1) NOT NULL CHECK (warn_level_cm > 0),
    critical_level_cm NUMERIC(6,1) NOT NULL CHECK (critical_level_cm > 0),
    level_cm NUMERIC(6,1) CHECK (level_cm IS NULL OR level_cm >= 0),
    level_updated_at TIMESTAMPTZ,
    source VARCHAR(16) NOT NULL DEFAULT 'SIMULATOR' CHECK (source IN ('SIMULATOR', 'DEVICE')),
    CHECK (critical_level_cm >= warn_level_cm)
);

-- 10. IMMUTABLE AUDIT LEDGER (Kho Lạnh Bất Biến — SHA-256 Hash Chain & Data Lineage)
CREATE TABLE IF NOT EXISTS audit_records (
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

-- Exact material that went into each record hash, so a chain can be re-verified after a restart:
-- JSONB re-formats text and created_at is the INSERT time, neither can reproduce the hashed bytes.
-- A ledger "epoch" (new one after every simulator reset) is an independent chain starting at genesis, so
-- event ids are unique per epoch rather than globally. Rows from before this upgrade have a NULL epoch and
-- stay in the table as unverifiable history; they are not loaded into the live chain.
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS ledger_epoch VARCHAR(40);
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS ledger_seq INTEGER;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS ledger_ts VARCHAR(40);
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS before_canonical TEXT;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS after_canonical TEXT;
ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS gateway_status INTEGER;
ALTER TABLE audit_records DROP CONSTRAINT IF EXISTS audit_records_event_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_epoch_event ON audit_records (ledger_epoch, event_id);

-- Enforce append-only immutability on audit_records (Cold Audit Storage)
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Immutable Audit Ledger Violation: UPDATE or DELETE on audit_records is strictly prohibited!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_records;
CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON audit_records
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) — ĐA THUÊ ƯỚC (MULTI-TENANCY) & PHẠM VI THEO VAI TRÒ
-- ============================================================================
-- Session context set by the Java services for every statement (TenantRlsContext.applyPostgresRlsSession):
--   app.current_org_id, app.current_user_role, app.current_user_id
-- A missing or unknown context matches NO row: current_setting(..., true) is NULL/'' and every comparison below is
-- then false/NULL, so the default is "deny", never "allow".
-- Enable and FORCE RLS on ALL tables so the policies also bind the table owner.
ALTER TABLE flood_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE flood_zones FORCE ROW LEVEL SECURITY;
ALTER TABLE rescue_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE rescue_teams FORCE ROW LEVEL SECURITY;
ALTER TABLE rescue_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rescue_vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE flood_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE flood_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE dispatch_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE field_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE report_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_resolutions FORCE ROW LEVEL SECURITY;
ALTER TABLE safe_shelters ENABLE ROW LEVEL SECURITY;
ALTER TABLE safe_shelters FORCE ROW LEVEL SECURITY;
ALTER TABLE gauge_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gauge_stations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_records FORCE ROW LEVEL SECURITY;

-- Policies (idempotent: DROP before CREATE). The reporter (REPORTER) only ever sees rows tied to their own reports.

-- Reporter sees only zones where they filed a report; every other role sees the zones of its own organization.
DROP POLICY IF EXISTS tenant_isolation_zones ON flood_zones;
CREATE POLICY tenant_isolation_zones ON flood_zones
    USING (
        current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
        OR (
            organization_id = current_setting('app.current_org_id', true)
            AND (
                current_setting('app.current_user_role', true) IN ('DISPATCHER', 'RESOURCE_MANAGER', 'FIELD_TEAM')
                OR (
                    current_setting('app.current_user_role', true) = 'REPORTER'
                    AND EXISTS (
                        SELECT 1 FROM flood_reports r
                        WHERE r.zone_id = flood_zones.zone_id
                          AND r.reporter_user_id = current_setting('app.current_user_id', true)
                    )
                )
            )
        )
    );

-- A field team sees only the team it leads.
DROP POLICY IF EXISTS tenant_isolation_teams ON rescue_teams;
CREATE POLICY tenant_isolation_teams ON rescue_teams
    USING (
        current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
        OR (
            organization_id = current_setting('app.current_org_id', true)
            AND (
                current_setting('app.current_user_role', true) IN ('DISPATCHER', 'RESOURCE_MANAGER')
                OR (
                    current_setting('app.current_user_role', true) = 'FIELD_TEAM'
                    AND lead_user_id = current_setting('app.current_user_id', true)
                )
            )
        )
    );

-- Dispatcher and resource manager see the fleet; a field team sees the vehicles of its team and those on its own active orders;
-- a reporter sees only a vehicle that is currently committed to one of their own reports.
DROP POLICY IF EXISTS tenant_isolation_vehicles ON rescue_vehicles;
CREATE POLICY tenant_isolation_vehicles ON rescue_vehicles
    USING (
        current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
        OR (
            organization_id = current_setting('app.current_org_id', true)
            AND (
                current_setting('app.current_user_role', true) IN ('DISPATCHER', 'RESOURCE_MANAGER')
                OR (
                    current_setting('app.current_user_role', true) = 'FIELD_TEAM'
                    AND (
                        EXISTS (
                            SELECT 1 FROM rescue_teams t
                            WHERE t.team_id = rescue_vehicles.assigned_team_id
                              AND t.lead_user_id = current_setting('app.current_user_id', true)
                        )
                        OR EXISTS (
                            SELECT 1 FROM dispatch_orders o
                            JOIN rescue_teams t2 ON t2.team_id = o.team_id
                            WHERE o.vehicle_id = rescue_vehicles.vehicle_id
                              AND o.status IN ('CONFIRMED', 'IN_PROGRESS')
                              AND t2.lead_user_id = current_setting('app.current_user_id', true)
                        )
                    )
                )
                OR (
                    current_setting('app.current_user_role', true) = 'REPORTER'
                    AND EXISTS (
                        SELECT 1 FROM dispatch_orders o
                        WHERE o.vehicle_id = rescue_vehicles.vehicle_id
                          AND o.status IN ('CONFIRMED', 'IN_PROGRESS')
                          AND o.reporter_user_id = current_setting('app.current_user_id', true)
                    )
                )
            )
        )
    );

DROP POLICY IF EXISTS tenant_isolation_reports ON flood_reports;
CREATE POLICY tenant_isolation_reports ON flood_reports
    USING (
        current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
        OR (
            organization_id = current_setting('app.current_org_id', true)
            AND (
                current_setting('app.current_user_role', true) = 'DISPATCHER'
                OR (
                    current_setting('app.current_user_role', true) = 'REPORTER'
                    AND reporter_user_id = current_setting('app.current_user_id', true)
                )
                OR (
                    current_setting('app.current_user_role', true) = 'FIELD_TEAM'
                    AND EXISTS (
                        SELECT 1 FROM dispatch_orders o
                        WHERE o.report_id = flood_reports.report_id
                    )
                )
            )
        )
    );

DROP POLICY IF EXISTS tenant_isolation_orders ON dispatch_orders;
CREATE POLICY tenant_isolation_orders ON dispatch_orders
    USING (
        current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
        OR (
            organization_id = current_setting('app.current_org_id', true)
            AND (
                current_setting('app.current_user_role', true) IN ('DISPATCHER', 'RESOURCE_MANAGER')
                OR (
                    current_setting('app.current_user_role', true) = 'FIELD_TEAM'
                    AND EXISTS (
                        SELECT 1 FROM rescue_teams t
                        WHERE t.team_id = dispatch_orders.team_id
                          AND t.lead_user_id = current_setting('app.current_user_id', true)
                    )
                )
                OR (
                    current_setting('app.current_user_role', true) = 'REPORTER'
                    AND reporter_user_id = current_setting('app.current_user_id', true)
                )
            )
        )
    );

-- Incidents are operational: a reporter never sees them (the report status shows the effect).
DROP POLICY IF EXISTS tenant_isolation_incidents ON field_incidents;
CREATE POLICY tenant_isolation_incidents ON field_incidents
    USING (
        current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
        OR (
            organization_id = current_setting('app.current_org_id', true)
            AND (
                current_setting('app.current_user_role', true) IN ('DISPATCHER', 'RESOURCE_MANAGER')
                OR (
                    current_setting('app.current_user_role', true) = 'FIELD_TEAM'
                    AND reported_by_user_id = current_setting('app.current_user_id', true)
                )
            )
        )
    );

DROP POLICY IF EXISTS tenant_isolation_resolutions ON report_resolutions;
CREATE POLICY tenant_isolation_resolutions ON report_resolutions
    USING (
        current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
        OR (
            organization_id = current_setting('app.current_org_id', true)
            AND (
                current_setting('app.current_user_role', true) = 'DISPATCHER'
                OR (
                    current_setting('app.current_user_role', true) = 'FIELD_TEAM'
                    AND field_submitted_by = current_setting('app.current_user_id', true)
                )
                OR (
                    current_setting('app.current_user_role', true) = 'REPORTER'
                    AND EXISTS (
                        SELECT 1 FROM flood_reports r
                        WHERE r.report_id = report_resolutions.report_id
                          AND r.reporter_user_id = current_setting('app.current_user_id', true)
                    )
                )
            )
        )
    );

-- Shelters and gauge stations are public-safety information: every role of the organization may read them.
DROP POLICY IF EXISTS tenant_isolation_shelters ON safe_shelters;
CREATE POLICY tenant_isolation_shelters ON safe_shelters
    USING (
        organization_id = current_setting('app.current_org_id', true)
        OR current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
    );

DROP POLICY IF EXISTS tenant_isolation_gauges ON gauge_stations;
CREATE POLICY tenant_isolation_gauges ON gauge_stations
    USING (
        organization_id = current_setting('app.current_org_id', true)
        OR current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
    );

DROP POLICY IF EXISTS tenant_isolation_audit ON audit_records;
CREATE POLICY tenant_isolation_audit ON audit_records
    USING (
        organization_id = current_setting('app.current_org_id', true)
        OR current_setting('app.current_user_role', true) = 'PLATFORM_ADMIN'
    );

-- ============================================================================
-- APPLICATION ROLE PERMISSION HARMONIZATION (NON-SUPERUSER & NOBYPASSRLS)
-- Role credentials are dynamically provisioned by infra/db/init-db.sh.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'floodos_app') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA public TO floodos_app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO floodos_app';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO floodos_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO floodos_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO floodos_app';
    END IF;
END $$;

-- Demo data (organizations, users, zones, vehicles, ...) is NOT seeded here. The core API seeds it from
-- apps/floodos/FloodDataStore when the database is empty; identities come from infra/keycloak/floodos-realm.json.
-- A unit test keeps those two lists identical.
