// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.tests;

import org.floodos.apps.floodos.FloodOSServer;
import org.floodos.core.dataservices.JsonCodec;
import org.floodos.core.identity.KeycloakOidcEngine;

import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

/**
 * In-process acceptance suite for FloodOS: the real HTTP server on an ephemeral port, the real router, the
 * real RBAC / ownership / conflict rules and the real hash-chained ledger, with the development token issuer.
 * (The full-stack suite, tests/e2e_full_stack_test.sh, repeats the golden path against Docker with Keycloak, APISIX,
 * PostgreSQL row-level security, Flowable, SeaweedFS and Kafka.)
 *
 * <p>Story: a resident reports a flood, the dispatcher verifies and dispatches a boat, the field team starts, the boat
 * breaks down, the dispatcher approves a ranked replacement, the field team finishes, the resident confirms, and the
 * audit chain proves the whole case.
 */
public final class AcceptanceTestRunner {

    private static final int TEST_PORT = 18091;
    private static final String BASE_URL = "http://127.0.0.1:" + TEST_PORT;
    private static final HttpClient CLIENT = HttpClient.newHttpClient();
    private static int passed = 0;

    private record ApiRes(int status, Map<String, Object> body) {}

    private static ApiRes api(String method, String path, String token, Map<String, Object> payload) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder().uri(URI.create(BASE_URL + path)).header("Content-Type", "application/json");
        if (token != null) b.header("Authorization", "Bearer " + token);
        if ("POST".equals(method)) {
            b.POST(HttpRequest.BodyPublishers.ofString(JsonCodec.toJson(payload != null ? payload : Map.of())));
        } else {
            b.GET();
        }
        HttpResponse<String> resp = CLIENT.send(b.build(), HttpResponse.BodyHandlers.ofString());
        return new ApiRes(resp.statusCode(), JsonCodec.parseObject(resp.body()));
    }

    private static void check(boolean condition, String msg) {
        if (!condition) throw new AssertionError("TEST FAILED: " + msg);
        passed++;
        System.out.println("  [ok] " + (msg.length() > 150 ? msg.substring(0, 150) + "..." : msg));
    }

    private static Map<String, Object> body(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static String login(String username) throws Exception {
        ApiRes r = api("POST", "/api/v1/auth/login", null, body("username", username, "password", "123456"));
        check(r.status() == 200 && r.body().get("access_token") != null, "login " + username);
        return String.valueOf(r.body().get("access_token"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(ApiRes state, String key) {
        return (List<Map<String, Object>>) state.body().get(key);
    }

    private static boolean has(List<Map<String, Object>> rows, String key, String value) {
        return rows.stream().anyMatch(r -> value.equals(String.valueOf(r.get(key))));
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        File root = FloodOSServer.resolveProjectRoot();
        FloodOSServer server = new FloodOSServer(root);
        KeycloakOidcEngine.setAuthModeForTesting(KeycloakOidcEngine.AuthMode.DEV_MOCK_STANDALONE);
        server.start(TEST_PORT);
        try {
            System.out.println("============================================================================");
            System.out.println("HANOI FLOODOS - IN-PROCESS ACCEPTANCE SUITE (JAVA 21)");
            System.out.println("============================================================================");

            System.out.println("\n[1] Platform health, workflow definitions and registered roles");
            ApiRes health = api("GET", "/api/v1/health", null, null);
            check(health.status() == 200 && "HEALTHY".equals(health.body().get("status")), "health is HEALTHY");
            Map<String, Object> defs = (Map<String, Object>) health.body().get("bpmn_definitions");
            check(defs.containsKey("flood_report_lifecycle") && defs.containsKey("dispatch_replan"), "both BPMN processes are loaded from infra/bpmn");
            List<String> roles = (List<String>) health.body().get("registered_roles");
            check(roles.equals(List.of("PLATFORM_ADMIN", "DISPATCHER", "RESOURCE_MANAGER", "FIELD_TEAM", "REPORTER")), "the application registered its roles: " + roles);

            System.out.println("\n[2] Authentication fails closed");
            check(api("GET", "/api/v1/state", null, null).status() == 401, "no token -> 401");
            check(api("GET", "/api/v1/state", "garbage", null).status() == 401, "bad token -> 401");
            check(api("POST", "/api/v1/auth/login", null, body("username", "reporter_lan", "password", "wrong")).status() == 401, "wrong password -> 401");
            check(api("POST", "/api/v1/auth/login", null, body("username", "farmer_ba", "password", "123456")).status() == 401, "former rice-harvest account no longer exists");

            String reporter = login("reporter_lan");
            String otherReporter = login("reporter_hung");
            String dispatcher = login("dispatcher_hoa");
            String boatTeam = login("team_binh");
            String truckTeam = login("team_cuong");
            String manager = login("resource_giang");
            String foreignDispatcher = login("dispatcher_tuan");

            System.out.println("\n[3] Row-level scope per role (what each person can see)");
            ApiRes lanState = api("GET", "/api/v1/state", reporter, null);
            check(has(list(lanState, "reports"), "report_id", "FR-0001") && !has(list(lanState, "reports"), "report_id", "FR-0002"),
                    "a resident sees only their own reports");
            check(!JsonCodec.toJson(lanState.body()).contains("FR-0002") && !JsonCodec.toJson(lanState.body()).contains("FR-0091"),
                    "other residents' and other tenants' reports appear nowhere in the payload");
            check(list(api("GET", "/api/v1/state", dispatcher, null), "reports").size() == 4, "the dispatcher sees the four reports of the tenant");
            check(list(api("GET", "/api/v1/state", manager, null), "reports").isEmpty(), "the resource manager sees no citizen report");
            check(list(api("GET", "/api/v1/state", foreignDispatcher, null), "reports").size() == 1, "another tenant's dispatcher sees only its own data");
            Map<String, Object> notice = api("GET", "/api/v1/state", dispatcher, null).body();
            check(String.valueOf(notice.get("data_notice")).contains("MÔ PHỎNG"), "the state says the demo data is simulated");

            System.out.println("\n[4] Report -> verify -> dispatch");
            ApiRes created = api("POST", "/api/v1/flood-reports", reporter,
                    body("lat", 20.9665, "lng", 105.8712, "depth_cm", 55, "need_type", "EVACUATION", "people_affected", 5, "description", "nước vào nhà"));
            check(created.status() == 201, "resident files a report: " + created.body());
            String report = String.valueOf(created.body().get("report_id"));
            check(api("POST", "/api/v1/dispatch-orders", reporter, body()).status() == 403, "a resident cannot dispatch");
            check(api("POST", "/api/v1/flood-reports/" + report + "/verify", reporter, body("decision", "VERIFIED", "priority", "HIGH")).status() == 403, "a resident cannot verify");
            check(api("POST", "/api/v1/dispatch-orders", dispatcher, body("report_id", report, "vehicle_id", "V02", "team_id", "T02",
                    "start_time", "2031-01-01T08:00:00Z", "end_time", "2031-01-01T10:00:00Z")).status() == 409, "dispatching an unverified report is refused");
            check(api("POST", "/api/v1/flood-reports/" + report + "/verify", dispatcher, body("decision", "VERIFIED", "priority", "URGENT")).status() == 200, "dispatcher verifies");
            ApiRes order = api("POST", "/api/v1/dispatch-orders", dispatcher, body("report_id", report, "vehicle_id", "V02", "team_id", "T02",
                    "start_time", "2031-01-01T08:00:00Z", "end_time", "2031-01-01T10:00:00Z"));
            check(order.status() == 201, "dispatcher dispatches boat V02 + team T02: " + order.body());
            String orderId = String.valueOf(order.body().get("order_id"));

            System.out.println("\n[5] Double booking is blocked");
            String second = String.valueOf(api("POST", "/api/v1/flood-reports", otherReporter,
                    body("lat", 20.9665, "lng", 105.8712, "depth_cm", 40, "need_type", "EVACUATION")).body().get("report_id"));
            api("POST", "/api/v1/flood-reports/" + second + "/verify", dispatcher, body("decision", "VERIFIED", "priority", "HIGH"));
            ApiRes clash = api("POST", "/api/v1/dispatch-orders", dispatcher, body("report_id", second, "vehicle_id", "V02", "team_id", "T03",
                    "start_time", "2031-01-01T09:00:00Z", "end_time", "2031-01-01T11:00:00Z"));
            check(clash.status() == 409 && "RESOURCE_TIME_OVERLAP".equals(clash.body().get("error")), "same vehicle, overlapping window -> 409 RESOURCE_TIME_OVERLAP");
            ApiRes teamClash = api("POST", "/api/v1/dispatch-orders", dispatcher, body("report_id", second, "vehicle_id", "V01", "team_id", "T02",
                    "start_time", "2031-01-01T09:00:00Z", "end_time", "2031-01-01T11:00:00Z"));
            check(teamClash.status() == 409 && "HOLDER_TIME_OVERLAP".equals(teamClash.body().get("error")), "same team, overlapping window -> 409 HOLDER_TIME_OVERLAP");

            System.out.println("\n[6] Field team works its own order only");
            check(api("POST", "/api/v1/dispatch-orders/" + orderId + "/status", boatTeam, body("status", "IN_PROGRESS", "progress_pct", 10)).status() == 404,
                    "another team's order is invisible (404)");
            check(api("POST", "/api/v1/dispatch-orders/" + orderId + "/status", truckTeam, body("status", "IN_PROGRESS", "progress_pct", 10)).status() == 200, "the right team starts the order");
            check(api("POST", "/api/v1/dispatch-orders/" + orderId + "/status", truckTeam, body("status", "IN_PROGRESS", "progress_pct", 5, "note", "x")).status() == 409, "progress cannot go backwards");

            System.out.println("\n[7] Incident, ranked replacements and human approval");
            ApiRes incident = api("POST", "/api/v1/field-incidents", truckTeam,
                    body("vehicle_id", "V02", "severity", "CRITICAL", "incident_type", "PROPELLER_FOULED", "description", "vướng rác", "estimated_downtime_hours", 4));
            check(incident.status() == 201, "field team reports a breakdown of V02: " + incident.body());
            String incId = String.valueOf(incident.body().get("incident_id"));
            List<Map<String, Object>> options = (List<Map<String, Object>>) incident.body().get("candidate_options");
            check(!options.isEmpty() && options.stream().noneMatch(o -> "V02".equals(o.get("vehicle_id"))), "replacements are ranked and never include the broken vehicle");
            check(options.stream().allMatch(o -> "STRAIGHT_LINE_HAVERSINE".equals(o.get("distance_kind"))), "every option says its distance is straight-line");
            check(api("POST", "/api/v1/field-incidents/" + incId + "/approve-replan", truckTeam, body("option_id", "x")).status() == 403, "the field team cannot approve");
            check(api("POST", "/api/v1/field-incidents/" + incId + "/approve-replan", dispatcher, body()).status() == 400, "approval requires an explicit option");
            String chosen = String.valueOf(options.get(0).get("option_id"));
            ApiRes approved = api("POST", "/api/v1/field-incidents/" + incId + "/approve-replan", dispatcher, body("option_id", chosen));
            check(approved.status() == 200 && String.valueOf(approved.body().get("new_order_id")).endsWith("-R1"), "dispatcher approves the replacement: " + approved.body());
            String newOrder = String.valueOf(approved.body().get("new_order_id"));
            check(api("POST", "/api/v1/field-incidents/" + incId + "/repair-ticket", boatTeam, body("diagnosis", "x")).status() == 403, "a field team cannot touch the repair ticket");
            check(api("POST", "/api/v1/field-incidents/" + incId + "/repair-ticket", manager, body("diagnosis", "đã gỡ rác, thay chân vịt", "is_resolved", true)).status() == 200, "the resource manager closes the repair ticket");

            System.out.println("\n[8] Completion and confirmation");
            Map<String, Object> repState = api("GET", "/api/v1/state", dispatcher, null).body();
            String newTeam = null;
            for (Map<String, Object> o : (List<Map<String, Object>>) repState.get("orders")) if (newOrder.equals(o.get("order_id"))) newTeam = String.valueOf(o.get("team_id"));
            String newTeamToken = "T01".equals(newTeam) ? boatTeam : "T02".equals(newTeam) ? truckTeam : login("team_dung");
            check(api("POST", "/api/v1/dispatch-orders/" + newOrder + "/status", newTeamToken, body("status", "IN_PROGRESS", "progress_pct", 30)).status() == 200, "the replacement team starts");
            ApiRes done = api("POST", "/api/v1/dispatch-orders/" + newOrder + "/status", newTeamToken,
                    body("status", "COMPLETED", "progress_pct", 100, "outcome", "RESOLVED", "final_depth_cm", 8));
            check(done.status() == 200 && done.body().get("resolution_id") != null, "the replacement team completes: " + done.body());
            String resolution = String.valueOf(done.body().get("resolution_id"));
            check(api("POST", "/api/v1/resolutions", otherReporter, body("resolution_id", resolution, "decision", "CONFIRMED")).status() == 404, "another resident cannot confirm (and cannot tell it exists)");
            check(api("POST", "/api/v1/resolutions", newTeamToken, body("resolution_id", resolution, "decision", "CONFIRMED")).status() == 403, "the field team cannot confirm its own work");
            ApiRes confirmed = api("POST", "/api/v1/resolutions", reporter, body("resolution_id", resolution, "decision", "CONFIRMED"));
            check(confirmed.status() == 200 && "RESOLVED".equals(confirmed.body().get("report_status")), "the resident confirms and the case is resolved");

            System.out.println("\n[9] The audit chain proves the case");
            ApiRes verify = api("GET", "/api/v1/audit/verify", dispatcher, null);
            check(Boolean.TRUE.equals(verify.body().get("chain_valid")), "hash chain verifies end to end");
            ApiRes lineage = api("GET", "/api/v1/audit/lineage/CORR-" + report, dispatcher, null);
            String lineageText = JsonCodec.toJson(lineage.body());
            check(lineage.status() == 200 && lineageText.contains("CREATE_FLOOD_REPORT") && lineageText.contains("CONFIRM_RESOLUTION_AND_SEAL_LEDGER"),
                    "the case lineage runs from the report to the sealed confirmation");
            ApiRes lanAfter = api("GET", "/api/v1/state", reporter, null);
            check(has(list(lanAfter, "reports"), "report_id", report) && list(lanAfter, "reports").stream().anyMatch(r -> report.equals(r.get("report_id")) && "RESOLVED".equals(r.get("status"))),
                    "the resident sees their report as RESOLVED");

            System.out.println("\n[10] Ingestion endpoints and the demo reset are closed to normal users");
            check(api("POST", "/api/v1/sim/reset", dispatcher, body()).status() == 403, "a dispatcher cannot reset the data");
            check(api("POST", "/api/v1/sim/reset", reporter, body()).status() == 403, "a resident cannot reset the data");
            check(api("GET", "/api/v1/internal/assets", dispatcher, null).status() == 503 || api("GET", "/api/v1/internal/assets", dispatcher, null).status() == 401,
                    "the internal roster needs the ingest token, not a user token");

            System.out.println("\n============================================================================");
            System.out.println("ACCEPTANCE: " + passed + " checks passed");
            System.out.println("============================================================================");
        } finally {
            server.stop();
            KeycloakOidcEngine.resetAuthModeForTesting();
        }
        System.exit(0);
    }
}
