// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.apps.floodos;

import org.floodos.core.identity.KeycloakOidcEngine;

import java.util.List;
import java.util.Set;

/**
 * Roles of the FloodOS application. The platform core knows none of them: it only knows the list the
 * application registers at start-up ({@link #register()}). A token without one of these roles is refused.
 */
public final class FloodRoles {

    public static final String PLATFORM_ADMIN = KeycloakOidcEngine.PLATFORM_ADMIN_ROLE;
    /** Receives flood reports from the public (also: a citizen). Sees only their own reports. */
    public static final String REPORTER = "REPORTER";
    /** Verifies reports, sets priority, dispatches teams and vehicles, approves re-plans. */
    public static final String DISPATCHER = "DISPATCHER";
    /** Leads a field team: executes orders, reports progress and vehicle incidents. */
    public static final String FIELD_TEAM = "FIELD_TEAM";
    /** Manages vehicles and repair tickets. Does not approve dispatches. */
    public static final String RESOURCE_MANAGER = "RESOURCE_MANAGER";

    /** Most privileged first; PLATFORM_ADMIN is always added first by the core. */
    public static final List<String> BUSINESS_ROLES = List.of(DISPATCHER, RESOURCE_MANAGER, FIELD_TEAM, REPORTER);

    public static final Set<String> ALL = Set.of(PLATFORM_ADMIN, DISPATCHER, RESOURCE_MANAGER, FIELD_TEAM, REPORTER);

    private FloodRoles() {}

    public static void register() {
        KeycloakOidcEngine.configureRoleHierarchy(BUSINESS_ROLES);
    }
}
