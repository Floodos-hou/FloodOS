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
 * and provides persistent table synchronization for cooperatives, fields,
 * assignments, incidents, and audit trails.
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
     * Initializes essential relational schema tables if they do not exist.
     */
    public boolean initSchema() {
        if (!isConnectionLive()) {
            return false;
        }
        String ddl = """
            CREATE TABLE IF NOT EXISTS fields (
                id VARCHAR(64) PRIMARY KEY,
                org_id VARCHAR(64) NOT NULL,
                name VARCHAR(255) NOT NULL,
                area_ha NUMERIC(10, 2) NOT NULL,
                latitude NUMERIC(10, 6) NOT NULL,
                longitude NUMERIC(10, 6) NOT NULL,
                crop_type VARCHAR(64) NOT NULL,
                status VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS machines (
                id VARCHAR(64) PRIMARY KEY,
                org_id VARCHAR(64) NOT NULL,
                model VARCHAR(255) NOT NULL,
                capacity_ha_h NUMERIC(10, 2) NOT NULL,
                latitude NUMERIC(10, 6) NOT NULL,
                longitude NUMERIC(10, 6) NOT NULL,
                status VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS service_shifts (
                id VARCHAR(64) PRIMARY KEY,
                org_id VARCHAR(64) NOT NULL,
                field_id VARCHAR(64) NOT NULL,
                machine_id VARCHAR(64) NOT NULL,
                operator_id VARCHAR(64),
                status VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS incidents (
                id VARCHAR(64) PRIMARY KEY,
                org_id VARCHAR(64) NOT NULL,
                field_id VARCHAR(64) NOT NULL,
                machine_id VARCHAR(64) NOT NULL,
                severity VARCHAR(32) NOT NULL,
                description TEXT,
                photo_s3_url TEXT,
                status VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS audit_ledger (
                block_index INT PRIMARY KEY,
                org_id VARCHAR(64) NOT NULL,
                event_type VARCHAR(128) NOT NULL,
                entity_id VARCHAR(64) NOT NULL,
                payload_hash VARCHAR(64) NOT NULL,
                prev_hash VARCHAR(64) NOT NULL,
                curr_hash VARCHAR(64) NOT NULL,
                timestamp VARCHAR(64) NOT NULL,
                sealed_by VARCHAR(64) NOT NULL
            );
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
     * Sets PostgreSQL multi-tenant session parameters and executes work.
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
     * Persists field entity with tenant RLS isolation.
     */
    public boolean syncField(String orgId, String role, String id, String name, double areaHa, double lat, double lon, String cropType, String status) {
        if (!isConnectionLive()) {
            return false;
        }
        String sql = """
            INSERT INTO fields (id, org_id, name, area_ha, latitude, longitude, crop_type, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                area_ha = EXCLUDED.area_ha,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                crop_type = EXCLUDED.crop_type,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, id);
                ps.setString(2, orgId);
                ps.setString(3, name);
                ps.setDouble(4, areaHa);
                ps.setDouble(5, lat);
                ps.setDouble(6, lon);
                ps.setString(7, cropType);
                ps.setString(8, status);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists machine entity with tenant RLS isolation.
     */
    public boolean syncMachine(String orgId, String role, String id, String model, double capacityHaH, double lat, double lon, String status) {
        if (!isConnectionLive()) {
            return false;
        }
        String sql = """
            INSERT INTO machines (id, org_id, model, capacity_ha_h, latitude, longitude, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                model = EXCLUDED.model,
                capacity_ha_h = EXCLUDED.capacity_ha_h,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, id);
                ps.setString(2, orgId);
                ps.setString(3, model);
                ps.setDouble(4, capacityHaH);
                ps.setDouble(5, lat);
                ps.setDouble(6, lon);
                ps.setString(7, status);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists shift entity with tenant RLS isolation.
     */
    public boolean syncShift(String orgId, String role, String id, String fieldId, String machineId, String operatorId, String status) {
        if (!isConnectionLive()) {
            return false;
        }
        String sql = """
            INSERT INTO service_shifts (id, org_id, field_id, machine_id, operator_id, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                field_id = EXCLUDED.field_id,
                machine_id = EXCLUDED.machine_id,
                operator_id = EXCLUDED.operator_id,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, id);
                ps.setString(2, orgId);
                ps.setString(3, fieldId);
                ps.setString(4, machineId);
                ps.setString(5, operatorId);
                ps.setString(6, status);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists incident record with tenant RLS isolation.
     */
    public boolean syncIncident(String orgId, String role, String id, String fieldId, String machineId, String severity, String description, String photoUrl, String status) {
        if (!isConnectionLive()) {
            return false;
        }
        String sql = """
            INSERT INTO incidents (id, org_id, field_id, machine_id, severity, description, photo_s3_url, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                field_id = EXCLUDED.field_id,
                machine_id = EXCLUDED.machine_id,
                severity = EXCLUDED.severity,
                description = EXCLUDED.description,
                photo_s3_url = EXCLUDED.photo_s3_url,
                status = EXCLUDED.status;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, id);
                ps.setString(2, orgId);
                ps.setString(3, fieldId);
                ps.setString(4, machineId);
                ps.setString(5, severity);
                ps.setString(6, description);
                ps.setString(7, photoUrl);
                ps.setString(8, status);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Persists SHA-256 audit ledger block.
     */
    public boolean syncAuditBlock(String orgId, String role, int blockIndex, String eventType, String entityId, String payloadHash, String prevHash, String currHash, String timestamp, String sealedBy) {
        if (!isConnectionLive()) {
            return false;
        }
        String sql = """
            INSERT INTO audit_ledger (block_index, org_id, event_type, entity_id, payload_hash, prev_hash, curr_hash, timestamp, sealed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (block_index) DO NOTHING;
            """;
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try (Statement s = conn.createStatement()) {
                s.execute(String.format("SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                        orgId.replace("'", "''"), role.replace("'", "''")));
            }
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setInt(1, blockIndex);
                ps.setString(2, orgId);
                ps.setString(3, eventType);
                ps.setString(4, entityId);
                ps.setString(5, payloadHash);
                ps.setString(6, prevHash);
                ps.setString(7, currHash);
                ps.setString(8, timestamp);
                ps.setString(9, sealedBy);
                ps.executeUpdate();
            }
            conn.commit();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
