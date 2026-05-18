package org.openagrios.core.dataservices;

import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;

/**
 * Multi-Tenant Row-Level Security (RLS) & Field-Level Visibility Policy Resolver.
 * Enforces tenant isolation by `organization_id` and role-based data masking.
 */
public final class TenantRlsContext {

    private TenantRlsContext() {}

    public static String buildPostgresRlsPolicySql(AuthContext auth) {
        return String.format(
                "SET LOCAL app.current_org_id = '%s'; SET LOCAL app.current_user_role = '%s';",
                auth.organizationId(), auth.role()
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
