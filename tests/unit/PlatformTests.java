// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.tests.unit;

import static org.openagrios.tests.unit.TestKit.*;

import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.openagrios.apps.agriops.AgriDataStore;
import org.openagrios.apps.agriops.AgriModels.HarvesterMachine;
import org.openagrios.apps.agriops.AgriOpsService;
import org.openagrios.apps.agriops.AgriOpsService.HttpResult;
import org.openagrios.apps.agriops.OpenAgriOsServer;
import org.openagrios.core.dataservices.AnalyticsLakeClient;
import org.openagrios.core.dataservices.EventBusPublisher;
import org.openagrios.core.dataservices.ImmutableAuditLedger;
import org.openagrios.core.dataservices.JsonCodec;
import org.openagrios.core.dataservices.SeaweedS3StorageService;
import org.openagrios.core.identity.KeycloakOidcEngine;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthMode;
import org.openagrios.core.workflow.BpmnWorkflowEngine;

/** I/O adapters against local stand-in HTTP endpoints, application rules on the real in-memory store, and the HTTP layer. */
final class PlatformTests {

    private PlatformTests() {}

    /** Tiny scriptable HTTP endpoint that records every request it receives. */
    private static final class FakeEndpoint implements AutoCloseable {
        record Seen(String method, String path, String query, String contentType, String body) {}

        final HttpServer server;
        final List<Seen> seen = new CopyOnWriteArrayList<>();
        final AtomicInteger calls = new AtomicInteger();
        volatile java.util.function.IntUnaryOperator statusForCall = n -> 200;
        volatile String responseBody = "{}";

        FakeEndpoint() throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", ex -> {
                byte[] in = ex.getRequestBody().readAllBytes();
                seen.add(new Seen(ex.getRequestMethod(), ex.getRequestURI().getPath(), ex.getRequestURI().getRawQuery(),
                        ex.getRequestHeaders().getFirst("Content-Type"), new String(in, StandardCharsets.UTF_8)));
                int status = statusForCall.applyAsInt(calls.incrementAndGet());
                byte[] out = responseBody.getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().add("Content-Type", "application/json");
                ex.sendResponseHeaders(status, out.length);
                ex.getResponseBody().write(out);
                ex.close();
            });
            server.start();
        }

        String url() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    static void run() throws Exception {
        eventBus();
        ledgerStreaming();
        lakeClient();
        applicationRules();
        httpLayer();
    }

    private static long count(Map<String, Object> status, String key) {
        return ((Number) status.get(key)).longValue();
    }

    // ------------------------------------------------------------------ EventBusPublisher
    private static void eventBus() throws Exception {
        suite("EventBusPublisher (hot path)");
        test("disabled publisher is an explicit no-op", () -> {
            EventBusPublisher p = EventBusPublisher.disabled();
            isFalse(p.isEnabled(), "disabled");
            p.publish(EventBusPublisher.TOPIC_AUDIT, "k", Map.of("a", 1));
            Map<String, Object> st = p.status();
            equal("DISABLED", st.get("mode"), "mode");
            equal(0L, count(st, "published"), "nothing published");
            equal(0L, count(st, "queued"), "nothing queued");
        });
        test("delivers a record in Kafka REST v2 format to /topics/<topic>", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                EventBusPublisher p = EventBusPublisher.forUrl(ep.url() + "/", 3, 10);
                p.publish(EventBusPublisher.TOPIC_AUDIT, "HTX_CANTHO_01", Map.of("action", "CREATE", "n", 7));
                eventually(5000, () -> count(p.status(), "published") == 1, "published counter");
                FakeEndpoint.Seen s = ep.seen.get(0);
                equal("POST", s.method(), "method");
                equal("/topics/openagrios.audit.v1", s.path(), "topic path (trailing slash on base URL tolerated)");
                equal("application/vnd.kafka.json.v2+json", s.contentType(), "embedded JSON content type");
                Map<String, Object> body = JsonCodec.parseObject(s.body());
                Map<?, ?> rec = (Map<?, ?>) ((List<?>) body.get("records")).get(0);
                equal("HTX_CANTHO_01", rec.get("key"), "partition key = tenant");
                equal("CREATE", ((Map<?, ?>) rec.get("value")).get("action"), "payload");
                notNull(p.status().get("last_success_at"), "success timestamp");
                equal("KAFKA_REST_PROXY", p.status().get("mode"), "mode");
            }
        });
        test("events for different topics are never mixed in one request", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                EventBusPublisher p = EventBusPublisher.forUrl(ep.url(), 3, 10);
                for (int i = 0; i < 3; i++) p.publish(EventBusPublisher.TOPIC_AUDIT, "o", Map.of("i", i));
                for (int i = 0; i < 2; i++) p.publish(EventBusPublisher.TOPIC_TELEMETRY, "o", Map.of("i", i));
                eventually(5000, () -> count(p.status(), "published") == 5, "all five delivered");
                int audit = 0, telemetry = 0;
                for (FakeEndpoint.Seen s : ep.seen) {
                    int n = ((List<?>) JsonCodec.parseObject(s.body()).get("records")).size();
                    if (s.path().endsWith(EventBusPublisher.TOPIC_AUDIT)) audit += n;
                    else if (s.path().endsWith(EventBusPublisher.TOPIC_TELEMETRY)) telemetry += n;
                    else throw new AssertionError("unexpected path " + s.path());
                }
                equal(3, audit, "audit records");
                equal(2, telemetry, "telemetry records");
            }
        });
        test("transient broker errors are retried and the event is still delivered", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                ep.statusForCall = n -> n <= 2 ? 503 : 200;
                EventBusPublisher p = EventBusPublisher.forUrl(ep.url(), 5, 5);
                p.publish(EventBusPublisher.TOPIC_AUDIT, "o", Map.of("x", 1));
                eventually(5000, () -> count(p.status(), "published") == 1, "eventually delivered");
                equal(3, ep.calls.get(), "two failures + one success");
                equal(0L, count(p.status(), "failed"), "nothing lost");
            }
        });
        test("permanent failure is counted and surfaced, never silent", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                ep.statusForCall = n -> 500;
                ep.responseBody = "{\"error\":\"boom\"}";
                EventBusPublisher p = EventBusPublisher.forUrl(ep.url(), 3, 5);
                p.publish(EventBusPublisher.TOPIC_AUDIT, "o", Map.of("x", 1));
                eventually(5000, () -> count(p.status(), "failed") == 1, "failure counter");
                equal(0L, count(p.status(), "published"), "not published");
                equal(3, ep.calls.get(), "exactly maxAttempts tries");
                contains(String.valueOf(p.status().get("last_error")), "500", "last_error names the HTTP status");
            }
        });
        test("an unreachable bus does not block or crash the caller", () -> {
            EventBusPublisher p = EventBusPublisher.forUrl("http://127.0.0.1:1", 2, 5);
            long t0 = System.nanoTime();
            p.publish(EventBusPublisher.TOPIC_AUDIT, "o", Map.of("x", 1));
            isTrue((System.nanoTime() - t0) / 1_000_000 < 200, "publish() returns immediately (asynchronous)");
            eventually(8000, () -> count(p.status(), "failed") == 1, "failure recorded");
            isTrue(!String.valueOf(p.status().get("last_error")).isEmpty(), "error is reported");
        });
        test("keys and values with quotes / unicode still produce valid JSON", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                EventBusPublisher p = EventBusPublisher.forUrl(ep.url(), 3, 5);
                p.publish(EventBusPublisher.TOPIC_AUDIT, "org\"with\\quote", Map.of("note", "Cần Thơ \"1\"\n"));
                eventually(5000, () -> count(p.status(), "published") == 1, "delivered");
                Map<?, ?> rec = (Map<?, ?>) ((List<?>) JsonCodec.parseObject(ep.seen.get(0).body()).get("records")).get(0);
                equal("org\"with\\quote", rec.get("key"), "key survives escaping");
                equal("Cần Thơ \"1\"\n", ((Map<?, ?>) rec.get("value")).get("note"), "value survives escaping");
            }
        });
    }

    // ------------------------------------------------------------------ ledger -> bus
    private static void ledgerStreaming() throws Exception {
        suite("Audit ledger -> event bus");
        test("every audit record is streamed with tenant key, event type and a ledger epoch", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                ImmutableAuditLedger l = new ImmutableAuditLedger();
                EventBusPublisher bus = EventBusPublisher.forUrl(ep.url(), 3, 5);
                l.setEventBus(bus);
                var rec = l.appendRecord("HTX_CANTHO_01", "CORR-9", "ServiceRequest", "REQ-9", "CREATE", "alice", "COORDINATOR",
                        Map.of(), Map.of("s", "NEW"), 200);
                eventually(5000, () -> count(bus.status(), "published") == 1, "streamed");
                Map<?, ?> r = (Map<?, ?>) ((List<?>) JsonCodec.parseObject(ep.seen.get(0).body()).get("records")).get(0);
                equal("HTX_CANTHO_01", r.get("key"), "tenant key");
                Map<?, ?> v = (Map<?, ?>) r.get("value");
                equal("audit.v1", v.get("event_type"), "event type");
                equal(rec.recordHash(), v.get("record_hash"), "hash identical to the ledger");
                equal(rec.eventId(), v.get("event_id"), "event id");
                notNull(v.get("ledger_epoch"), "epoch present");
            }
        });
        test("clear() starts a new epoch so restarted event-id sequences cannot collide in the lake", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                ImmutableAuditLedger l = new ImmutableAuditLedger();
                EventBusPublisher bus = EventBusPublisher.forUrl(ep.url(), 3, 5);
                l.setEventBus(bus);
                l.appendRecord("O", "C", "E", "1", "A", "u", "r", Map.of(), Map.of(), 200);
                l.clear();
                l.appendRecord("O", "C", "E", "1", "A", "u", "r", Map.of(), Map.of(), 200);
                eventually(5000, () -> count(bus.status(), "published") == 2, "both streamed");
                List<String> epochs = new ArrayList<>();
                List<String> ids = new ArrayList<>();
                for (FakeEndpoint.Seen s : ep.seen) {
                    for (Object o : (List<?>) JsonCodec.parseObject(s.body()).get("records")) {
                        Map<?, ?> v = (Map<?, ?>) ((Map<?, ?>) o).get("value");
                        epochs.add(String.valueOf(v.get("ledger_epoch")));
                        ids.add(String.valueOf(v.get("event_id")));
                    }
                }
                equal(ids.get(0), ids.get(1), "same event id after reset (the collision this guards against)");
                isFalse(epochs.get(0).equals(epochs.get(1)), "but different epochs");
            }
        });
        test("a ledger without a bus behaves exactly as before", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            l.setEventBus(null);
            l.appendRecord("O", "C", "E", "1", "A", "u", "r", Map.of(), Map.of(), 200);
            equal(Boolean.TRUE, l.verifyChainIntegrity().get("chain_valid"), "chain valid");
        });
    }

    // ------------------------------------------------------------------ AnalyticsLakeClient
    private static void lakeClient() throws Exception {
        suite("AnalyticsLakeClient (cold path)");
        test("unconfigured client reports 503 for known queries and DISABLED on probe", () -> {
            AnalyticsLakeClient c = new AnalyticsLakeClient((String) null);
            isFalse(c.isConfigured(), "not configured");
            equal(503, c.query("summary", "O").status(), "known query");
            equal("analytics_disabled", c.query("summary", "O").body().get("error"), "error code");
            equal("DISABLED", c.probe(), "probe");
        });
        test("only whitelisted query names are accepted (no path traversal / injection)", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                AnalyticsLakeClient c = new AnalyticsLakeClient(ep.url());
                for (String bad : new String[]{"../health", "summary/../../x", "SUMMARY", "", "summary?org=other", "drop table"}) {
                    equal(404, c.query(bad, "O").status(), "name: '" + bad + "'");
                }
                equal(0, ep.calls.get(), "nothing reached the lake service");
            }
        });
        test("the tenant is always passed URL-encoded and responses are passed through", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                ep.responseBody = "{\"engine\":\"DuckDB\",\"rows\":[]}";
                AnalyticsLakeClient c = new AnalyticsLakeClient(ep.url());
                AnalyticsLakeClient.Result r = c.query("actions-by-day", "A&org=EVIL B");
                equal(200, r.status(), "status");
                equal("DuckDB", r.body().get("engine"), "body");
                equal("/analytics/actions-by-day", ep.seen.get(0).path(), "path");
                equal("org=A%26org%3DEVIL+B", ep.seen.get(0).query(), "a hostile org value cannot add or override query parameters");
            }
        });
        test("upstream error statuses are propagated, not masked", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                ep.statusForCall = n -> 500;
                ep.responseBody = "{\"error\":\"query_failed\"}";
                equal(500, new AnalyticsLakeClient(ep.url()).query("summary", "O").status(), "500 preserved");
            }
        });
        test("an unreachable lake yields 503 analytics_unreachable and probe DOWN", () -> {
            AnalyticsLakeClient c = new AnalyticsLakeClient("http://127.0.0.1:1");
            equal(503, c.query("summary", "O").status(), "status");
            equal("analytics_unreachable", c.query("summary", "O").body().get("error"), "code");
            equal("DOWN", c.probe(), "probe");
        });
        test("probe distinguishes UP from DEGRADED", () -> {
            try (FakeEndpoint ep = new FakeEndpoint()) {
                AnalyticsLakeClient c = new AnalyticsLakeClient(ep.url());
                equal("UP", c.probe(), "200 -> UP");
                ep.statusForCall = n -> 500;
                contains(c.probe(), "DEGRADED", "500 -> DEGRADED");
            }
        });
    }

    // ------------------------------------------------------------------ AgriOpsService
    private static AgriOpsService newService() {
        File bpmn = new File(OpenAgriOsServer.resolveProjectRoot(), "infra/bpmn");
        return new AgriOpsService(new AgriDataStore(new ImmutableAuditLedger(), new SeaweedS3StorageService(), new BpmnWorkflowEngine(bpmn)));
    }

    private static Map<String, Object> sample(String machine, String org, Object lat, Object lon, Object fuel, Object speed, Object ts) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("machine_id", machine);
        m.put("organization_id", org);
        m.put("lat", lat);
        m.put("lon", lon);
        m.put("fuel_pct", fuel);
        if (speed != null) m.put("speed_kmh", speed);
        m.put("ts", ts);
        return m;
    }

    private static Map<String, Object> incidentBody(String machineId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("machine_id", machineId);
        b.put("severity", "CRITICAL");
        b.put("incident_type", "Động cơ quá nóng");
        b.put("description", "unit test");
        b.put("estimated_downtime_hours", 24);
        b.put("evidence_filename", "evidence.jpg");
        return b;
    }

    private static void applicationRules() {
        suite("AgriOpsService - telemetry ingestion");
        AgriOpsService svc = newService();
        final String TS = "2026-11-20T10:00:00Z";
        final String ORG = "HTX_CANTHO_01";

        test("unknown machine -> 404, foreign tenant -> 409 (machine existence is not leaked across tenants)", () -> {
            equal(404, svc.ingestTelemetry(sample("NOPE", ORG, 10.0, 105.0, 50, 0, TS)).status(), "unknown");
            equal(409, svc.ingestTelemetry(sample("M01", "HTX_SOCTRANG_02", 10.0, 105.0, 50, 0, TS)).status(), "tenant mismatch");
            equal(409, svc.ingestTelemetry(sample("M01", "", 10.0, 105.0, 50, 0, TS)).status(), "blank tenant");
        });
        test("accepted range boundaries", () -> {
            equal(200, svc.ingestTelemetry(sample("M03", ORG, 90.0, 180.0, 100, 80, TS)).status(), "upper bounds");
            equal(200, svc.ingestTelemetry(sample("M03", ORG, -90.0, -180.0, 0, 0, TS)).status(), "lower bounds");
        });
        test("values just outside each range are rejected with 400", () -> {
            Object[][] bad = {
                    {90.0001, 105.0, 50, 0}, {-90.0001, 105.0, 50, 0},
                    {10.0, 180.0001, 50, 0}, {10.0, -180.0001, 50, 0},
                    {10.0, 105.0, -0.1, 0}, {10.0, 105.0, 100.1, 0},
                    {10.0, 105.0, 50, -1}, {10.0, 105.0, 50, 80.5},
                    {Double.NaN, 105.0, 50, 0}, {Double.POSITIVE_INFINITY, 105.0, 50, 0},
                    {10.0, 105.0, Double.NaN, 0}, {10.0, 105.0, 50, Double.NaN},
            };
            for (Object[] b : bad) {
                equal(400, svc.ingestTelemetry(sample("M03", ORG, b[0], b[1], b[2], b[3], TS)).status(),
                        "lat=" + b[0] + " lon=" + b[1] + " fuel=" + b[2] + " speed=" + b[3]);
            }
        });
        test("wrong types and missing fields are rejected with 400", () -> {
            equal(400, svc.ingestTelemetry(sample("M03", ORG, "10.0", 105.0, 50, 0, TS)).status(), "string lat");
            equal(400, svc.ingestTelemetry(sample("M03", ORG, 10.0, 105.0, true, 0, TS)).status(), "boolean fuel");
            equal(400, svc.ingestTelemetry(sample("M03", ORG, 10.0, 105.0, 50, "fast", TS)).status(), "string speed");
            equal(400, svc.ingestTelemetry(sample("M03", ORG, 10.0, 105.0, 50, 0, "yesterday")).status(), "bad timestamp");
            equal(400, svc.ingestTelemetry(sample("M03", ORG, 10.0, 105.0, 50, 0, null)).status(), "missing timestamp");
            Map<String, Object> noLat = sample("M03", ORG, 10.0, 105.0, 50, 0, TS);
            noLat.remove("lat");
            equal(400, svc.ingestTelemetry(noLat).status(), "missing lat");
        });
        test("speed is optional and defaults to 0", () ->
                equal(200, svc.ingestTelemetry(sample("M03", ORG, 10.0, 105.0, 50, null, TS)).status(), "no speed"));
        test("a rejected sample changes nothing; an accepted one updates position, fuel and timestamp only", () -> {
            HarvesterMachine m = svc.getStore().machines.get("M02");
            double lat0 = m.currentLat, lng0 = m.currentLng, fuel0 = m.fuelPct;
            String status0 = m.status;
            svc.ingestTelemetry(sample("M02", ORG, 999.0, 105.0, 50, 0, TS));
            equal(lat0, m.currentLat, "rejected: lat unchanged");
            equal(fuel0, m.fuelPct, "rejected: fuel unchanged");
            svc.ingestTelemetry(sample("M02", ORG, 10.5, 105.9, 33.3, 4, TS));
            equal(10.5, m.currentLat, "lat");
            equal(105.9, m.currentLng, "lng");
            equal(33.3, m.fuelPct, "fuel");
            equal(TS, m.telemetryUpdatedAt, "timestamp");
            equal(status0, m.status, "workflow-owned status is never changed by telemetry");
            isFalse(lng0 == m.currentLng, "position really moved");
        });
        test("telemetry is not written to the audit ledger (audit = business transitions only)", () -> {
            int before = (int) svc.getStore().auditLedger.verifyChainIntegrity().get("total_blocks");
            svc.ingestTelemetry(sample("M01", ORG, 10.0645, 105.5586, 70, 5, TS));
            equal(before, (int) svc.getStore().auditLedger.verifyChainIntegrity().get("total_blocks"), "ledger unchanged");
        });
        test("fleet roster lists every machine with the fields the simulator needs", () -> {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> fleet = (List<Map<String, Object>>) svc.listFleetForIngest().get("machines");
            equal(svc.getStore().machines.size(), fleet.size(), "all machines");
            for (String k : new String[]{"machine_id", "organization_id", "status", "lat", "lon", "fuel_pct"}) {
                isTrue(fleet.get(0).containsKey(k), "field " + k);
            }
        });

        suite("AgriOpsService - RBAC, tenancy and scheduling rules");
        AgriOpsService s = newService();
        AuthContext coord = new AuthContext("usr_coord_01", "coord_htx01", ORG, "COORDINATOR");
        AuthContext coord2 = new AuthContext("usr_coord_02", "coord_htx02", "HTX_SOCTRANG_02", "COORDINATOR");
        AuthContext farmerBa = new AuthContext("usr_farmer_ba", "farmer_ba", ORG, "FARMER");
        AuthContext owner = new AuthContext("usr_owner_tu", "owner_tu", ORG, "MACHINE_OWNER");
        AuthContext operator = new AuthContext("usr_op_minh", "op_minh", ORG, "OPERATOR");
        AuthContext repair = new AuthContext("usr_repair_01", "repair_01", ORG, "REPAIR_TEAM");

        test("a farmer can request service on their own field, and only there", () -> {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("field_id", "F01");
            body.put("requested_start", "2026-12-01T08:00:00Z");
            body.put("requested_end", "2026-12-01T12:00:00Z");
            HttpResult ok = s.createServiceRequest(farmerBa, body);
            equal(201, ok.status(), "own field (201 Created)");
            body.put("field_id", "F02");
            equal(403, s.createServiceRequest(farmerBa, body).status(), "neighbour's field (RLS owner check)");
        });
        test("roles outside FARMER/COORDINATOR cannot create requests", () -> {
            Map<String, Object> body = Map.of("field_id", "F01");
            equal(403, s.createServiceRequest(operator, body).status(), "operator");
            equal(403, s.createServiceRequest(repair, body).status(), "repair team");
            equal(403, s.createServiceRequest(owner, body).status(), "machine owner");
        });
        test("unknown fields and other tenants' fields are indistinguishable (404)", () -> {
            equal(404, s.createServiceRequest(coord, Map.of("field_id", "F-NOPE")).status(), "unknown");
            equal(404, s.createServiceRequest(coord, Map.of("field_id", "F_ST01")).status(), "other tenant's field");
        });
        test("dispatch is coordinator-only", () -> {
            for (AuthContext a : List.of(farmerBa, owner, operator, repair)) {
                equal(403, s.dispatchAssignment(a, Map.of("machine_id", "M01")).status(), a.role());
            }
        });
        String reqId = s.getStore().serviceRequests.values().stream()
                .filter(r -> ORG.equals(r.organizationId)).findFirst().orElseThrow().requestId;
        test("dispatch rejects unknown requests (404) and hides other tenants' machines (409 MACHINE_NOT_FOUND)", () -> {
            equal(404, s.dispatchAssignment(coord, Map.of("request_id", "REQ-NOPE", "machine_id", "M01")).status(), "unknown request");
            HttpResult r = s.dispatchAssignment(coord, Map.of("request_id", reqId, "machine_id", "M_ST01", "operator_id", "OP-01"));
            equal(409, r.status(), "status");
            equal("MACHINE_NOT_FOUND", r.body().get("error"), "tenant-hidden machine");
        });
        test("dispatch refuses a machine under maintenance", () -> {
            HttpResult r = s.dispatchAssignment(coord, Map.of("request_id", reqId, "machine_id", "M04", "operator_id", "OP-04"));
            equal(409, r.status(), "status");
            equal("MACHINE_UNAVAILABLE", r.body().get("error"), "code");
        });
        test("every blocked action leaves an audit trail", () -> {
            int before = (int) s.getStore().auditLedger.verifyChainIntegrity().get("total_blocks");
            s.dispatchAssignment(farmerBa, Map.of("machine_id", "M01"));
            isTrue((int) s.getStore().auditLedger.verifyChainIntegrity().get("total_blocks") > before, "RBAC denial audited");
            equal(Boolean.TRUE, s.getStore().auditLedger.verifyChainIntegrity().get("chain_valid"), "chain still valid");
        });

        test("rescue candidates use each machine's own registered operator, never the broken machine's driver", () -> {
            AgriOpsService fresh = newService();
            HttpResult r = fresh.reportMachineIncident(coord, incidentBody("M01"));
            equal(201, r.status(), "incident accepted");
            List<?> options = (List<?>) r.body().get("candidate_options");
            isTrue(!options.isEmpty(), "there are rescue options");
            Map<?, ?> top = (Map<?, ?>) options.get(0);
            equal("M02", top.get("machine_id"), "best rescuer");
            equal("OP-02", top.get("operator_id"), "M02 is driven by its own operator OP-02, not by M01's driver OP-01");
            for (Object o : options) {
                isFalse("OP-01".equals(((Map<?, ?>) o).get("operator_id")), "OP-01 (driver of the broken M01) is never proposed");
            }
        });
        test("a machine with no registered operator is skipped instead of being given a guessed driver", () -> {
            AgriOpsService fresh = newService();
            HarvesterMachine m02 = fresh.getStore().machines.get("M02");
            // simulates a machine reloaded from a database that lost its operator link (the original defect)
            fresh.getStore().machines.put("M02", new HarvesterMachine(m02.machineId, m02.organizationId, m02.ownerUserId, m02.name,
                    m02.machineType, m02.model, m02.capacityHaPerHr, m02.status, m02.fuelPct, m02.healthPct,
                    m02.currentLat, m02.currentLng, null, m02.telemetryUpdatedAt));
            HttpResult r = fresh.reportMachineIncident(coord, incidentBody("M01"));
            for (Object o : (List<?>) r.body().get("candidate_options")) {
                isFalse("M02".equals(((Map<?, ?>) o).get("machine_id")), "operator-less M02 must not be proposed");
            }
        });
        test("approving a rescue replan swaps the shift and keeps the rescuer's own operator", () -> {
            AgriOpsService fresh = newService();
            HttpResult inc = fresh.reportMachineIncident(coord, incidentBody("M01"));
            String incId = String.valueOf(inc.body().get("incident_id"));
            Map<?, ?> top = (Map<?, ?>) ((List<?>) inc.body().get("candidate_options")).get(0);
            HttpResult ok = fresh.approveRescueReplan(coord, incId, Map.of("option_id", top.get("option_id")));
            equal(200, ok.status(), "approved");
            String newId = String.valueOf(ok.body().get("new_assignment_id"));
            equal("OP-02", fresh.getStore().assignments.get(newId).operatorId, "new shift uses M02's operator");
            equal("SUPERSEDED", fresh.getStore().assignments.get(String.valueOf(ok.body().get("superseded_assignment_id"))).status, "old shift superseded");
        });

        suite("Seed data consistency (true-scale 3D twin relies on it)");
        test("every seeded field polygon has the area the field declares (within 2%)", () -> {
            for (var f : newService().getStore().fields.values()) {
                double got = org.openagrios.core.dataservices.SpatialMatchingEngine.ringAreaHa(f.polygon.get(0));
                near(f.areaHa, got, f.areaHa * 0.02, "field " + f.fieldId + " declares " + f.areaHa + " ha but its polygon is " + got + " ha");
            }
        });
        test("seeded field polygons do not overlap each other", () -> {
            var fields = new java.util.ArrayList<>(newService().getStore().fields.values());
            for (int i = 0; i < fields.size(); i++) {
                for (int j = i + 1; j < fields.size(); j++) {
                    var a = fields.get(i).polygon.get(0); var b = fields.get(j).polygon.get(0);
                    boolean separated = a.get(2).get(0) < b.get(0).get(0) || b.get(2).get(0) < a.get(0).get(0)
                            || a.get(2).get(1) < b.get(0).get(1) || b.get(2).get(1) < a.get(0).get(1);
                    isTrue(separated, fields.get(i).fieldId + " overlaps " + fields.get(j).fieldId);
                }
            }
        });

        suite("AgriOpsService - digital twin visibility");
        test("coordinators see only their own cooperative's machines", () -> {
            List<String> ids = twinIds(s, coord);
            isTrue(ids.contains("M01") && ids.contains("M04"), "own fleet");
            isFalse(ids.contains("M_ST01"), "no cross-tenant machine");
            equal(List.of("M_ST01"), twinIds(s, coord2), "the other cooperative sees only its own");
        });
        test("farmers and repair crews get no machine entities; owners only their own; operators only theirs", () -> {
            equal(List.of(), twinIds(s, farmerBa), "farmer");
            equal(List.of(), twinIds(s, repair), "repair team");
            List<String> mine = twinIds(s, owner);
            isTrue(mine.contains("M01") && mine.contains("M02"), "owned machines");
            isFalse(mine.contains("M03") || mine.contains("M04"), "machines owned by the cooperative");
        });
        test("NGSI-LD entities expose location as [lng, lat]", () -> {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> ents = (List<Map<String, Object>>) s.getDigitalTwinEntities(coord).get("entities");
            Map<String, Object> m01 = ents.stream().filter(e -> "urn:ngsi-ld:HarvesterMachine:M01".equals(e.get("id"))).findFirst().orElseThrow();
            List<?> coords = (List<?>) ((Map<?, ?>) ((Map<?, ?>) m01.get("location")).get("value")).get("coordinates");
            HarvesterMachine m = s.getStore().machines.get("M01");
            equal(m.currentLng, coords.get(0), "longitude first");
            equal(m.currentLat, coords.get(1), "latitude second");
        });
        test("simulation ticks never move another tenant's machines", () -> {
            HarvesterMachine m01 = s.getStore().machines.get("M01");
            double lat = m01.currentLat, lng = m01.currentLng, fuel = m01.fuelPct;
            int ticks = s.getStore().tickCount;
            s.tickSimulation(coord2);
            equal(ticks + 1, s.getStore().tickCount, "clock advanced");
            equal(lat, m01.currentLat, "lat");
            equal(lng, m01.currentLng, "lng");
            equal(fuel, m01.fuelPct, "fuel");
        });
    }

    @SuppressWarnings("unchecked")
    private static List<String> twinIds(AgriOpsService s, AuthContext a) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> e : (List<Map<String, Object>>) s.getDigitalTwinEntities(a).get("entities")) {
            String id = String.valueOf(e.get("id"));
            out.add(id.substring(id.lastIndexOf(':') + 1));
        }
        return out;
    }

    // ------------------------------------------------------------------ HTTP layer
    private static HttpResponse<String> http(String base, String method, String path, String body, String... headers) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path)).header("Content-Type", "application/json");
        for (int i = 0; i < headers.length; i += 2) b.header(headers[i], headers[i + 1]);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return HttpClient.newHttpClient().send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void httpLayer() throws Exception {
        suite("HTTP layer (real server on an ephemeral port)");
        KeycloakOidcEngine.setAuthModeForTesting(AuthMode.DEV_MOCK_STANDALONE);
        OpenAgriOsServer server = new OpenAgriOsServer(OpenAgriOsServer.resolveProjectRoot());
        int port;
        try (java.net.ServerSocket ss = new java.net.ServerSocket(0)) {
            port = ss.getLocalPort();
        }
        server.start(port);
        String base = "http://127.0.0.1:" + port;
        try {
            test("malformed JSON is a client error (400), not a server error (500)", () -> {
                HttpResponse<String> r = http(base, "POST", "/api/v1/auth/login", "{not json at all");
                equal(400, r.statusCode(), "status");
                equal("INVALID_JSON", JsonCodec.parseObject(r.body()).get("error"), "error code");
                isFalse(r.body().contains("NumberFormatException"), "no internal exception text leaks to the client");
            });
            test("unsupported methods return 405", () ->
                    equal(405, http(base, "DELETE", "/api/v1/health", null).statusCode(), "DELETE"));
            test("protected endpoints require a valid token", () -> {
                equal(401, http(base, "GET", "/api/v1/state", null).statusCode(), "no token");
                equal(401, http(base, "GET", "/api/v1/state", null, "Authorization", "Bearer garbage").statusCode(), "garbage token");
                equal(401, http(base, "GET", "/api/v1/analytics/summary", null).statusCode(), "analytics without token");
            });
            test("analytics is forbidden to non-coordinators even with a valid token", () -> {
                var farmer = new KeycloakOidcEngine.UserAccount("usr_farmer_ba", "farmer_ba", "pw", "Ba", "b@x", "HTX_CANTHO_01", "FARMER");
                String tok = KeycloakOidcEngine.issueJwt(farmer);
                equal(403, http(base, "GET", "/api/v1/analytics/summary", null, "Authorization", "Bearer " + tok).statusCode(), "farmer");
            });
            test("analytics reports 503 (not a crash) when the cold tier is not configured", () -> {
                var coord = new KeycloakOidcEngine.UserAccount("usr_coord_01", "coord_htx01", "pw", "Lan", "l@x", "HTX_CANTHO_01", "COORDINATOR");
                String tok = KeycloakOidcEngine.issueJwt(coord);
                HttpResponse<String> r = http(base, "GET", "/api/v1/analytics/summary", null, "Authorization", "Bearer " + tok);
                equal(503, r.statusCode(), "status");
                equal(404, http(base, "GET", "/api/v1/analytics/not-a-query", null, "Authorization", "Bearer " + tok).statusCode(), "unknown query name");
            });
            test("internal ingest endpoints fail closed when no ingest token is configured", () -> {
                if (System.getenv("OPENAGRIOS_INGEST_TOKEN") != null && !System.getenv("OPENAGRIOS_INGEST_TOKEN").isBlank()) {
                    return; // environment deliberately provides a token; the guard is covered by the e2e suite
                }
                equal(503, http(base, "POST", "/api/v1/internal/telemetry", "{}").statusCode(), "telemetry");
                equal(503, http(base, "GET", "/api/v1/internal/fleet", null, "X-Ingest-Token", "anything").statusCode(), "fleet");
            });
            test("health exposes event-bus and cold-tier status", () -> {
                HttpResponse<String> r = http(base, "GET", "/api/v1/health", null);
                equal(200, r.statusCode(), "status");
                Map<?, ?> core = (Map<?, ?>) JsonCodec.parseObject(r.body()).get("core_services");
                Map<?, ?> bus = (Map<?, ?>) core.get("event_bus");
                notNull(bus.get("mode"), "event bus mode");
                notNull(core.get("cold_analytics_lake"), "cold tier status");
            });
        } finally {
            server.stop();
            KeycloakOidcEngine.resetAuthModeForTesting();
        }
    }
}
