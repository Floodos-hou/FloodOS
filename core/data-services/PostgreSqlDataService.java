// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.dataservices;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.*;

/**
 * PostgreSQL 16 + Row-Level Security (RLS) Database Service.
 * Manages JDBC connections, executes multi-tenant session RLS policies
 * (SET LOCAL app.current_org_id = ?; SET LOCAL app.current_user_role = ?;),
 * and provides persistent table synchronization for organizations, users, fields,
 * machines, operators, service requests, assignments, incidents, work acceptances,
 * and immutable audit records.
 *
 * Fully synchronized with infra/db/schema.sql.
 */
public final class PostgreSqlDataService {

    private final String dbUrl;
    private final String dbUser;
    private final String dbPassword;
    private boolean driverAvailable = false;

    public PostgreSqlDataService() {
        this(
                System.getenv().getOrDefault("DATABASE_URL", ""),
                System.getenv().getOrDefault("POSTGRES_USER", "openagrios"),
                System.getenv().getOrDefault("POSTGRES_PASSWORD", "openagrios_dev_only")
        );
    }

    public PostgreSqlDataService(String dbUrl, String dbUser, String dbPassword) {
        this.dbUrl = dbUrl != null ? dbUrl.trim() : "";
        this.dbUser = dbUser != null ? dbUser.trim() : "openagrios";
        this.dbPassword = dbPassword != null ? dbPassword.trim() : "openagrios_dev_only";

        try {
            Class.forName("org.postgresql.Driver");
            this.driverAvailable = true;
        } catch (ClassNotFoundException e) {
            this.driverAvailable = false;
        }
    }

    public boolean isConfigured() {
        return !dbUrl.isEmpty();
    }

    public boolean isDriverAvailable() {
        return driverAvailable;
    }

    public String getDbUrl() {
        return dbUrl;
    }

    /**
     * Checks if a live JDBC connection can be established to PostgreSQL.
     */
    public boolean isConnectionLive() {
        if (!driverAvailable || dbUrl.isEmpty()) {
            return false;
        }
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
             Statement stmt = conn.createStatement()) {
            stmt.setQueryTimeout(2);
            try (ResultSet rs = stmt.executeQuery("SELECT 1")) {
                return rs.next();
            }
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Initializes relational schema tables and Row-Level Security matching infra/db/schema.sql.
     */
    public boolean initSchema() {
        if (!isConnectionLive()) {
            return false;
        }
        String ddl = """
            CREATE TABLE IF NOT EXISTS organizations (
                organization_id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                org_type VARCHAR(50) NOT NULL,
                province VARCHAR(100) NOT NULL DEFAULT 'Cần Thơ',
                status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

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

            CREATE TABLE IF NOT EXISTS fields (
                field_id VARCHAR(64) PRIMARY KEY,
                organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
                owner_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
                name VARCHAR(255) NOT NULL,
                hamlet VARCHAR(255) NOT NULL,
                crop VARCHAR(100) NOT NULL DEFAULT 'Lúa Đông Xuân (OM18)',
                area_ha NUMERIC(8,2) NOT NULL,
                readiness_status VARCHAR(32) NOT NULL DEFAULT 'READY_HARVEST',
                harvest_progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
                season_window TSTZRANGE,
                boundary_geojson JSONB,
                center_lat DOUBLE PRECISION NOT NULL,
                center_lng DOUBLE PRECISION NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS machines (
                machine_id VARCHAR(64) PRIMARY KEY,
                organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
                owner_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
                name VARCHAR(255) NOT NULL,
                machine_type VARCHAR(64) NOT NULL DEFAULT 'COMBINE_HARVESTER',
                model VARCHAR(128) NOT NULL,
                capacity_ha_per_hr NUMERIC(6,2) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'IDLE',
                fuel_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
                health_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
                location_geojson JSONB,
                current_lat DOUBLE PRECISION NOT NULL,
                current_lng DOUBLE PRECISION NOT NULL,
                telemetry_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS operators (
                operator_id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(64) UNIQUE NOT NULL REFERENCES users(user_id),
                organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
                full_name VARCHAR(255) NOT NULL,
                skills TEXT[] NOT NULL DEFAULT ARRAY['COMBINE_HARVESTER'],
                rating NUMERIC(3,2) NOT NULL DEFAULT 4.8,
                status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE'
            );

            CREATE TABLE IF NOT EXISTS service_requests (
                request_id VARCHAR(64) PRIMARY KEY,
                organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
                field_id VARCHAR(64) NOT NULL REFERENCES fields(field_id),
                requester_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
                area_ha NUMERIC(8,2) NOT NULL,
                requested_start TIMESTAMPTZ NOT NULL,
                requested_end TIMESTAMPTZ NOT NULL,
                priority VARCHAR(32) NOT NULL DEFAULT 'HIGH',
                status VARCHAR(40) NOT NULL DEFAULT 'PENDING_SCHEDULE',
                bpmn_process_id VARCHAR(128),
                correlation_id VARCHAR(64) NOT NULL,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS assignments (
                assignment_id VARCHAR(64) PRIMARY KEY,
                organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
                request_id VARCHAR(64) NOT NULL REFERENCES service_requests(request_id),
                field_id VARCHAR(64) NOT NULL REFERENCES fields(field_id),
                machine_id VARCHAR(64) NOT NULL REFERENCES machines(machine_id),
                operator_id VARCHAR(64) REFERENCES operators(operator_id),
                start_time TIMESTAMPTZ NOT NULL,
                end_time TIMESTAMPTZ NOT NULL,
                status VARCHAR(40) NOT NULL DEFAULT 'CONFIRMED',
                replaces_assignment_id VARCHAR(64),
                superseded_by_assignment_id VARCHAR(64),
                bpmn_task_id VARCHAR(128),
                correlation_id VARCHAR(64) NOT NULL,
                created_by VARCHAR(64) NOT NULL REFERENCES users(user_id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS incidents (
                incident_id VARCHAR(64) PRIMARY KEY,
                organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
                machine_id VARCHAR(64) NOT NULL REFERENCES machines(machine_id),
                reported_by_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
                severity VARCHAR(32) NOT NULL,
                incident_type VARCHAR(100) NOT NULL,
                description TEXT NOT NULL,
                estimated_downtime_hours NUMERIC(6,2) NOT NULL DEFAULT 24,
                evidence_object_key VARCHAR(512),
                evidence_etag VARCHAR(128),
                repair_ticket_id VARCHAR(64) UNIQUE,
                assigned_repair_user_id VARCHAR(64) REFERENCES users(user_id),
                status VARCHAR(40) NOT NULL DEFAULT 'OPEN_REPLANNING',
                bpmn_process_id VARCHAR(128),
                correlation_id VARCHAR(64) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS work_acceptances (
                acceptance_id VARCHAR(64) PRIMARY KEY,
                organization_id VARCHAR(64) NOT NULL REFERENCES organizations(organization_id),
                assignment_id VARCHAR(64) UNIQUE NOT NULL REFERENCES assignments(assignment_id),
                request_id VARCHAR(64) NOT NULL REFERENCES service_requests(request_id),
                completed_area_ha NUMERIC(8,2) NOT NULL,
                evidence_object_key VARCHAR(512),
                operator_submitted_by VARCHAR(64) NOT NULL REFERENCES users(user_id),
                farmer_confirmed_by VARCHAR(64) REFERENCES users(user_id),
                confirmation_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_FARMER',
                notes TEXT,
                correlation_id VARCHAR(64) NOT NULL,
                confirmed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

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

            ALTER TABLE fields ENABLE ROW LEVEL SECURITY;
            ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
            ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
            ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
            ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
            ALTER TABLE audit_records ENABLE ROW LEVEL SECURITY;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
             Statement stmt = conn.createStatement()) {
            stmt.execute(ddl);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Sets PostgreSQL multi-tenant session parameters and verifies RLS compilation.
     */
    public Map<String, Object> testConnectionAndApplyRls(String orgId, String role) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("database_url", dbUrl);
        result.put("driver_available", driverAvailable);
        result.put("target_org_id", orgId);
        result.put("target_role", role);

        String rlsSql = String.format(
                "SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                orgId.replace("'", "''"), role.replace("'", "''")
        );
        result.put("compiled_rls_sql", rlsSql);

        if (!driverAvailable || dbUrl.isEmpty()) {
            result.put("status", "STANDALONE_DEV_MOCK");
            result.put("notice", "PostgreSQL JDBC driver not loaded or DATABASE_URL not set. Running in zero-dependency in-memory mode with compiled RLS policy.");
            return result;
        }

        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
             Statement stmt = conn.createStatement()) {
            stmt.execute(rlsSql);
            result.put("status", "CONNECTED_POSTGRESQL_RLS");
            result.put("rls_applied", true);
        } catch (Exception e) {
            result.put("status", "CONNECTION_ERROR");
            result.put("error", e.getMessage());
        }

        return result;
    }

    /**
     * Persists cooperative organization.
     */
    public boolean syncOrganization(String orgId, String name, String orgType, String province, String status) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO organizations (organization_id, name, org_type, province, status)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (organization_id) DO UPDATE SET
                name = EXCLUDED.name,
                org_type = EXCLUDED.org_type,
                province = EXCLUDED.province,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, orgId);
            ps.setString(2, name);
            ps.setString(3, orgType);
            ps.setString(4, province != null ? province : "Cần Thơ");
            ps.setString(5, status != null ? status : "ACTIVE");
            ps.executeUpdate();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists user account.
     */
    public boolean syncUser(String userId, String username, String fullName, String orgId, String role, String phone, String status) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO users (user_id, username, full_name, organization_id, role, phone, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
                username = EXCLUDED.username,
                full_name = EXCLUDED.full_name,
                organization_id = EXCLUDED.organization_id,
                role = EXCLUDED.role,
                phone = EXCLUDED.phone,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, userId);
            ps.setString(2, username);
            ps.setString(3, fullName);
            ps.setString(4, orgId);
            ps.setString(5, role);
            ps.setString(6, phone != null ? phone : "");
            ps.setString(7, status != null ? status : "ACTIVE");
            ps.executeUpdate();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists field entity with tenant RLS isolation and column names matching schema.sql.
     */
    public boolean syncField(
            String orgId, String role, String fieldId, String ownerUserId, String name,
            String hamlet, String crop, double areaHa, String readinessStatus,
            double harvestProgressPct, double centerLat, double centerLng,
            String boundaryGeoJson
    ) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO fields (
                field_id, organization_id, owner_user_id, name, hamlet, crop,
                area_ha, readiness_status, harvest_progress_pct, center_lat, center_lng, boundary_geojson
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB))
            ON CONFLICT (field_id) DO UPDATE SET
                name = EXCLUDED.name,
                hamlet = EXCLUDED.hamlet,
                crop = EXCLUDED.crop,
                area_ha = EXCLUDED.area_ha,
                readiness_status = EXCLUDED.readiness_status,
                harvest_progress_pct = EXCLUDED.harvest_progress_pct,
                center_lat = EXCLUDED.center_lat,
                center_lng = EXCLUDED.center_lng,
                boundary_geojson = EXCLUDED.boundary_geojson,
                updated_at = NOW();
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, fieldId);
                ps.setString(2, orgId);
                ps.setString(3, ownerUserId);
                ps.setString(4, name);
                ps.setString(5, hamlet != null ? hamlet : "");
                ps.setString(6, crop != null ? crop : "Lúa Đông Xuân");
                ps.setDouble(7, areaHa);
                ps.setString(8, readinessStatus != null ? readinessStatus : "READY_HARVEST");
                ps.setDouble(9, harvestProgressPct);
                ps.setDouble(10, centerLat);
                ps.setDouble(11, centerLng);
                ps.setString(12, (boundaryGeoJson != null && !boundaryGeoJson.isBlank()) ? boundaryGeoJson : "{}");
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists machine entity with tenant RLS isolation and column names matching schema.sql.
     */
    public boolean syncMachine(
            String orgId, String role, String machineId, String ownerUserId, String name,
            String machineType, String model, double capacityHaPerHr, String status,
            double fuelPct, double healthPct, double currentLat, double currentLng
    ) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO machines (
                machine_id, organization_id, owner_user_id, name, machine_type,
                model, capacity_ha_per_hr, status, fuel_pct, health_pct, current_lat, current_lng
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (machine_id) DO UPDATE SET
                name = EXCLUDED.name,
                machine_type = EXCLUDED.machine_type,
                model = EXCLUDED.model,
                capacity_ha_per_hr = EXCLUDED.capacity_ha_per_hr,
                status = EXCLUDED.status,
                fuel_pct = EXCLUDED.fuel_pct,
                health_pct = EXCLUDED.health_pct,
                current_lat = EXCLUDED.current_lat,
                current_lng = EXCLUDED.current_lng,
                telemetry_updated_at = NOW();
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, machineId);
                ps.setString(2, orgId);
                ps.setString(3, ownerUserId);
                ps.setString(4, name);
                ps.setString(5, machineType != null ? machineType : "COMBINE_HARVESTER");
                ps.setString(6, model != null ? model : "Kubota DC-70 Plus");
                ps.setDouble(7, capacityHaPerHr);
                ps.setString(8, status != null ? status : "IDLE");
                ps.setDouble(9, fuelPct);
                ps.setDouble(10, healthPct);
                ps.setDouble(11, currentLat);
                ps.setDouble(12, currentLng);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists operator entity.
     */
    public boolean syncOperator(String orgId, String role, String operatorId, String userId, String fullName, double rating, String status) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO operators (operator_id, user_id, organization_id, full_name, rating, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (operator_id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                rating = EXCLUDED.rating,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, operatorId);
            ps.setString(2, userId);
            ps.setString(3, orgId);
            ps.setString(4, fullName);
            ps.setDouble(5, rating);
            ps.setString(6, status != null ? status : "AVAILABLE");
            ps.executeUpdate();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists service request with tenant RLS isolation and column names matching schema.sql.
     */
    public boolean syncServiceRequest(
            String orgId, String role, String requestId, String fieldId, String requesterUserId,
            double areaHa, String reqStart, String reqEnd, String priority, String status,
            String bpmnProcessId, String correlationId, String notes
    ) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO service_requests (
                request_id, organization_id, field_id, requester_user_id, area_ha,
                requested_start, requested_end, priority, status, bpmn_process_id,
                correlation_id, notes
            ) VALUES (?, ?, ?, ?, ?, ?::TIMESTAMPTZ, ?::TIMESTAMPTZ, ?, ?, ?, ?, ?)
            ON CONFLICT (request_id) DO UPDATE SET
                field_id = EXCLUDED.field_id,
                area_ha = EXCLUDED.area_ha,
                requested_start = EXCLUDED.requested_start,
                requested_end = EXCLUDED.requested_end,
                priority = EXCLUDED.priority,
                status = EXCLUDED.status,
                bpmn_process_id = EXCLUDED.bpmn_process_id,
                correlation_id = EXCLUDED.correlation_id,
                notes = EXCLUDED.notes,
                updated_at = NOW();
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, requestId);
                ps.setString(2, orgId);
                ps.setString(3, fieldId);
                ps.setString(4, requesterUserId);
                ps.setDouble(5, areaHa);
                ps.setString(6, reqStart);
                ps.setString(7, reqEnd);
                ps.setString(8, priority != null ? priority : "NORMAL");
                ps.setString(9, status != null ? status : "PENDING_SCHEDULE");
                ps.setString(10, bpmnProcessId);
                ps.setString(11, correlationId);
                ps.setString(12, notes);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists assignment entity (matching table 'assignments' in schema.sql).
     */
    public boolean syncAssignment(
            String orgId, String role, String assignmentId, String requestId, String fieldId,
            String machineId, String operatorId, String startTime, String endTime,
            String status, String replacesId, String supersededById, String bpmnTaskId,
            String correlationId, String createdBy
    ) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO assignments (
                assignment_id, organization_id, request_id, field_id, machine_id, operator_id,
                start_time, end_time, status, replaces_assignment_id, superseded_by_assignment_id,
                bpmn_task_id, correlation_id, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?::TIMESTAMPTZ, ?::TIMESTAMPTZ, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (assignment_id) DO UPDATE SET
                status = EXCLUDED.status,
                replaces_assignment_id = EXCLUDED.replaces_assignment_id,
                superseded_by_assignment_id = EXCLUDED.superseded_by_assignment_id,
                operator_id = EXCLUDED.operator_id;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, assignmentId);
                ps.setString(2, orgId);
                ps.setString(3, requestId);
                ps.setString(4, fieldId);
                ps.setString(5, machineId);
                ps.setString(6, operatorId);
                ps.setString(7, startTime);
                ps.setString(8, endTime);
                ps.setString(9, status != null ? status : "CONFIRMED");
                ps.setString(10, replacesId);
                ps.setString(11, supersededById);
                ps.setString(12, bpmnTaskId);
                ps.setString(13, correlationId);
                ps.setString(14, createdBy != null ? createdBy : "usr_coord_01");
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists incident record with tenant RLS isolation and column names matching schema.sql.
     */
    public boolean syncIncident(
            String orgId, String role, String incidentId, String machineId, String reportedByUserId,
            String severity, String incidentType, String description, double downtimeHours,
            String evidenceObjectKey, String evidenceEtag, String repairTicketId,
            String assignedRepairUserId, String status, String bpmnProcessId, String correlationId
    ) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO incidents (
                incident_id, organization_id, machine_id, reported_by_user_id, severity,
                incident_type, description, estimated_downtime_hours, evidence_object_key,
                evidence_etag, repair_ticket_id, assigned_repair_user_id, status,
                bpmn_process_id, correlation_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (incident_id) DO UPDATE SET
                severity = EXCLUDED.severity,
                description = EXCLUDED.description,
                estimated_downtime_hours = EXCLUDED.estimated_downtime_hours,
                evidence_object_key = EXCLUDED.evidence_object_key,
                evidence_etag = EXCLUDED.evidence_etag,
                repair_ticket_id = EXCLUDED.repair_ticket_id,
                assigned_repair_user_id = EXCLUDED.assigned_repair_user_id,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, incidentId);
                ps.setString(2, orgId);
                ps.setString(3, machineId);
                ps.setString(4, reportedByUserId);
                ps.setString(5, severity != null ? severity : "HIGH");
                ps.setString(6, incidentType != null ? incidentType : "MECHANICAL_FAILURE");
                ps.setString(7, description != null ? description : "");
                ps.setDouble(8, downtimeHours);
                ps.setString(9, evidenceObjectKey);
                ps.setString(10, evidenceEtag);
                ps.setString(11, repairTicketId);
                ps.setString(12, assignedRepairUserId);
                ps.setString(13, status != null ? status : "OPEN_REPLANNING");
                ps.setString(14, bpmnProcessId);
                ps.setString(15, correlationId);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists work acceptance record with tenant RLS isolation and column names matching schema.sql.
     */
    public boolean syncWorkAcceptance(
            String orgId, String role, String acceptanceId, String assignmentId, String requestId,
            double completedAreaHa, String evidenceObjectKey, String operatorSubmittedBy,
            String farmerConfirmedBy, String confirmationStatus, String notes, String correlationId
    ) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO work_acceptances (
                acceptance_id, organization_id, assignment_id, request_id, completed_area_ha,
                evidence_object_key, operator_submitted_by, farmer_confirmed_by,
                confirmation_status, notes, correlation_id, confirmed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON CONFLICT (acceptance_id) DO UPDATE SET
                completed_area_ha = EXCLUDED.completed_area_ha,
                farmer_confirmed_by = EXCLUDED.farmer_confirmed_by,
                confirmation_status = EXCLUDED.confirmation_status,
                notes = EXCLUDED.notes,
                confirmed_at = NOW();
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, acceptanceId);
                ps.setString(2, orgId);
                ps.setString(3, assignmentId);
                ps.setString(4, requestId);
                ps.setDouble(5, completedAreaHa);
                ps.setString(6, evidenceObjectKey);
                ps.setString(7, operatorSubmittedBy);
                ps.setString(8, farmerConfirmedBy);
                ps.setString(9, confirmationStatus != null ? confirmationStatus : "CONFIRMED");
                ps.setString(10, notes);
                ps.setString(11, correlationId);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists audit record (matching table 'audit_records' in schema.sql).
     */
    public boolean syncAuditRecord(
            String orgId, String role, String eventId, String correlationId, String entityType,
            String entityId, String action, String actorUserId, String actorRole,
            String beforeStateJson, String afterStateJson, String prevHash, String recordHash
    ) {
        if (!isConnectionLive()) return false;
        String sql = """
            INSERT INTO audit_records (
                event_id, organization_id, correlation_id, entity_type, entity_id,
                action, actor_user_id, actor_role, before_state, after_state,
                prev_hash, record_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), CAST(? AS JSONB), ?, ?)
            ON CONFLICT (event_id) DO NOTHING;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, eventId);
                ps.setString(2, orgId);
                ps.setString(3, correlationId != null ? correlationId : "CORR-AUDIT");
                ps.setString(4, entityType != null ? entityType : "System");
                ps.setString(5, entityId != null ? entityId : "SYS-001");
                ps.setString(6, action);
                ps.setString(7, actorUserId != null ? actorUserId : "system");
                ps.setString(8, actorRole != null ? actorRole : "COORDINATOR");
                ps.setString(9, (beforeStateJson != null && !beforeStateJson.isBlank()) ? beforeStateJson : "{}");
                ps.setString(10, (afterStateJson != null && !afterStateJson.isBlank()) ? afterStateJson : "{}");
                ps.setString(11, prevHash != null ? prevHash : "0000000000000000000000000000000000000000000000000000000000000000");
                ps.setString(12, recordHash);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Executes query with tenant RLS policy applied and returns rows.
     */
    public List<Map<String, Object>> queryWithRls(String orgId, String role, String tableName) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (!isConnectionLive()) return rows;

        // Whitelist table names to prevent SQL injection
        Set<String> allowedTables = Set.of(
                "fields", "machines", "operators", "service_requests",
                "assignments", "incidents", "work_acceptances", "audit_records"
        );
        if (!allowedTables.contains(tableName.toLowerCase(Locale.ROOT))) {
            throw new IllegalArgumentException("Disallowed table name: " + tableName);
        }

        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (Statement s = conn.createStatement();
                 ResultSet rs = s.executeQuery("SELECT * FROM " + tableName)) {
                var meta = rs.getMetaData();
                int colCount = meta.getColumnCount();
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (int i = 1; i <= colCount; i++) {
                        row.put(meta.getColumnName(i), rs.getObject(i));
                    }
                    rows.add(row);
                }
            }
            conn.commit();
        } catch (Exception e) {
            // Returns partial or empty on error
        }
        return rows;
    }

    /**
     * Legacy backward-compatibility adapters.
     */
    public boolean syncField(String orgId, String role, String id, String name, double areaHa, double lat, double lon, String cropType, String status) {
        return syncField(orgId, role, id, "usr_farmer_ba", name, "", cropType, areaHa, status, 0.0, lat, lon, "{}");
    }

    public boolean syncMachine(String orgId, String role, String id, String model, double capacityHaH, double lat, double lon, String status) {
        return syncMachine(orgId, role, id, "usr_owner_tu", "Máy Gặt " + id, "COMBINE_HARVESTER", model, capacityHaH, status, 100.0, 100.0, lat, lon);
    }

    public boolean syncShift(String orgId, String role, String id, String fieldId, String machineId, String operatorId, String status) {
        return syncAssignment(orgId, role, id, "REQ-01", fieldId, machineId, operatorId, "2026-11-20T07:00:00Z", "2026-11-20T12:00:00Z", status, null, null, null, "CORR-01", "usr_coord_01");
    }

    public boolean syncIncident(String orgId, String role, String id, String fieldId, String machineId, String severity, String description, String photoUrl, String status) {
        return syncIncident(orgId, role, id, machineId, "usr_op_minh", severity, "MECHANICAL_FAILURE", description, 24.0, photoUrl, null, "TK-" + id, null, status, null, "CORR-INC-" + id);
    }

    public boolean syncAuditBlock(String orgId, String role, int blockIndex, String eventType, String entityId, String payloadHash, String prevHash, String currHash, String timestamp, String sealedBy) {
        return syncAuditRecord(orgId, role, "EVT-" + blockIndex, "CORR-AUDIT", "Block", entityId, eventType, sealedBy, "COORDINATOR", "{}", "{}", prevHash, currHash);
    }
}
