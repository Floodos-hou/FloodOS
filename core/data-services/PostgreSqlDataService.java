// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.dataservices;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Domain-neutral PostgreSQL access layer of the platform core (Tier 1).
 *
 * <p>It knows connection handling, the tenant/role/user RLS session, the platform tables
 * (organizations, users, audit_records) and a few generic primitives. It knows nothing about any business domain:
 * an application brings its own SQL and runs it through
 * {@link #inTransaction}, {@link #query} and {@link #execute}, always under the caller's RLS context.
 *
 * <p>The DDL lives in exactly one place, infra/db/schema.sql, applied by the postgres container on every start.
 * This class never creates tables; {@link #missingTables} lets the application fail fast when they are absent.
 */
public final class PostgreSqlDataService {

    /** Unchecked wrapper so callers can fail fast without declaring SQLException everywhere. */
    public static final class DataAccessException extends RuntimeException {
        public DataAccessException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /** Binds the parameters of a prepared statement. */
    @FunctionalInterface
    public interface SqlBinder {
        void bind(PreparedStatement ps) throws SQLException;
    }

    /** Work executed inside one database transaction that already carries the RLS session. */
    @FunctionalInterface
    public interface TxWork {
        void run(Connection conn) throws SQLException;
    }

    private static final Pattern TABLE_NAME = Pattern.compile("[a-z_][a-z0-9_]{0,62}");
    private static final String GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
    private static final List<String> PLATFORM_TABLES = List.of("organizations", "users", "audit_records");

    private final String dbUrl;
    private final String dbUser;
    private final String dbPassword;
    private boolean driverAvailable = false;

    public PostgreSqlDataService() {
        this(
                System.getenv().getOrDefault("DATABASE_URL", ""),
                System.getenv().getOrDefault("POSTGRES_APP_USER", System.getenv().getOrDefault("POSTGRES_USER", "openagrios_app")),
                System.getenv().getOrDefault("POSTGRES_APP_PASSWORD", System.getenv().getOrDefault("POSTGRES_PASSWORD", "openagrios_app_dev_only"))
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

    /** Checks if a live JDBC connection can be established to PostgreSQL. */
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
     * Returns the tables from {@code required} that do not exist in the public schema. An empty list means the
     * schema from infra/db/schema.sql is in place. Table names are validated, never concatenated blindly.
     */
    public List<String> missingTables(Collection<String> required) {
        List<String> missing = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword);
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?")) {
            for (String table : required) {
                requireTableName(table);
                ps.setString(1, table);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) missing.add(table);
                }
            }
        } catch (SQLException e) {
            throw new DataAccessException("Cannot inspect the database schema: " + e.getMessage(), e);
        }
        return missing;
    }

    // ------------------------------------------------------------------------
    // Generic, RLS-aware primitives used by applications
    // ------------------------------------------------------------------------

    /**
     * Runs {@code work} in one transaction. The RLS session (organisation, role, user) is applied first, so every
     * statement of the work is subject to the same row-level policies as a direct query by that user.
     * Throws {@link DataAccessException} and rolls back on any failure.
     */
    public void inTransaction(String orgId, String role, String userId, TxWork work) {
        if (!driverAvailable || dbUrl.isEmpty()) {
            throw new DataAccessException("PostgreSQL is not configured", null);
        }
        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)) {
            conn.setAutoCommit(false);
            try {
                TenantRlsContext.applyPostgresRlsSession(conn, orgId, role, userId);
                work.run(conn);
                conn.commit();
            } catch (SQLException | RuntimeException e) {
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new DataAccessException("PostgreSQL transaction failed: " + e.getMessage(), e);
        }
    }

    /** Executes one parameterised INSERT/UPDATE/DELETE under the caller's RLS context; returns affected rows. */
    public int execute(String orgId, String role, String userId, String sql, SqlBinder binder) {
        int[] affected = {0};
        inTransaction(orgId, role, userId, conn -> {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                if (binder != null) binder.bind(ps);
                affected[0] = ps.executeUpdate();
            }
        });
        return affected[0];
    }

    /**
     * Runs a parameterised SELECT under the caller's RLS context. Column labels are lower-cased; cast timestamps and
     * JSON columns to text in the SQL (::text) to get stable strings.
     */
    public List<Map<String, Object>> query(String orgId, String role, String userId, String sql, SqlBinder binder) {
        List<Map<String, Object>> rows = new ArrayList<>();
        inTransaction(orgId, role, userId, conn -> {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                if (binder != null) binder.bind(ps);
                try (ResultSet rs = ps.executeQuery()) {
                    collect(rs, rows);
                }
            }
        });
        return rows;
    }

    /** Reads with the platform-level context: for cold-start rehydration only, never for user requests. */
    public List<Map<String, Object>> queryAsPlatform(String sql) {
        return query("", TenantRlsContext.PLATFORM_ROLE, "system", sql, null);
    }

    /** True when the table has at least one row (platform context, because FORCE RLS hides rows otherwise). */
    public boolean hasRows(String table) {
        requireTableName(table);
        return !queryAsPlatform("SELECT 1 AS present FROM " + table + " LIMIT 1").isEmpty();
    }

    /**
     * Deletes every row of the given tables in one transaction, in the order given (children first). Used by the
     * simulator reset. Never include audit_records: it is append-only and a reset starts a new ledger epoch.
     */
    public void deleteRows(List<String> tablesChildrenFirst) {
        for (String t : tablesChildrenFirst) requireTableName(t);
        inTransaction("", TenantRlsContext.PLATFORM_ROLE, "system", conn -> {
            try (Statement st = conn.createStatement()) {
                for (String table : tablesChildrenFirst) {
                    st.executeUpdate("DELETE FROM " + table);
                }
            }
        });
    }

    private static void collect(ResultSet rs, List<Map<String, Object>> rows) throws SQLException {
        var meta = rs.getMetaData();
        int cols = meta.getColumnCount();
        while (rs.next()) {
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 1; i <= cols; i++) {
                row.put(meta.getColumnLabel(i).toLowerCase(Locale.ROOT), rs.getObject(i));
            }
            rows.add(row);
        }
    }

    private static void requireTableName(String table) {
        if (table == null || !TABLE_NAME.matcher(table).matches()) {
            throw new IllegalArgumentException("Invalid table name: " + table);
        }
    }

    // ------------------------------------------------------------------------
    // Platform tables
    // ------------------------------------------------------------------------

    /** Sets the PostgreSQL multi-tenant session parameters on a fresh connection and reports the result. */
    public Map<String, Object> testConnectionAndApplyRls(String orgId, String role) {
        return testConnectionAndApplyRls(orgId, role, "admin");
    }

    public Map<String, Object> testConnectionAndApplyRls(String orgId, String role, String userId) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("database_url", dbUrl);
        result.put("driver_available", driverAvailable);
        result.put("target_org_id", orgId);
        result.put("target_role", role);
        result.put("target_user_id", userId);

        String rlsSql = TenantRlsContext.buildPostgresRlsPolicySql(orgId, role, userId);
        result.put("compiled_rls_sql", rlsSql);

        if (!driverAvailable || dbUrl.isEmpty()) {
            result.put("status", "IN_MEMORY_NO_DATABASE");
            result.put("notice", "PostgreSQL JDBC driver not loaded or DATABASE_URL not set: running with the in-memory store and the compiled RLS policy only.");
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

    /** Upserts an organisation (tenant). */
    public boolean syncOrganization(String orgId, String name, String orgType, String province, String status) {
        return runPlatformWrite("organization " + orgId, """
            INSERT INTO organizations (organization_id, name, org_type, province, status)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (organization_id) DO UPDATE SET
                name = EXCLUDED.name,
                org_type = EXCLUDED.org_type,
                province = EXCLUDED.province,
                status = EXCLUDED.status
            """, ps -> {
            ps.setString(1, orgId);
            ps.setString(2, name);
            ps.setString(3, orgType);
            ps.setString(4, province != null ? province : "Hà Nội");
            ps.setString(5, status != null ? status : "ACTIVE");
        });
    }

    /** Upserts a user account (identity mapping of the SSO user). */
    public boolean syncUser(String userId, String username, String fullName, String orgId, String role, String phone, String status) {
        return runPlatformWrite("user " + userId, """
            INSERT INTO users (user_id, username, full_name, organization_id, role, phone, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
                username = EXCLUDED.username,
                full_name = EXCLUDED.full_name,
                organization_id = EXCLUDED.organization_id,
                role = EXCLUDED.role,
                phone = EXCLUDED.phone,
                status = EXCLUDED.status
            """, ps -> {
            ps.setString(1, userId);
            ps.setString(2, username);
            ps.setString(3, fullName);
            ps.setString(4, orgId);
            ps.setString(5, role);
            ps.setString(6, phone != null ? phone : "");
            ps.setString(7, status != null ? status : "ACTIVE");
        });
    }

    private boolean runPlatformWrite(String what, String sql, SqlBinder binder) {
        if (!driverAvailable || dbUrl.isEmpty()) return false;
        try {
            execute("", TenantRlsContext.PLATFORM_ROLE, "system", sql, binder);
            return true;
        } catch (RuntimeException e) {
            System.err.println("[PG] could not persist " + what + ": " + e.getMessage());
            return false;
        }
    }

    /** Persists one audit record (table audit_records). Append-only: a duplicate in the same epoch is an error. */
    public boolean syncAuditRecord(
            String orgId, String role, String userId, String eventId, String correlationId, String entityType,
            String entityId, String action, String actorUserId, String actorRole,
            String beforeStateJson, String afterStateJson, String prevHash, String recordHash,
            String ledgerEpoch, int ledgerSeq, String ledgerTs, int gatewayStatus
    ) {
        if (!driverAvailable || dbUrl.isEmpty()) return false;
        String before = (beforeStateJson != null && !beforeStateJson.isBlank()) ? beforeStateJson : "{}";
        String after = (afterStateJson != null && !afterStateJson.isBlank()) ? afterStateJson : "{}";
        String sql = """
            INSERT INTO audit_records (
                event_id, organization_id, correlation_id, entity_type, entity_id,
                action, actor_user_id, actor_role, before_state, after_state,
                prev_hash, record_hash, ledger_epoch, ledger_seq, ledger_ts, before_canonical, after_canonical, gateway_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), CAST(? AS JSONB), ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """;
        try {
            int inserted = execute(orgId, role, userId != null ? userId : actorUserId, sql, ps -> {
                ps.setString(1, eventId);
                ps.setString(2, orgId);
                ps.setString(3, correlationId != null ? correlationId : "CORR-AUDIT");
                ps.setString(4, entityType != null ? entityType : "System");
                ps.setString(5, entityId != null ? entityId : "SYS-001");
                ps.setString(6, action);
                ps.setString(7, actorUserId != null ? actorUserId : "system");
                ps.setString(8, actorRole != null ? actorRole : "PLATFORM_ADMIN");
                ps.setString(9, before);
                ps.setString(10, after);
                ps.setString(11, prevHash != null ? prevHash : GENESIS_HASH);
                ps.setString(12, recordHash);
                ps.setString(13, ledgerEpoch);
                ps.setInt(14, ledgerSeq);
                ps.setString(15, ledgerTs);
                ps.setString(16, before);
                ps.setString(17, after);
                ps.setInt(18, gatewayStatus);
            });
            if (inserted == 0) {
                throw new IllegalStateException("audit record " + eventId + " was not inserted (duplicate in epoch " + ledgerEpoch + ")");
            }
            return true;
        } catch (RuntimeException e) {
            System.err.println("[PG] syncAuditRecord " + eventId + " failed: " + e.getMessage());
            return false;
        }
    }

    public boolean syncAuditRecord(
            String orgId, String role, String eventId, String correlationId, String entityType,
            String entityId, String action, String actorUserId, String actorRole,
            String beforeStateJson, String afterStateJson, String prevHash, String recordHash
    ) {
        return syncAuditRecord(orgId, role, actorUserId, eventId, correlationId, entityType, entityId, action, actorUserId, actorRole, beforeStateJson, afterStateJson, prevHash, recordHash, null, 0, null, 200);
    }

    /** Cold-start rehydration of the platform tables with the platform-level context. */
    public List<Map<String, Object>> queryAll(String tableName) {
        String table = tableName == null ? "" : tableName.toLowerCase(Locale.ROOT);
        if (!PLATFORM_TABLES.contains(table)) {
            throw new IllegalArgumentException("Disallowed table name (applications read their own tables through query()): " + tableName);
        }
        if (!isConnectionLive()) return new ArrayList<>();
        String sql = "audit_records".equals(table)
                ? "SELECT seq_no, event_id, organization_id, correlation_id, entity_type, entity_id, action, actor_user_id, actor_role, before_state::text AS before_state, after_state::text AS after_state, prev_hash, record_hash, created_at::text AS created_at, ledger_epoch, ledger_seq, ledger_ts, before_canonical, after_canonical, gateway_status FROM audit_records ORDER BY seq_no ASC"
                : "SELECT * FROM " + table;
        return queryAsPlatform(sql);
    }
}
