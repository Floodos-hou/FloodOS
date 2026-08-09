// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.apps.floodops;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import org.openagrios.apps.floodops.FloodOpsService.HttpResult;
import org.openagrios.core.dataservices.AnalyticsLakeClient;
import org.openagrios.core.dataservices.ImmutableAuditLedger;
import org.openagrios.core.dataservices.JsonCodec;
import org.openagrios.core.dataservices.SeaweedS3StorageService;
import org.openagrios.core.gateway.ZeroTrustGateway;
import org.openagrios.core.identity.KeycloakOidcEngine;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;
import org.openagrios.core.workflow.BpmnWorkflowEngine;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * HTTP entry point of Hanoi FloodOps: the application API served behind the Tier-1 gateway.
 * Routing only; every business rule lives in {@link FloodOpsService}.
 */
public final class FloodOpsServer {

    private final FloodOpsService service;
    private final FloodAuthService authService;
    private HttpServer server;

    public FloodOpsServer(File projectRootDir) {
        File bpmnDir = new File(projectRootDir, "infra/bpmn");
        ImmutableAuditLedger auditLedger = new ImmutableAuditLedger();
        SeaweedS3StorageService s3Storage = new SeaweedS3StorageService();
        BpmnWorkflowEngine bpmnEngine = new BpmnWorkflowEngine(bpmnDir);
        FloodDataStore dataStore = new FloodDataStore(auditLedger, s3Storage, bpmnEngine);
        this.service = new FloodOpsService(dataStore);
        this.authService = new FloodAuthService(dataStore);
    }

    public FloodOpsService getService() {
        return service;
    }

    public FloodAuthService getAuthService() {
        return authService;
    }

    public void start(int port) throws IOException {
        server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        server.createContext("/", new RouterHandler(service, authService));
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private static final class RouterHandler implements HttpHandler {

        private final FloodOpsService service;
        private final FloodAuthService auth;

        RouterHandler(FloodOpsService service, FloodAuthService auth) {
            this.service = service;
            this.auth = auth;
        }

        @Override
        public void handle(HttpExchange ex) throws IOException {
            String method = ex.getRequestMethod().toUpperCase(Locale.ROOT);
            String path = ex.getRequestURI().getPath();
            if ("OPTIONS".equals(method)) {
                sendJson(ex, 200, Map.of("ok", true), null);
                return;
            }
            try {
                if ("GET".equals(method)) {
                    handleGet(ex, path);
                } else if ("POST".equals(method)) {
                    handlePost(ex, path);
                } else {
                    sendJson(ex, 405, Map.of("error", "METHOD_NOT_ALLOWED"), null);
                }
            } catch (BadRequestException e) {
                sendJson(ex, 400, Map.of("error", "INVALID_JSON", "message", String.valueOf(e.getMessage())), null);
            } catch (IllegalStateException e) {
                // A failed write to PostgreSQL in production: the change was discarded, tell the client.
                e.printStackTrace();
                sendJson(ex, 503, Map.of("error", "STORAGE_UNAVAILABLE", "message", String.valueOf(e.getMessage())), null);
            } catch (Exception e) {
                e.printStackTrace();
                sendJson(ex, 500, Map.of("error", "INTERNAL_SERVER_ERROR", "message", String.valueOf(e.getMessage())), null);
            }
        }

        private static Map<String, String> parseQueryParams(String query) {
            Map<String, String> map = new LinkedHashMap<>();
            if (query == null || query.isBlank()) {
                return map;
            }
            for (String param : query.split("&")) {
                String[] pair = param.split("=", 2);
                if (pair.length == 2) {
                    map.put(java.net.URLDecoder.decode(pair[0], StandardCharsets.UTF_8),
                            java.net.URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
                } else if (pair.length == 1 && !pair[0].isBlank()) {
                    map.put(java.net.URLDecoder.decode(pair[0], StandardCharsets.UTF_8), "");
                }
            }
            return map;
        }

        private static String segment(String path, int index) {
            String[] segs = path.split("/");
            return index < segs.length ? segs[index] : "";
        }

        private void handleGet(HttpExchange ex, String path) throws IOException {
            if ("/api/v1/internal/assets".equals(path)) {
                if (!ingestTokenValid(ex)) return;
                sendJson(ex, 200, service.listAssetsForIngest(), null);
                return;
            }

            if ("/".equals(path) || "/api/v1".equals(path)) {
                Map<String, Object> endpoints = new LinkedHashMap<>();
                endpoints.put("health", "GET /api/v1/health");
                endpoints.put("demo_accounts", "GET /api/v1/auth/accounts");
                endpoints.put("pkce_auth_url", "GET /api/v1/auth/pkce/authorize-url");
                endpoints.put("pkce_auth_code", "POST /api/v1/auth/pkce/authorize-code");
                endpoints.put("pkce_token_exchange", "POST /api/v1/auth/pkce/token");
                endpoints.put("oidc_login", "POST /api/v1/auth/login");
                endpoints.put("userinfo", "GET /api/v1/auth/userinfo");
                endpoints.put("tenant_state_rls", "GET /api/v1/state");
                endpoints.put("ngsi_ld_digital_twin", "GET /api/v1/digital-twin/entities");
                endpoints.put("create_flood_report", "POST /api/v1/flood-reports");
                endpoints.put("verify_flood_report", "POST /api/v1/flood-reports/{report_id}/verify");
                endpoints.put("create_dispatch_order", "POST /api/v1/dispatch-orders");
                endpoints.put("update_order_status", "POST /api/v1/dispatch-orders/{order_id}/status");
                endpoints.put("report_field_incident", "POST /api/v1/field-incidents");
                endpoints.put("approve_replan", "POST /api/v1/field-incidents/{incident_id}/approve-replan");
                endpoints.put("update_repair_ticket", "POST /api/v1/field-incidents/{incident_id}/repair-ticket");
                endpoints.put("confirm_resolution", "POST /api/v1/resolutions");
                endpoints.put("update_shelter_occupancy", "POST /api/v1/shelters/{shelter_id}/occupancy");
                endpoints.put("live_event_stream", "GET /api/v1/stream/events");
                endpoints.put("verify_audit_chain", "GET /api/v1/audit/verify");
                endpoints.put("data_lineage", "GET /api/v1/audit/lineage/{correlation_id}");
                endpoints.put("cold_analytics", "GET /api/v1/analytics/{summary|actions-by-day|asset-utilization}");
                endpoints.put("demo_reset", "POST /api/v1/sim/reset (PLATFORM_ADMIN, only when OPENDXOS_ALLOW_DEMO_RESET=true)");
                Map<String, Object> manifest = new LinkedHashMap<>();
                manifest.put("service", "OpenDXOS Tier-1 Headless Core PaaS + Hanoi FloodOps application API (Java 21)");
                manifest.put("stage", "DEVELOPER_PREVIEW_MVP");
                manifest.put("version", "0.2.0-alpha");
                manifest.put("runtime", "OpenJDK 21 LTS, virtual threads");
                manifest.put("architecture", "DX-OS Open-Core (core/identity, core/api-gateway, core/workflow, core/data-services, apps/floodops)");
                manifest.put("license", "Apache-2.0");
                manifest.put("data_notice", "Dữ liệu demo là mô phỏng; xem docs/api-spec.md.");
                manifest.put("postman_collection", "tests/postman/OpenDXOS_FloodOps.postman_collection.json");
                manifest.put("endpoints", endpoints);
                sendJson(ex, 200, manifest, null);
                return;
            }
            if ("/api/v1/auth/accounts".equals(path)) {
                sendJson(ex, 200, auth.listDemoAccounts(), null);
                return;
            }
            if ("/api/v1/auth/pkce/authorize-url".equals(path)) {
                Map<String, String> params = parseQueryParams(ex.getRequestURI().getRawQuery());
                try {
                    sendJson(ex, 200, KeycloakOidcEngine.generatePkceSession(
                            params.getOrDefault("redirect_uri", "http://localhost:8000/callback"),
                            params.get("state"), params.get("code_challenge")), null);
                } catch (IllegalArgumentException bad) {
                    sendJson(ex, 400, Map.of("error", "INVALID_CODE_CHALLENGE", "message", bad.getMessage()), null);
                }
                return;
            }
            if ("/api/v1/health".equals(path)) {
                var store = service.getStore();
                Map<String, Object> coreServices = new LinkedHashMap<>();
                coreServices.put("identity_sso", "Keycloak OIDC / RBAC (" + KeycloakOidcEngine.getActiveAuthMode() + ")");
                coreServices.put("api_gateway", "Apache APISIX Zero-Trust (org.openagrios.core.gateway)");
                coreServices.put("structured_db", store.getStorageEngineMode());
                coreServices.put("unstructured_storage", "SeaweedFS S3 Object Storage (" + store.s3Storage.getS3Endpoint() + ")");
                coreServices.put("workflow_engine", "Flowable BPMN 2.0 Engine (" + store.bpmnEngine.getFlowableRestUrl() + ")");
                coreServices.put("audit_ledger", "SHA-256 Immutable Hash-Chain (org.openagrios.core.dataservices)");
                coreServices.put("event_bus", store.eventBus.status());
                coreServices.put("malware_scanner", store.malwareScanner.status());
                coreServices.put("cold_analytics_lake", store.analyticsLake.probe());
                Map<String, Object> health = new LinkedHashMap<>();
                health.put("status", "HEALTHY");
                health.put("stage", "DEVELOPER_PREVIEW_MVP");
                health.put("platform", "OpenDXOS DX-OS Open-Core Headless PaaS (Java 21 LTS) + Hanoi FloodOps");
                health.put("license", "Apache-2.0");
                health.put("identity_auth_mode", KeycloakOidcEngine.getActiveAuthMode().name());
                health.put("identity_ephemeral_key", KeycloakOidcEngine.isEphemeralKeyInUse());
                health.put("core_services", coreServices);
                health.put("registered_roles", KeycloakOidcEngine.roleHierarchy());
                health.put("bpmn_definitions", store.bpmnEngine.getDefinitions());
                sendJson(ex, 200, health, null);
                return;
            }

            AuthContext who = authenticate(ex);
            if (who == null) {
                sendUnauthorized(ex);
                return;
            }
            if ("/api/v1/stream/events".equals(path)) {
                handleSseStream(ex, who);
                return;
            }
            if ("/api/v1/auth/userinfo".equals(path)) {
                sendJson(ex, 200, Map.of("authenticated", true, "user", who.toMap()), who);
                return;
            }
            if ("/api/v1/state".equals(path)) {
                sendJson(ex, 200, service.getState(who), who);
                return;
            }
            if ("/api/v1/digital-twin/entities".equals(path)) {
                sendJson(ex, 200, service.getDigitalTwinEntities(who), who);
                return;
            }
            if ("/api/v1/audit/verify".equals(path)) {
                sendJson(ex, 200, service.getStore().auditLedger.verifyChainIntegrity(), who);
                return;
            }
            if (path.startsWith("/api/v1/analytics/")) {
                if (!FloodRoles.DISPATCHER.equals(who.role()) && !FloodRoles.PLATFORM_ADMIN.equals(who.role())) {
                    sendJson(ex, 403, Map.of("error", "forbidden",
                            "message", "Cold analytics is restricted to DISPATCHER / PLATFORM_ADMIN."), who);
                    return;
                }
                String queryName = path.substring("/api/v1/analytics/".length());
                AnalyticsLakeClient.Result lake = service.getStore().analyticsLake.query(queryName, who.organizationId());
                sendJson(ex, lake.status(), lake.body(), who);
                return;
            }
            if (path.startsWith("/api/v1/audit/lineage/")) {
                String corrId = segment(path, path.split("/").length - 1);
                sendJson(ex, 200, service.getStore().auditLedger.getLineageByCorrelation(who.organizationId(), corrId), who);
                return;
            }
            sendJson(ex, 404, Map.of("error", "NOT_FOUND", "path", path), who);
        }

        private void handlePost(HttpExchange ex, String path) throws IOException {
            if ("/api/v1/internal/telemetry".equals(path)) {
                if (!ingestTokenValid(ex)) return;
                HttpResult res = service.ingestTelemetry(readJsonBody(ex));
                sendJson(ex, res.status(), res.body(), null);
                return;
            }
            Map<String, Object> body = readJsonBody(ex);
            if ("/api/v1/auth/login".equals(path)) {
                HttpResult res = auth.loginOidc(body);
                sendJson(ex, res.status(), res.body(), null);
                return;
            }
            if ("/api/v1/auth/pkce/authorize-code".equals(path)) {
                HttpResult res = auth.acquirePkceAuthCode(body);
                sendJson(ex, res.status(), res.body(), null);
                return;
            }
            if ("/api/v1/auth/pkce/token".equals(path)) {
                HttpResult res = auth.exchangePkceToken(body);
                sendJson(ex, res.status(), res.body(), null);
                return;
            }

            AuthContext who = authenticate(ex);
            if (who == null) {
                sendUnauthorized(ex);
                return;
            }
            HttpResult res = route(path, who, body);
            sendJson(ex, res.status(), res.body(), who);
        }

        private HttpResult route(String path, AuthContext who, Map<String, Object> body) {
            if ("/api/v1/sim/reset".equals(path)) {
                return service.resetDemo(who);
            }
            if ("/api/v1/flood-reports".equals(path)) {
                return service.createFloodReport(who, body);
            }
            if (path.startsWith("/api/v1/flood-reports/") && path.endsWith("/verify")) {
                return service.verifyFloodReport(who, segment(path, 4), body);
            }
            if ("/api/v1/dispatch-orders".equals(path)) {
                return service.createDispatchOrder(who, body);
            }
            if (path.startsWith("/api/v1/dispatch-orders/") && path.endsWith("/status")) {
                return service.updateOrderStatus(who, segment(path, 4), body);
            }
            if ("/api/v1/field-incidents".equals(path)) {
                return service.reportFieldIncident(who, body);
            }
            if (path.startsWith("/api/v1/field-incidents/") && path.endsWith("/approve-replan")) {
                return service.approveReplan(who, segment(path, 4), body);
            }
            if (path.startsWith("/api/v1/field-incidents/") && path.endsWith("/repair-ticket")) {
                return service.updateRepairTicket(who, segment(path, 4), body);
            }
            if ("/api/v1/resolutions".equals(path)) {
                return service.confirmResolution(who, body);
            }
            if (path.startsWith("/api/v1/shelters/") && path.endsWith("/occupancy")) {
                return service.updateShelterOccupancy(who, segment(path, 4), body);
            }
            return new HttpResult(404, Map.of("error", "NOT_FOUND", "path", path));
        }

        private AuthContext authenticate(HttpExchange ex) {
            return KeycloakOidcEngine.authenticateBearer(ex.getRequestHeaders().getFirst("Authorization"));
        }

        private void sendUnauthorized(HttpExchange ex) throws IOException {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "UNAUTHORIZED");
            err.put("status", 401);
            err.put("gateway", "Apache APISIX Zero-Trust Gateway");
            err.put("message", "401 Unauthorized: thiếu hoặc sai chữ ký Bearer JWT, thiếu claim organization_id, hoặc tài khoản chưa được cấp vai trò hợp lệ.");
            sendJson(ex, 401, err, null);
        }

        /**
         * Service-to-service guard for {@code /api/v1/internal/*}: shared secret in {@code X-Ingest-Token}.
         * Fails closed (503) when {@code OPENAGRIOS_INGEST_TOKEN} is not configured; APISIX additionally blocks these
         * paths at the edge so they are reachable only inside the container network.
         */
        private boolean ingestTokenValid(HttpExchange ex) throws IOException {
            String expected = System.getenv("OPENAGRIOS_INGEST_TOKEN");
            if (expected == null || expected.isBlank()) {
                sendJson(ex, 503, Map.of("error", "INGEST_DISABLED",
                        "message", "OPENAGRIOS_INGEST_TOKEN is not configured; telemetry ingestion is disabled."), null);
                return false;
            }
            String given = ex.getRequestHeaders().getFirst("X-Ingest-Token");
            boolean ok = given != null && java.security.MessageDigest.isEqual(
                    given.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8));
            if (!ok) {
                sendJson(ex, 401, Map.of("error", "INVALID_INGEST_TOKEN", "message", "Missing or invalid X-Ingest-Token."), null);
            }
            return ok;
        }

        /** Client sent a request body that is not a single well-formed JSON object. */
        private static final class BadRequestException extends RuntimeException {
            BadRequestException(String message) {
                super(message);
            }
        }

        private Map<String, Object> readJsonBody(HttpExchange ex) throws IOException {
            try (InputStream is = ex.getRequestBody()) {
                byte[] bytes = is.readAllBytes();
                if (bytes.length == 0) return new LinkedHashMap<>();
                try {
                    return JsonCodec.parseObjectStrict(new String(bytes, StandardCharsets.UTF_8));
                } catch (IllegalArgumentException e) {
                    throw new BadRequestException(e.getMessage());
                }
            }
        }

        private void sendJson(HttpExchange ex, int status, Map<String, Object> data, AuthContext who) throws IOException {
            byte[] bytes = JsonCodec.toJson(data).getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            for (var entry : ZeroTrustGateway.buildZeroTrustHeaders(who).entrySet()) {
                ex.getResponseHeaders().set(entry.getKey(), entry.getValue());
            }
            ex.sendResponseHeaders(status, bytes.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(bytes);
            }
        }

        private void handleSseStream(HttpExchange ex, AuthContext who) throws IOException {
            ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
            ex.getResponseHeaders().set("Cache-Control", "no-cache, no-transform");
            ex.getResponseHeaders().set("Connection", "keep-alive");
            ex.sendResponseHeaders(200, 0);
            try (OutputStream os = ex.getResponseBody()) {
                Map<String, Object> hello = new LinkedHashMap<>();
                hello.put("status", "STREAM_ONLINE");
                hello.put("tenant", who.organizationId());
                hello.put("user", who.username());
                hello.put("ts", java.time.Instant.now().toString());
                os.write(("event: connected\ndata: " + JsonCodec.toJson(hello) + "\n\n").getBytes(StandardCharsets.UTF_8));
                os.flush();
                var recentLogs = service.getStore().auditLedger.listRecentByTenant(who.organizationId(), 5);
                if (!FloodRoles.DISPATCHER.equals(who.role()) && !FloodRoles.PLATFORM_ADMIN.equals(who.role())) {
                    recentLogs.removeIf(record -> !who.username().equals(String.valueOf(record.get("actor_user_id"))));
                }
                os.write(("event: audit_sync\ndata: " + JsonCodec.toJson(Map.of("recent_logs", recentLogs)) + "\n\n").getBytes(StandardCharsets.UTF_8));
                os.flush();
                for (int i = 0; i < 5; i++) {
                    try {
                        Thread.sleep(3000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                    String ping = "event: heartbeat\ndata: " + JsonCodec.toJson(Map.of("ping", true, "ts", java.time.Instant.now().toString())) + "\n\n";
                    os.write(ping.getBytes(StandardCharsets.UTF_8));
                    os.flush();
                }
            } catch (Exception ignored) {
                // Client disconnected
            }
        }
    }

    /** The directory that holds infra/bpmn. Fails loudly instead of guessing a machine-specific path. */
    public static File resolveProjectRoot() {
        File cwd = new File(System.getProperty("user.dir"));
        if (new File(cwd, "infra/bpmn").exists()) {
            return cwd;
        }
        if (cwd.getParentFile() != null && new File(cwd.getParentFile(), "infra/bpmn").exists()) {
            return cwd.getParentFile();
        }
        throw new IllegalStateException("Cannot find infra/bpmn from " + cwd + ": run from the repository root.");
    }

    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8000"));
        FloodOpsServer app = new FloodOpsServer(resolveProjectRoot());
        app.start(port);
        System.out.println("[OpenDXOS Java 21 Headless Core PaaS + Hanoi FloodOps] Running at http://localhost:" + port);
        Thread.currentThread().join();
    }
}
