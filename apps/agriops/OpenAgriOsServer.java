package org.openagrios.apps.agriops;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import org.openagrios.core.dataservices.*;
import org.openagrios.core.gateway.ZeroTrustGateway;
import org.openagrios.core.identity.KeycloakOidcEngine;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;
import org.openagrios.core.workflow.BpmnWorkflowEngine;
import org.openagrios.apps.agriops.AgriOpsService.HttpResult;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;

/**
 * OPENAGRIOS — CỔNG ĐIỀU PHỐI HTTP SERVER MỎNG (THIN API ROUTER - JAVA 21 LTS)
 * ============================================================================
 * Định tuyến các REST API `/api/v1/*` xuống kiến trúc 3 tầng:
 * - Tầng 1 (`core/`):
 *   + identity: Keycloak OIDC / JWT Engine
 *   + api-gateway: APISIX Zero-Trust Gateway Guard
 *   + workflow: Flowable BPMN 2.0 XML Engine
 *   + data-services: SeaweedFS S3, PostgreSQL RLS, SHA-256 Audit Ledger, NGSI-LD Twin Mapper, Spatial & Conflict Engines
 * - Tầng 2 & 3 (`apps/agriops`): Phân hệ Điều phối Cơ giới hóa & Phục hồi Đứt gãy Nông nghiệp.
 */
public final class OpenAgriOsServer {

    private final AgriOpsService agriOpsService;
    private HttpServer server;

    public OpenAgriOsServer(File projectRootDir) {
        File bpmnDir = new File(projectRootDir, "infra/bpmn");
        ImmutableAuditLedger auditLedger = new ImmutableAuditLedger();
        SeaweedS3StorageService s3Storage = new SeaweedS3StorageService();
        BpmnWorkflowEngine bpmnEngine = new BpmnWorkflowEngine(bpmnDir);
        AgriDataStore dataStore = new AgriDataStore(auditLedger, s3Storage, bpmnEngine);
        this.agriOpsService = new AgriOpsService(dataStore);
    }

    public AgriOpsService getAgriOpsService() {
        return agriOpsService;
    }

    public void start(int port) throws IOException {
        server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        server.createContext("/", new RouterHandler(agriOpsService));
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private static final class RouterHandler implements HttpHandler {
        private final AgriOpsService service;

        RouterHandler(AgriOpsService service) {
            this.service = service;
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
            } catch (Exception e) {
                e.printStackTrace();
                sendJson(ex, 500, Map.of("error", "INTERNAL_SERVER_ERROR", "message", String.valueOf(e.getMessage())), null);
            }
        }

        private void handleGet(HttpExchange ex, String path) throws IOException {
            // 1. Public Headless Discovery Manifest
            if ("/".equals(path) || "/api/v1".equals(path)) {
                Map<String, Object> endpoints = new LinkedHashMap<>();
                endpoints.put("health", "GET /api/v1/health");
                endpoints.put("demo_accounts", "GET /api/v1/auth/accounts");
                endpoints.put("oidc_login", "POST /api/v1/auth/login");
                endpoints.put("userinfo", "GET /api/v1/auth/userinfo");
                endpoints.put("tenant_state_rls", "GET /api/v1/state");
                endpoints.put("ngsi_ld_digital_twin", "GET /api/v1/digital-twin/entities");
                endpoints.put("create_request", "POST /api/v1/requests");
                endpoints.put("dispatch_assignment", "POST /api/v1/assignments");
                endpoints.put("report_incident_s3", "POST /api/v1/incidents");
                endpoints.put("approve_bpmn_replan", "POST /api/v1/incidents/{incident_id}/approve-replan");
                endpoints.put("update_repair_ticket", "POST /api/v1/incidents/{incident_id}/repair");
                endpoints.put("confirm_acceptance", "POST /api/v1/acceptances");
                endpoints.put("verify_audit_chain", "GET /api/v1/audit/verify");
                endpoints.put("data_lineage", "GET /api/v1/audit/lineage/{correlation_id}");
                endpoints.put("sim_clock_tick", "POST /api/v1/sim/tick");
                endpoints.put("sim_reset", "POST /api/v1/sim/reset");

                Map<String, Object> manifest = new LinkedHashMap<>();
                manifest.put("service", "OpenAgriOS Tier-1 Headless Core PaaS (Java 21 Modular Architecture)");
                manifest.put("runtime", "OpenJDK 21 LTS — Virtual Threads");
                manifest.put("architecture", "DX-OS Open-Core (core/identity, core/api-gateway, core/workflow, core/data-services, apps/agriops)");
                manifest.put("license", "Apache-2.0");
                manifest.put("openapi_spec_url", "http://localhost:8000/openapi.json");
                manifest.put("postman_collection", "tests/postman/OpenAgriOS_Tier1_Core.postman_collection.json");
                manifest.put("endpoints", endpoints);
                sendJson(ex, 200, manifest, null);
                return;
            }

            if ("/openapi.json".equals(path)) {
                Map<String, Object> spec = new LinkedHashMap<>();
                spec.put("openapi", "3.0.3");
                spec.put("info", Map.of(
                        "title", "OpenAgriOS Tier-1 Headless Core PaaS API (Java 21)",
                        "version", "2.0.0",
                        "license", Map.of("name", "Apache-2.0", "url", "https://www.apache.org/licenses/LICENSE-2.0")
                ));
                sendJson(ex, 200, spec, null);
                return;
            }

            if ("/api/v1/auth/accounts".equals(path)) {
                sendJson(ex, 200, service.listDemoAccounts(), null);
                return;
            }

            if ("/api/v1/health".equals(path)) {
                Map<String, Object> coreServices = new LinkedHashMap<>();
                coreServices.put("identity_sso", "Keycloak OIDC / RBAC (org.openagrios.core.identity)");
                coreServices.put("api_gateway", "Apache APISIX Zero-Trust (org.openagrios.core.gateway)");
                coreServices.put("structured_db", "PostgreSQL 16 + GiST + Row-Level Security (org.openagrios.core.dataservices)");
                coreServices.put("unstructured_storage", "SeaweedFS S3 Object Storage (org.openagrios.core.dataservices)");
                coreServices.put("workflow_engine", "Flowable BPMN 2.0 XML Engine (org.openagrios.core.workflow)");
                coreServices.put("audit_ledger", "SHA-256 Immutable Hash-Chain (org.openagrios.core.dataservices)");

                Map<String, Object> health = new LinkedHashMap<>();
                health.put("status", "HEALTHY");
                health.put("platform", "OpenAgriOS DX-OS Open-Core Headless PaaS (Java 21 LTS)");
                health.put("license", "Apache-2.0 (100% OSI Compliant)");
                health.put("core_services", coreServices);
                health.put("bpmn_definitions", service.getStore().bpmnEngine.getDefinitions());
                sendJson(ex, 200, health, null);
                return;
            }

            // Protected GET endpoints require Bearer JWT
            AuthContext auth = authenticate(ex);
            if (auth == null) {
                sendUnauthorized(ex);
                return;
            }

            if ("/api/v1/auth/userinfo".equals(path)) {
                sendJson(ex, 200, Map.of("authenticated", true, "user", auth.toMap()), auth);
                return;
            }

            if ("/api/v1/state".equals(path)) {
                sendJson(ex, 200, service.getTacticalState(auth), auth);
                return;
            }

            if ("/api/v1/digital-twin/entities".equals(path)) {
                sendJson(ex, 200, service.getDigitalTwinEntities(auth), auth);
                return;
            }

            if ("/api/v1/audit/verify".equals(path)) {
                sendJson(ex, 200, service.getStore().auditLedger.verifyChainIntegrity(), auth);
                return;
            }

            if (path.startsWith("/api/v1/audit/lineage/")) {
                String[] segs = path.split("/");
                String corrId = segs[segs.length - 1];
                sendJson(ex, 200, service.getStore().auditLedger.getLineageByCorrelation(auth.organizationId(), corrId), auth);
                return;
            }

            sendJson(ex, 404, Map.of("error", "NOT_FOUND", "path", path), auth);
        }

        private void handlePost(HttpExchange ex, String path) throws IOException {
            Map<String, Object> body = readJsonBody(ex);

            if ("/api/v1/auth/login".equals(path)) {
                HttpResult res = service.loginOidc(body);
                sendJson(ex, res.status(), res.body(), null);
                return;
            }

            AuthContext auth = authenticate(ex);
            if (auth == null) {
                sendUnauthorized(ex);
                return;
            }

            if ("/api/v1/sim/reset".equals(path)) {
                service.getStore().resetAndSeed();
                sendJson(ex, 200, Map.of("ok", true, "message", "Đã khôi phục dữ liệu hệ thống về trạng thái mặc định."), auth);
                return;
            }

            if ("/api/v1/requests".equals(path)) {
                HttpResult res = service.createServiceRequest(auth, body);
                sendJson(ex, res.status(), res.body(), auth);
                return;
            }

            if ("/api/v1/assignments".equals(path)) {
                HttpResult res = service.dispatchAssignment(auth, body);
                sendJson(ex, res.status(), res.body(), auth);
                return;
            }

            if ("/api/v1/incidents".equals(path)) {
                HttpResult res = service.reportMachineIncident(auth, body);
                sendJson(ex, res.status(), res.body(), auth);
                return;
            }

            if (path.startsWith("/api/v1/incidents/") && path.endsWith("/approve-replan")) {
                String[] segs = path.split("/");
                String incId = segs[4];
                HttpResult res = service.approveRescueReplan(auth, incId, body);
                sendJson(ex, res.status(), res.body(), auth);
                return;
            }

            if (path.startsWith("/api/v1/incidents/") && path.endsWith("/repair")) {
                String[] segs = path.split("/");
                String incId = segs[4];
                HttpResult res = service.updateRepairTicket(auth, incId, body);
                sendJson(ex, res.status(), res.body(), auth);
                return;
            }

            if ("/api/v1/acceptances".equals(path)) {
                HttpResult res = service.confirmAcceptance(auth, body);
                sendJson(ex, res.status(), res.body(), auth);
                return;
            }

            if ("/api/v1/sim/tick".equals(path)) {
                sendJson(ex, 200, service.tickSimulation(auth), auth);
                return;
            }

            sendJson(ex, 404, Map.of("error", "NOT_FOUND", "path", path), auth);
        }

        private AuthContext authenticate(HttpExchange ex) {
            String authHeader = ex.getRequestHeaders().getFirst("Authorization");
            return KeycloakOidcEngine.authenticateBearer(authHeader);
        }

        private void sendUnauthorized(HttpExchange ex) throws IOException {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "UNAUTHORIZED");
            err.put("status", 401);
            err.put("gateway", "Apache APISIX Zero-Trust Gateway");
            err.put("message", "401 Unauthorized: Thiếu hoặc sai chữ ký Keycloak Bearer JWT Token.");
            sendJson(ex, 401, err, null);
        }

        private Map<String, Object> readJsonBody(HttpExchange ex) throws IOException {
            try (InputStream is = ex.getRequestBody()) {
                byte[] bytes = is.readAllBytes();
                if (bytes.length == 0) return new LinkedHashMap<>();
                return JsonCodec.parseObject(new String(bytes, StandardCharsets.UTF_8));
            }
        }

        private void sendJson(HttpExchange ex, int status, Map<String, Object> data, AuthContext auth) throws IOException {
            byte[] bytes = JsonCodec.toJson(data).getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            Map<String, String> ztHeaders = ZeroTrustGateway.buildZeroTrustHeaders(auth);
            for (var entry : ztHeaders.entrySet()) {
                ex.getResponseHeaders().set(entry.getKey(), entry.getValue());
            }
            ex.sendResponseHeaders(status, bytes.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(bytes);
            }
        }
    }

    public static File resolveProjectRoot() {
        File cwd = new File(System.getProperty("user.dir"));
        if (new File(cwd, "infra/bpmn").exists()) {
            return cwd;
        }
        if (cwd.getParentFile() != null && new File(cwd.getParentFile(), "infra/bpmn").exists()) {
            return cwd.getParentFile();
        }
        return new File("D:/OpenAgriOS");
    }

    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8000"));
        File root = resolveProjectRoot();
        OpenAgriOsServer app = new OpenAgriOsServer(root);
        app.start(port);
        System.out.println("[OpenAgriOS Java 21 Headless Core PaaS] Running at http://localhost:" + port);
        Thread.currentThread().join();
    }
}
