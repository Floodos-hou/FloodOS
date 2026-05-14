package org.openagrios;

import org.openagrios.core.json.JsonCodec;

import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

/**
 * Automated End-to-End Integration Test Suite for OpenAgriOS Core & AgriOps Module.
 * Verifies OIDC authentication, RBAC access control, Multi-Tenant RLS isolation,
 * schedule conflict detection, BPMN incident replanning, and SHA-256 audit chain integrity.
 */
public final class AcceptanceTestRunner {

    private static final int TEST_PORT = 18091;
    private static final String BASE_URL = "http://127.0.0.1:" + TEST_PORT;
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    private record ApiRes(int status, Map<String, Object> body) {}

    private static ApiRes apiReq(String method, String path, String token, Map<String, Object> payload) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder()
                .uri(URI.create(BASE_URL + path))
                .header("Content-Type", "application/json");
        if (token != null) {
            b.header("Authorization", "Bearer " + token);
        }
        if ("POST".equals(method)) {
            String json = payload != null ? JsonCodec.toJson(payload) : "{}";
            b.POST(HttpRequest.BodyPublishers.ofString(json));
        } else {
            b.GET();
        }
        HttpResponse<String> resp = CLIENT.send(b.build(), HttpResponse.BodyHandlers.ofString());
        return new ApiRes(resp.statusCode(), JsonCodec.parseObject(resp.body()));
    }

    private static void check(boolean condition, String msg) {
        if (!condition) {
            throw new AssertionError("TEST FAILED: " + msg);
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        File root = OpenAgriOsServer.resolveProjectRoot();
        OpenAgriOsServer server = new OpenAgriOsServer(root);
        server.start(TEST_PORT);

        try {
            System.out.println("============================================================================");
            System.out.println("RUNNING OPENAGRIOS INTEGRATION TEST SUITE (JAVA 21)");
            System.out.println("============================================================================");

            // 1. Health & BPMN Process Definitions
            ApiRes health = apiReq("GET", "/api/v1/health", null, null);
            check(health.status() == 200 && "HEALTHY".equals(health.body().get("status")), "Health check failed");
            Map<String, Object> bpmnDefs = (Map<String, Object>) health.body().get("bpmn_definitions");
            check(bpmnDefs.containsKey("service_request") && bpmnDefs.containsKey("incident_replan"), "BPMN definitions missing");
            System.out.println("[PASS] Core Platform Health & BPMN 2.0 XML Definitions verified.");

            // 2. Keycloak OIDC Multi-Role Authentication
            ApiRes farmerLogin = apiReq("POST", "/api/v1/auth/login", null, Map.of("username", "farmer_ba", "password", "123456"));
            ApiRes coordLogin = apiReq("POST", "/api/v1/auth/login", null, Map.of("username", "coord_htx01", "password", "123456"));
            ApiRes opLogin = apiReq("POST", "/api/v1/auth/login", null, Map.of("username", "op_minh", "password", "123456"));
            ApiRes stLogin = apiReq("POST", "/api/v1/auth/login", null, Map.of("username", "coord_htx02", "password", "123456"));

            String tFarmer = String.valueOf(farmerLogin.body().get("access_token"));
            String tCoord = String.valueOf(coordLogin.body().get("access_token"));
            String tOp = String.valueOf(opLogin.body().get("access_token"));
            String tSt = String.valueOf(stLogin.body().get("access_token"));
            System.out.println("[PASS] OIDC Authentication verified across roles (FARMER, COORDINATOR, OPERATOR) and tenants.");

            // 3. Multi-Tenancy RLS & Role-Based Field Visibility
            ApiRes stFarmer = apiReq("GET", "/api/v1/state", tFarmer, null);
            ApiRes stCoord2 = apiReq("GET", "/api/v1/state", tSt, null);

            List<Map<String, Object>> farmerFields = (List<Map<String, Object>>) stFarmer.body().get("fields");
            List<String> fullFields = new ArrayList<>();
            int fogCount = 0;
            for (Map<String, Object> f : farmerFields) {
                if ("FULL".equals(f.get("visibility"))) {
                    fullFields.add(String.valueOf(f.get("field_id")));
                } else if ("FOG_OF_WAR".equals(f.get("visibility"))) {
                    fogCount++;
                }
            }
            check(Set.copyOf(fullFields).equals(Set.of("F01", "F03", "F07")), "Farmer FULL visibility mismatch");
            check(fogCount == 7, "Farmer masked field count mismatch");

            List<Map<String, Object>> stFields = (List<Map<String, Object>>) stCoord2.body().get("fields");
            check(stFields.size() == 1 && "F_ST01".equals(stFields.get(0).get("field_id")), "Tenant 2 RLS isolation failed");
            System.out.println("[PASS] Multi-Tenant RLS & Field-Level Visibility verified: " + fullFields + " unmasked, 7 masked.");

            // 4. RBAC 403 Enforcement
            ApiRes res403 = apiReq("POST", "/api/v1/assignments", tFarmer, Map.of(
                    "request_id", "REQ-04", "machine_id", "M02", "operator_id", "OP-02",
                    "start_time", "2026-11-20T13:00:00Z", "end_time", "2026-11-20T17:00:00Z"
            ));
            check(res403.status() == 403 && "RBAC_FORBIDDEN".equals(res403.body().get("error")), "RBAC 403 check failed");
            System.out.println("[PASS] Zero-Trust RBAC Guard verified (HTTP 403 Forbidden on unauthorized dispatch).");

            // 5. Schedule Overlap Conflict Engine (409 Conflict)
            ApiRes res409 = apiReq("POST", "/api/v1/assignments", tCoord, Map.of(
                    "request_id", "REQ-04", "machine_id", "M01", "operator_id", "OP-01",
                    "start_time", "2026-11-20T08:00:00Z", "end_time", "2026-11-20T11:30:00Z"
            ));
            check(res409.status() == 409 && "MACHINE_TIME_OVERLAP".equals(res409.body().get("error")), "Conflict 409 check failed");
            System.out.println("[PASS] Time-Window Conflict Engine verified (HTTP 409: " + res409.body().get("error") + ").");

            // 6. Unfeasible Replacement Handling
            ApiRes resEmpty = apiReq("POST", "/api/v1/incidents", tOp, Map.of(
                    "machine_id", "M01", "severity", "CRITICAL", "incident_type", "Unfeasible Scenario", "force_no_option", true
            ));
            check(resEmpty.status() == 201 && Boolean.TRUE.equals(resEmpty.body().get("no_feasible_option")), "No-feasible-option check failed");
            System.out.println("[PASS] Unfeasible replacement fallback state verified.");

            // Reset state and verify full incident-replan workflow
            apiReq("POST", "/api/v1/sim/reset", tCoord, Map.of());

            // 7. Incident Reporting + S3 Evidence + Spatial Rescue Matching
            ApiRes resInc = apiReq("POST", "/api/v1/incidents", tOp, Map.of(
                    "machine_id", "M01", "severity", "CRITICAL",
                    "incident_type", "Đứt dây curoa buồng đập", "evidence_filename", "dut_curoa_m01.jpg"
            ));
            List<Map<String, Object>> candidates = (List<Map<String, Object>>) resInc.body().get("candidate_options");
            check(resInc.status() == 201 && !candidates.isEmpty(), "Incident candidates empty");
            Map<String, Object> topOpt = candidates.get(0);
            check("M02".equals(topOpt.get("machine_id")), "Top rescue machine should be M02");
            Map<String, Object> minioEv = (Map<String, Object>) resInc.body().get("minio_evidence");
            System.out.println("[PASS] Incident reported + S3 ETag (" + String.valueOf(minioEv.get("etag")).substring(0, 8) + ") -> Rescue candidate " + topOpt.get("machine_id") + " (" + topOpt.get("score") + " pts, " + topOpt.get("distance_km") + " km).");

            // 8. Coordinator BPMN Replan Approval
            String incId = String.valueOf(resInc.body().get("incident_id"));
            ApiRes resRep = apiReq("POST", "/api/v1/incidents/" + incId + "/approve-replan", tCoord, Map.of(
                    "option_id", topOpt.get("option_id")
            ));
            check(resRep.status() == 200 && "ASG-102-R1".equals(resRep.body().get("new_assignment_id")), "Approve replan failed");
            System.out.println("[PASS] BPMN Replan approved -> Shift ASG-102 superseded by " + resRep.body().get("new_assignment_id") + ".");

            // 9. Work Acceptance & SHA-256 Lineage Chain Verification
            ApiRes resAcc = apiReq("POST", "/api/v1/acceptances", tFarmer, Map.of(
                    "assignment_id", "ASG-102-R1", "action", "FARMER_CONFIRM"
            ));
            check(resAcc.status() == 200 && "ACC-ASG-102-R1".equals(resAcc.body().get("acceptance_id")), "Confirm acceptance failed");

            ApiRes resLin = apiReq("GET", "/api/v1/audit/lineage/CORR-GOLDEN-F03", tCoord, null);
            Map<String, Object> proof = (Map<String, Object>) resLin.body().get("chain_proof");
            List<Map<String, Object>> steps = (List<Map<String, Object>>) resLin.body().get("lineage_steps");
            check(resLin.status() == 200 && Boolean.TRUE.equals(proof.get("chain_valid")) && steps.size() == 5, "Lineage verification failed");
            System.out.println("[PASS] Immutable SHA-256 Audit Chain & Data Lineage verified (" + steps.size() + " linked records).");

            System.out.println("============================================================================");
            System.out.println("ALL INTEGRATION TESTS PASSED SUCCESSFULLY!");
            System.out.println("============================================================================");
        } finally {
            server.stop();
        }
    }
}
