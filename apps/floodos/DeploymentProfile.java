// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.apps.floodos;

import org.floodos.core.identity.KeycloakOidcEngine;
import org.floodos.core.workflow.BpmnWorkflowEngine;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Tier-1 Infrastructure Deployment Profile: Controls modular service activation
 * and graceful degradation across operational environments.
 *
 * <p>Profiles:
 * <ul>
 *   <li>{@code FULL}: Central metropolitan command (Keycloak + Flowable + SeaweedFS S3 + APISIX + Kafka + ClamAV).</li>
 *   <li>{@code STANDARD}: Regional operations center (PostgreSQL + Keycloak/Local + Flowable/Embedded + S3/Local + APISIX).</li>
 *   <li>{@code EDGE_FIELD}: Mobile field command vehicle at disaster epicentre (&lt;800MB RAM, in-process engine, zero external container dependencies).</li>
 * </ul>
 */
public enum DeploymentProfile {
    FULL("FULL", "Trung tâm Chỉ huy Đô thị (Enterprise Metropolitan C2)", "ENTERPRISE (~16GB RAM)"),
    STANDARD("STANDARD", "Trạm Điều phối Khu vực (Regional Operations Node)", "STANDARD (~4GB RAM)"),
    EDGE_FIELD("EDGE_FIELD", "Chỉ huy Dã chiến Cơ động Hiện trường (Tactical Field Edge Node)", "LIGHTWEIGHT (<800MB RAM)");

    private final String code;
    private final String label;
    private final String memoryFootprint;

    DeploymentProfile(String code, String label, String memoryFootprint) {
        this.code = code;
        this.label = label;
        this.memoryFootprint = memoryFootprint;
    }

    public String getCode() {
        return code;
    }

    public String getLabel() {
        return label;
    }

    public String getMemoryFootprint() {
        return memoryFootprint;
    }

    private static volatile DeploymentProfile overrideProfileForTesting = null;

    public static void setProfileForTesting(DeploymentProfile profile) {
        overrideProfileForTesting = profile;
    }

    public static void resetProfileForTesting() {
        overrideProfileForTesting = null;
    }

    public static DeploymentProfile getActiveProfile() {
        if (overrideProfileForTesting != null) {
            return overrideProfileForTesting;
        }
        String env = System.getenv("FLOODOS_PROFILE");
        if (env == null || env.isBlank()) {
            return FULL;
        }
        env = env.trim().toUpperCase();
        if (env.equals("EDGE") || env.equals("FIELD") || env.equals("MINIMAL") || env.equals("EDGE_FIELD")) {
            return EDGE_FIELD;
        }
        if (env.equals("STANDARD") || env.equals("REGIONAL")) {
            return STANDARD;
        }
        return FULL;
    }

    public static boolean isEdgeField() {
        return getActiveProfile() == EDGE_FIELD;
    }

    public static boolean isFull() {
        return getActiveProfile() == FULL;
    }

    public static Map<String, Object> getSystemCapabilities(FloodDataStore store) {
        DeploymentProfile profile = getActiveProfile();

        Map<String, Object> services = new LinkedHashMap<>();

        // 1. Identity & Access Management
        Map<String, Object> identity = new LinkedHashMap<>();
        identity.put("name", "Identity & Access Management");
        identity.put("mode", KeycloakOidcEngine.getActiveAuthMode().name());
        identity.put("provider", KeycloakOidcEngine.getActiveAuthMode() == KeycloakOidcEngine.AuthMode.KEYCLOAK_PRODUCTION ? "Keycloak OIDC 24.0" : "Local Tactical PKCE");
        identity.put("status", "ACTIVE");
        services.put("identity", identity);

        // 2. Workflow Orchestration Engine
        Map<String, Object> workflow = new LinkedHashMap<>();
        workflow.put("name", "Workflow Engine");
        workflow.put("mode", BpmnWorkflowEngine.isFlowableProduction() ? "FLOWABLE_PRODUCTION" : "EMBEDDED_BPMN_ENGINE");
        workflow.put("provider", BpmnWorkflowEngine.isFlowableProduction() ? "Flowable BPMN 2.0 REST" : "OMG BPMN 2.0 In-Process DOM");
        workflow.put("status", "ACTIVE");
        services.put("workflow", workflow);

        // 3. Structured Data Engine (PostgreSQL 16)
        Map<String, Object> database = new LinkedHashMap<>();
        database.put("name", "Structured Data Engine");
        database.put("mode", store.getStorageEngineMode());
        database.put("provider", "PostgreSQL 16 (RLS forced)");
        database.put("status", store.isDatabaseBacked() ? "CONNECTED" : "IN_MEMORY_SEED");
        services.put("database", database);

        // 4. Object Storage Service (SeaweedFS S3)
        Map<String, Object> storage = new LinkedHashMap<>();
        storage.put("name", "Unstructured Evidence Storage");
        boolean s3Active = store.s3Storage.getS3Endpoint() != null && !store.s3Storage.getS3Endpoint().isBlank();
        storage.put("mode", s3Active ? "SEAWEEDFS_S3" : "LOCAL_ETAG_STORE");
        storage.put("provider", s3Active ? "SeaweedFS S3 API (" + store.s3Storage.getS3Endpoint() + ")" : "Local Ephemeral Store");
        storage.put("status", "ACTIVE");
        services.put("storage", storage);

        // 5. Zero-Trust API Gateway (Apache APISIX)
        Map<String, Object> gateway = new LinkedHashMap<>();
        gateway.put("name", "Edge API Gateway");
        gateway.put("provider", profile == EDGE_FIELD ? "Direct Core Ingress" : "Apache APISIX Zero-Trust (:9080)");
        gateway.put("status", "ACTIVE");
        services.put("gateway", gateway);

        // 6. Tactical Event Bus & Telemetry
        Map<String, Object> eventBus = new LinkedHashMap<>();
        eventBus.put("name", "Tactical Event Bus");
        eventBus.put("provider", profile == EDGE_FIELD ? "In-Memory Circular Ledger" : "Apache Kafka KRaft (:9092)");
        eventBus.put("status", store.eventBus.status());
        services.put("event_bus", eventBus);

        // 7. Malware Protection Scanner
        Map<String, Object> antivirus = new LinkedHashMap<>();
        antivirus.put("name", "Malware Stream Scanner");
        antivirus.put("provider", "ClamAV Daemon INSTREAM");
        antivirus.put("status", store.malwareScanner.status());
        services.put("antivirus", antivirus);

        Map<String, Object> capabilities = new LinkedHashMap<>();
        capabilities.put("profile", profile.getCode());
        capabilities.put("profile_label", profile.getLabel());
        capabilities.put("tier", 1);
        capabilities.put("status", "OPERATIONAL");
        capabilities.put("memory_footprint", profile.getMemoryFootprint());
        capabilities.put("services", services);
        capabilities.put("timestamp", Instant.now().toString());

        return capabilities;
    }
}
