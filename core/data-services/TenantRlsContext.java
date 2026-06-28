// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.dataservices;

import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * Multi-Tenant Row-Level Security (RLS) & Field-Level Visibility Policy Resolver.
 * Enforces tenant isolation by `organization_id`, user-level isolation by `user_id`,
 * and role-based data masking.
 */
public final class TenantRlsContext {

    private TenantRlsContext() {}

    /**
     * Parameter-safe RLS session applicator using parameterized PreparedStatement and set_config().
     * Eliminates SQL injection risks when setting session-local tenant context.
     */
    public static void applyPostgresRlsSession(Connection conn, String orgId, String role, String userId) throws SQLException {
        if (conn == null) return;
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT set_config('app.current_org_id', ?, true), " +
                "       set_config('app.current_user_role', ?, true), " +
                "       set_config('app.current_user_id', ?, true)"
        )) {
            ps.setString(1, orgId != null ? orgId : "");
            ps.setString(2, role != null ? role : "");
            ps.setString(3, userId != null ? userId : "");
            ps.execute();
        }
    }

    public static void applyPostgresRlsSession(Connection conn, AuthContext auth) throws SQLException {
        if (auth == null) {
            applyPostgresRlsSession(conn, "", "", "");
        } else {
            applyPostgresRlsSession(conn, auth.organizationId(), auth.role(), auth.userId());
        }
    }

    public static String buildPostgresRlsPolicySql(AuthContext auth) {
        if (auth == null) {
            return "SET LOCAL app.current_org_id = ''; SET LOCAL app.current_user_role = ''; SET LOCAL app.current_user_id = '';";
        }
        return buildPostgresRlsPolicySql(auth.organizationId(), auth.role(), auth.userId());
    }

    public static String buildPostgresRlsPolicySql(String orgId, String role, String userId) {
        String safeOrg = orgId != null ? orgId.replace("'", "''") : "";
        String safeRole = role != null ? role.replace("'", "''") : "";
        String safeUser = userId != null ? userId.replace("'", "''") : "";
        return String.format(
                "SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s'; SET LOCAL app.current_user_id = '%s';",
                safeOrg, safeRole, safeUser
        );
    }

    public static boolean isSameTenant(AuthContext auth, String resourceOrgId) {
        return auth != null && auth.organizationId().equals(resourceOrgId);
    }

    public static String resolveFieldVisibility(AuthContext auth, String fieldOwnerUserId) {
        if ("FARMER".equals(auth.role()) && !auth.userId().equals(fieldOwnerUserId)) {
            return "FOG_OF_WAR";
        }
        if ("REPAIR_TEAM".equals(auth.role())) {
            return "FOG_OF_WAR";
        }
        return "FULL";
    }
}
