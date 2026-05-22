// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.gateway;

import org.openagrios.core.dataservices.ImmutableAuditLedger;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;

import java.util.*;

/**
 * Apache APISIX-compatible Zero-Trust Policy Enforcement Point (PEP) & RBAC Guard.
 * Injects context headers and strictly validates role permissions with automated audit logs.
 */
public final class ZeroTrustGateway {

    private ZeroTrustGateway() {}

    public static Map<String, String> buildZeroTrustHeaders(AuthContext auth) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Correlation-Id");
        headers.put("X-Gateway", "Apache-APISIX-ZeroTrust-v3.9");
        headers.put("X-DXOS-Core", "OpenAgriOS-Java21-Headless-PaaS-v2.0");
        if (auth != null) {
            headers.put("X-User-Id", auth.username());
            headers.put("X-Org-Id", auth.organizationId());
            headers.put("X-User-Roles", auth.role());
        }
        return headers;
    }

    public static Map<String, Object> enforceRbacPolicy(
            ImmutableAuditLedger auditLedger,
            AuthContext auth,
            List<String> allowedRoles,
            String actionName,
            String entityType,
            String entityId
    ) {
        if (allowedRoles.contains(auth.role())) {
            return null;
        }

        String corrId = "CORR-RBAC-" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("required_roles", allowedRoles);

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("error", "403 Forbidden: Role not authorized");
        after.put("attempted_by_role", auth.role());

        var auditEvent = auditLedger.appendRecord(
                auth.organizationId(),
                corrId,
                entityType,
                entityId,
                "RBAC_BLOCKED_" + actionName,
                auth.username(),
                auth.role(),
                before,
                after,
                403
        );

        Map<String, Object> errorResponse = new LinkedHashMap<>();
        errorResponse.put("error", "RBAC_FORBIDDEN");
        errorResponse.put("status", 403);
        errorResponse.put("gateway", "Apache APISIX + Keycloak RBAC Policy");
        errorResponse.put("message", String.format(
                "Chặn truy cập (403 Forbidden): Vai trò '%s' (%s) không có quyền thực hiện '%s'. Yêu cầu vai trò: %s.",
                auth.role(), auth.username(), actionName, String.join(", ", allowedRoles)
        ));
        errorResponse.put("audit_event", auditEvent.toSummaryMap());
        return errorResponse;
    }
}
