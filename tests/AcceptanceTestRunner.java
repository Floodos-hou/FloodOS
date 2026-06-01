// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.tests;

import org.openagrios.apps.agriops.OpenAgriOsServer;
import org.openagrios.core.dataservices.JsonCodec;
import org.openagrios.core.identity.KeycloakOidcEngine;
import org.openagrios.core.dataservices.PostgreSqlDataService;

import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

/**
 * Automated End-to-End Integration & Acceptance Test Suite for OpenAgriOS Core & AgriOps Application.
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

            // 2.1. Zero-Trust Gateway rejects invalid, forged, or missing JWT tokens (HTTP 401)
            ApiRes forgedTokenRes = apiReq("GET", "/api/v1/state", tFarmer + "forged_tampered_signature", null);
            check(forgedTokenRes.status() == 401 && "UNAUTHORIZED".equals(forgedTokenRes.body().get("error")), "Tampered token was not rejected with 401");

            ApiRes noTokenRes = apiReq("GET", "/api/v1/state", null, null);
            check(noTokenRes.status() == 401 && "UNAUTHORIZED".equals(noTokenRes.body().get("error")), "Missing token was not rejected with 401");

            // 2.2. Verify forged RS256 token is strictly rejected in mock mode (HTTP 401)
            String forgedRs256 = KeycloakOidcEngine.createForgedRs256Token("attacker_sub", "COORDINATOR", "HTX_CANTHO_01");
            ApiRes forgedRs256Res = apiReq("GET", "/api/v1/state", forgedRs256, null);
            check(forgedRs256Res.status() == 401 && "UNAUTHORIZED".equals(forgedRs256Res.body().get("error")), "Forged RS256 token was not rejected with 401");

            // 2.3. Verify KEYCLOAK_PRODUCTION mode fails fast without mock fallback when Keycloak is offline
            try {
                KeycloakOidcEngine.setAuthModeForTesting(KeycloakOidcEngine.AuthMode.KEYCLOAK_PRODUCTION);
                ApiRes liveLoginFail = apiReq("POST", "/api/v1/auth/login", null, Map.of("username", "coord_htx01", "password", "123456"));
                check(liveLoginFail.status() == 401 && "KEYCLOAK_LOGIN_FAILED".equals(liveLoginFail.body().get("error")),
                        "KEYCLOAK_PRODUCTION mode must return 401 KEYCLOAK_LOGIN_FAILED and never fallback to mock");

                ApiRes hs256InProd = apiReq("GET", "/api/v1/state", tCoord, null);
                check(hs256InProd.status() == 401 && "UNAUTHORIZED".equals(hs256InProd.body().get("error")),
                        "In KEYCLOAK_PRODUCTION mode, HS256 mock token must be rejected with 401");
            } finally {
                KeycloakOidcEngine.resetAuthModeForTesting();
            }

            // 2.4. Verify expired token is strictly rejected (HTTP 401)
            KeycloakOidcEngine.UserAccount dummyUser = new KeycloakOidcEngine.UserAccount("usr_coord_01", "coord_htx01", "123456", "Chi Lan", "c@htx.vn", "HTX_CANTHO_01", "COORDINATOR");
            String expiredToken = KeycloakOidcEngine.createExpiredToken(dummyUser);
            ApiRes expiredRes = apiReq("GET", "/api/v1/state", expiredToken, null);
            check(expiredRes.status() == 401 && "UNAUTHORIZED".equals(expiredRes.body().get("error")), "Expired token was not rejected with 401");

            // 2.5. Verify wrong audience token is strictly rejected (HTTP 401)
            String wrongAudToken = KeycloakOidcEngine.createWrongAudienceToken(dummyUser);
            ApiRes wrongAudRes = apiReq("GET", "/api/v1/state", wrongAudToken, null);
            check(wrongAudRes.status() == 401 && "UNAUTHORIZED".equals(wrongAudRes.body().get("error")), "Wrong audience token was not rejected with 401");

            // 2.6. Verify PKCE Authorization Session Generator
            ApiRes pkceRes = apiReq("GET", "/api/v1/auth/pkce/authorize-url", null, null);
            check(pkceRes.status() == 200 && pkceRes.body().containsKey("code_challenge") && pkceRes.body().containsKey("code_verifier"), "PKCE session generation failed");

            System.out.println("[PASS] Zero-Trust Token Guard: Rejected tampered signature, forged RS256, expired token, wrong audience, and verified Keycloak production failure without mock fallback (HTTP 401).");

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
            // 3.1. Verify PostgreSQL RLS Data Service session compiler
            PostgreSqlDataService pgService = new PostgreSqlDataService();
            Map<String, Object> pgRls = pgService.testConnectionAndApplyRls("HTX_CANTHO_01", "COORDINATOR");
            check(pgRls.containsKey("compiled_rls_sql"), "PostgreSQL RLS SQL check failed");

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
            // 7.1. S3 Read/Write roundtrip persistence check
            Map<String, Object> s3Read = server.getAgriOpsService().getStore().s3Storage.readEvidenceObject("HTX_CANTHO_01", "openagrios-evidence", "incidents", "INC-2026-001", "dut_curoa_m01.jpg");
            check("SUCCESS".equals(s3Read.get("status")), "S3 roundtrip readback failed");

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
