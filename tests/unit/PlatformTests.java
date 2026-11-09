// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.tests.unit;

import static org.floodos.tests.unit.TestKit.*;

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
import org.floodos.apps.floodos.DeploymentProfile;
import org.floodos.apps.floodos.FloodDataStore;
import org.floodos.apps.floodos.FloodModels.DispatchOrder;
import org.floodos.apps.floodos.FloodModels.FloodReport;
import org.floodos.apps.floodos.FloodModels.FloodZone;
import org.floodos.apps.floodos.FloodModels.GaugeStation;
import org.floodos.apps.floodos.FloodModels.RescueVehicle;
import org.floodos.apps.floodos.FloodOSServer;
import org.floodos.apps.floodos.FloodOSService;
import org.floodos.apps.floodos.FloodOSService.HttpResult;
import org.floodos.apps.floodos.FloodRepository;
import org.floodos.apps.floodos.FloodRoles;
import org.floodos.core.dataservices.AnalyticsLakeClient;
import org.floodos.core.dataservices.EventBusPublisher;
import org.floodos.core.dataservices.ImmutableAuditLedger;
import org.floodos.core.dataservices.JsonCodec;
import org.floodos.core.dataservices.SeaweedS3StorageService;
import org.floodos.core.identity.KeycloakOidcEngine;
import org.floodos.core.identity.KeycloakOidcEngine.AuthContext;
import org.floodos.core.identity.KeycloakOidcEngine.AuthMode;
import org.floodos.core.workflow.BpmnWorkflowEngine;

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
                p.publish(EventBusPublisher.TOPIC_AUDIT, "BCH_PCTT_HN_01", Map.of("action", "CREATE", "n", 7));
                eventually(5000, () -> count(p.status(), "published") == 1, "published counter");
                FakeEndpoint.Seen s = ep.seen.get(0);
                equal("POST", s.method(), "method");
                equal("/topics/floodos.audit.v1", s.path(), "topic path (trailing slash on base URL tolerated)");
                equal("application/vnd.kafka.json.v2+json", s.contentType(), "embedded JSON content type");
                Map<String, Object> body = JsonCodec.parseObject(s.body());
                Map<?, ?> rec = (Map<?, ?>) ((List<?>) body.get("records")).get(0);
                equal("BCH_PCTT_HN_01", rec.get("key"), "partition key = tenant");
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
                p.publish(EventBusPublisher.TOPIC_AUDIT, "org\"with\\quote", Map.of("note", "Hà Nội \"1\"\n"));
                eventually(5000, () -> count(p.status(), "published") == 1, "delivered");
                Map<?, ?> rec = (Map<?, ?>) ((List<?>) JsonCodec.parseObject(ep.seen.get(0).body()).get("records")).get(0);
                equal("org\"with\\quote", rec.get("key"), "key survives escaping");
                equal("Hà Nội \"1\"\n", ((Map<?, ?>) rec.get("value")).get("note"), "value survives escaping");
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
                var rec = l.appendRecord("BCH_PCTT_HN_01", "CORR-9", "FloodReport", "FR-0009", "CREATE", "alice", "DISPATCHER",
                        Map.of(), Map.of("s", "NEW"), 200);
                eventually(5000, () -> count(bus.status(), "published") == 1, "streamed");
                Map<?, ?> r = (Map<?, ?>) ((List<?>) JsonCodec.parseObject(ep.seen.get(0).body()).get("records")).get(0);
                equal("BCH_PCTT_HN_01", r.get("key"), "tenant key");
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

    // ------------------------------------------------------------------ FloodOS application rules
    private static final String ORG1 = "ORG_HN_PILOT_01";
    private static final String ORG2 = "ORG_HN_PILOT_02";

    private static FloodOSService newService() {
        File bpmn = new File(FloodOSServer.resolveProjectRoot(), "infra/bpmn");
        return new FloodOSService(new FloodDataStore(new ImmutableAuditLedger(), new SeaweedS3StorageService(), new BpmnWorkflowEngine(bpmn)));
    }

    private static AuthContext ctx(String username, String org, String role) {
        return new AuthContext("usr_" + username, username, org, role);
    }

    private static final AuthContext LAN = ctx("reporter_lan", ORG1, "REPORTER");
    private static final AuthContext HUNG = ctx("reporter_hung", ORG1, "REPORTER");
    private static final AuthContext HOA = ctx("dispatcher_hoa", ORG1, "DISPATCHER");
    private static final AuthContext BINH = ctx("team_binh", ORG1, "FIELD_TEAM");
    private static final AuthContext CUONG = ctx("team_cuong", ORG1, "FIELD_TEAM");
    private static final AuthContext DUNG = ctx("team_dung", ORG1, "FIELD_TEAM");
    private static final AuthContext GIANG = ctx("resource_giang", ORG1, "RESOURCE_MANAGER");
    private static final AuthContext ADMIN = ctx("platform_admin", ORG1, "PLATFORM_ADMIN");
    private static final AuthContext MAI = ctx("reporter_mai", ORG2, "REPORTER");
    private static final AuthContext TUAN = ctx("dispatcher_tuan", ORG2, "DISPATCHER");

    private static Map<String, Object> body(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static final String W1S = "2030-01-01T08:00:00Z", W1E = "2030-01-01T10:00:00Z";

    private static Map<String, Object> reportBody(double lat, double lng, double depth, String need) {
        return body("lat", lat, "lng", lng, "depth_cm", depth, "need_type", need, "people_affected", 4, "description", "unit test");
    }

    /** Files a report as `who`, verifies it as the dispatcher and returns its id. */
    private static String verifiedReport(FloodOSService s, AuthContext who, String need) {
        HttpResult r = s.createFloodReport(who, reportBody(20.9665, 105.8712, 45, need));
        equal(201, r.status(), "report created: " + r.body());
        String id = String.valueOf(r.body().get("report_id"));
        equal(200, s.verifyFloodReport(HOA, id, body("decision", "VERIFIED", "priority", "HIGH")).status(), "verified");
        return id;
    }

    private static HttpResult dispatch(FloodOSService s, String reportId, String vehicle, String team, String start, String end) {
        return s.createDispatchOrder(HOA, body("report_id", reportId, "vehicle_id", vehicle, "team_id", team, "start_time", start, "end_time", end));
    }

    private static Map<String, Object> sample(String vehicle, String org, Object lat, Object lon, Object fuel, Object speed, Object ts, Object source) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("asset_kind", "vehicle");
        m.put("asset_id", vehicle);
        m.put("organization_id", org);
        m.put("lat", lat);
        m.put("lon", lon);
        m.put("fuel_pct", fuel);
        if (speed != null) m.put("speed_kmh", speed);
        m.put("ts", ts);
        m.put("source", source);
        return m;
    }

    private static Map<String, Object> gaugeSample(String station, String org, Object level, Object ts, Object source) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("asset_kind", "gauge");
        m.put("asset_id", station);
        m.put("organization_id", org);
        m.put("level_cm", level);
        m.put("ts", ts);
        m.put("source", source);
        return m;
    }

    @SuppressWarnings("unchecked")
    private static List<String> ids(Object listOfMaps, String key) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> m : (List<Map<String, Object>>) listOfMaps) out.add(String.valueOf(m.get(key)));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<String> stateIds(FloodOSService s, AuthContext a, String section, String key) {
        return ids(s.getState(a).get(section), key);
    }

    private static void applicationRules() {
        telemetryRules();
        reportAndDispatchRules();
        fieldAndConfirmationRules();
        incidentRules();
        visibilityRules();
        seedRules();
    }

    private static void telemetryRules() {
        suite("FloodOSService - telemetry ingestion (vehicles and gauges, source is mandatory)");
        FloodOSService svc = newService();
        final String TS = "2026-11-20T10:00:00Z";

        test("unknown vehicle -> 404, foreign tenant -> 409 (existence is not leaked across tenants)", () -> {
            equal(404, svc.ingestTelemetry(sample("NOPE", ORG1, 20.9, 105.8, 50, 0, TS, "SIMULATOR")).status(), "unknown");
            equal(409, svc.ingestTelemetry(sample("V01", ORG2, 20.9, 105.8, 50, 0, TS, "SIMULATOR")).status(), "tenant mismatch");
            equal(409, svc.ingestTelemetry(sample("V01", "", 20.9, 105.8, 50, 0, TS, "SIMULATOR")).status(), "blank tenant");
        });
        test("a sample must say where it comes from: only SIMULATOR or DEVICE are accepted", () -> {
            for (Object bad : new Object[]{null, "", "mqtt", "simulator", "OFFICIAL", 7}) {
                equal(400, svc.ingestTelemetry(sample("V03", ORG1, 20.9, 105.8, 50, 0, TS, bad)).status(), "source=" + bad);
            }
            equal(200, svc.ingestTelemetry(sample("V03", ORG1, 20.9, 105.8, 50, 0, TS, "SIMULATOR")).status(), "SIMULATOR");
            equal(200, svc.ingestTelemetry(sample("V03", ORG1, 20.9, 105.8, 50, 0, TS, "DEVICE")).status(), "DEVICE");
        });
        test("accepted range boundaries", () -> {
            equal(200, svc.ingestTelemetry(sample("V03", ORG1, 90.0, 180.0, 100, 80, TS, "SIMULATOR")).status(), "upper bounds");
            equal(200, svc.ingestTelemetry(sample("V03", ORG1, -90.0, -180.0, 0, 0, TS, "SIMULATOR")).status(), "lower bounds");
        });
        test("values just outside each range are rejected with 400", () -> {
            Object[][] bad = {
                    {90.0001, 105.0, 50, 0}, {-90.0001, 105.0, 50, 0}, {10.0, 180.0001, 50, 0}, {10.0, -180.0001, 50, 0},
                    {10.0, 105.0, -0.1, 0}, {10.0, 105.0, 100.1, 0}, {10.0, 105.0, 50, -1}, {10.0, 105.0, 50, 80.5},
                    {Double.NaN, 105.0, 50, 0}, {Double.POSITIVE_INFINITY, 105.0, 50, 0},
                    {10.0, 105.0, Double.NaN, 0}, {10.0, 105.0, 50, Double.NaN},
            };
            for (Object[] b : bad) {
                equal(400, svc.ingestTelemetry(sample("V03", ORG1, b[0], b[1], b[2], b[3], TS, "SIMULATOR")).status(),
                        "lat=" + b[0] + " lon=" + b[1] + " fuel=" + b[2] + " speed=" + b[3]);
            }
        });
        test("wrong types and missing fields are rejected with 400", () -> {
            equal(400, svc.ingestTelemetry(sample("V03", ORG1, "10.0", 105.0, 50, 0, TS, "SIMULATOR")).status(), "string lat");
            equal(400, svc.ingestTelemetry(sample("V03", ORG1, 10.0, 105.0, true, 0, TS, "SIMULATOR")).status(), "boolean fuel");
            equal(400, svc.ingestTelemetry(sample("V03", ORG1, 10.0, 105.0, 50, "fast", TS, "SIMULATOR")).status(), "string speed");
            equal(400, svc.ingestTelemetry(sample("V03", ORG1, 10.0, 105.0, 50, 0, "yesterday", "SIMULATOR")).status(), "bad timestamp");
            equal(400, svc.ingestTelemetry(sample("V03", ORG1, 10.0, 105.0, 50, 0, null, "SIMULATOR")).status(), "missing timestamp");
            Map<String, Object> noLat = sample("V03", ORG1, 10.0, 105.0, 50, 0, TS, "SIMULATOR");
            noLat.remove("lat");
            equal(400, svc.ingestTelemetry(noLat).status(), "missing lat");
            Map<String, Object> badKind = sample("V03", ORG1, 10.0, 105.0, 50, 0, TS, "SIMULATOR");
            badKind.put("asset_kind", "machine");
            equal(400, svc.ingestTelemetry(badKind).status(), "unknown asset kind");
        });
        test("a rejected sample changes nothing; an accepted one updates position, fuel, time and source only", () -> {
            RescueVehicle v = svc.getStore().vehicles.get("V02");
            double lat0 = v.currentLat, fuel0 = v.fuelPct;
            String status0 = v.status;
            svc.ingestTelemetry(sample("V02", ORG1, 999.0, 105.0, 50, 0, TS, "SIMULATOR"));
            equal(lat0, v.currentLat, "rejected: lat unchanged");
            equal(fuel0, v.fuelPct, "rejected: fuel unchanged");
            isTrue("SEED".equals(v.telemetrySource), "rejected: source unchanged");
            svc.ingestTelemetry(sample("V02", ORG1, 20.95, 105.9, 33.3, 4, TS, "SIMULATOR"));
            equal(20.95, v.currentLat, "lat");
            equal(105.9, v.currentLng, "lng");
            equal(33.3, v.fuelPct, "fuel");
            equal(TS, v.telemetryUpdatedAt, "timestamp");
            equal("SIMULATOR", v.telemetrySource, "the position is now labelled as simulated");
            equal(status0, v.status, "workflow-owned status is never changed by telemetry");
            equal(Boolean.TRUE, v.toMap().get("position_is_simulated"), "exposed as simulated");
        });
        test("a gauge reading updates the gauge and its zone, labelled with its source, and derives the risk level", () -> {
            equal(200, svc.ingestTelemetry(gaugeSample("G01", ORG1, 125.0, TS, "SIMULATOR")).status(), "critical level");
            GaugeStation g = svc.getStore().gauges.get("G01");
            FloodZone z = svc.getStore().zones.get("Z01");
            equal("CRITICAL", g.alertState(), "gauge alert");
            equal("CRITICAL", z.riskLevel, "zone risk follows the gauge");
            equal(125.0, z.waterLevelCm, "zone level");
            equal("SIMULATOR", z.waterLevelSource, "zone level source");
            equal(200, svc.ingestTelemetry(gaugeSample("G01", ORG1, 10.0, TS, "SIMULATOR")).status(), "low level");
            equal("NORMAL", g.alertState(), "back to normal");
            equal("NORMAL", z.riskLevel, "zone risk drops below the watch band");
        });
        test("gauge validation: range, tenant, unknown id, source", () -> {
            equal(400, svc.ingestTelemetry(gaugeSample("G01", ORG1, -1.0, TS, "SIMULATOR")).status(), "negative");
            equal(400, svc.ingestTelemetry(gaugeSample("G01", ORG1, 1000.1, TS, "SIMULATOR")).status(), "too high");
            equal(400, svc.ingestTelemetry(gaugeSample("G01", ORG1, "60", TS, "SIMULATOR")).status(), "string level");
            equal(409, svc.ingestTelemetry(gaugeSample("G01", ORG2, 60.0, TS, "SIMULATOR")).status(), "foreign tenant");
            equal(404, svc.ingestTelemetry(gaugeSample("G99", ORG1, 60.0, TS, "SIMULATOR")).status(), "unknown gauge");
            equal(400, svc.ingestTelemetry(gaugeSample("G01", ORG1, 60.0, TS, "official")).status(), "bad source");
        });
        test("telemetry is not written to the audit ledger (audit = business transitions only)", () -> {
            int before = (int) svc.getStore().auditLedger.verifyChainIntegrity().get("total_blocks");
            svc.ingestTelemetry(sample("V01", ORG1, 20.9668, 105.8718, 70, 5, TS, "SIMULATOR"));
            svc.ingestTelemetry(gaugeSample("G02", ORG1, 100.0, TS, "SIMULATOR"));
            equal(before, (int) svc.getStore().auditLedger.verifyChainIntegrity().get("total_blocks"), "ledger unchanged");
        });
        test("asset roster lists vehicles and gauges with what the simulator needs; targets are straight-line zone centres", () -> {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> assets = (List<Map<String, Object>>) svc.listAssetsForIngest().get("assets");
            equal(svc.getStore().vehicles.size() + svc.getStore().gauges.size(), assets.size(), "all assets");
            Map<String, Object> v01 = assets.stream().filter(a -> "V01".equals(a.get("asset_id"))).findFirst().orElseThrow();
            for (String k : new String[]{"asset_kind", "asset_id", "organization_id", "status", "lat", "lon", "fuel_pct", "target_lat", "target_lon"}) {
                isTrue(v01.containsKey(k), "vehicle field " + k);
            }
            equal(svc.getStore().zones.get("Z01").centerLat, v01.get("target_lat"), "V01 heads for the zone of its active order");
            Map<String, Object> g01 = assets.stream().filter(a -> "G01".equals(a.get("asset_id"))).findFirst().orElseThrow();
            for (String k : new String[]{"level_cm", "warn_level_cm", "critical_level_cm", "zone_id"}) isTrue(g01.containsKey(k), "gauge field " + k);
        });
    }

    private static void reportAndDispatchRules() {
        suite("FloodOSService - intake, verification and dispatch (RBAC, validation, conflicts)");
        FloodOSService s = newService();

        test("a reporter files a report: the server picks the nearest zone and starts the workflow", () -> {
            HttpResult r = s.createFloodReport(LAN, reportBody(20.9665, 105.8712, 45, "EVACUATION"));
            equal(201, r.status(), "created");
            equal("Z01", r.body().get("zone_id"), "nearest zone centre");
            equal("NEAREST_ZONE_CENTER_STRAIGHT_LINE", r.body().get("zone_match"), "how the zone was chosen");
            String id = String.valueOf(r.body().get("report_id"));
            FloodReport rep = s.getStore().reports.get(id);
            equal("RECEIVED", rep.status, "initial status");
            equal("usr_reporter_lan", rep.reporterUserId, "owner is the caller");
            isTrue(s.getStore().bpmnEngine.listByTenant(ORG1).stream()
                    .anyMatch(p -> id.equals(p.get("business_key")) && "taskDispatcherVerify".equals(p.get("current_step_id"))), "workflow waits for verification");
        });
        test("a reporter cannot name a zone: zone_id is ignored and the position decides", () -> {
            Map<String, Object> b = reportBody(20.9665, 105.8712, 45, "EVACUATION");
            b.put("zone_id", "Z02");
            equal("Z01", s.createFloodReport(LAN, b).body().get("zone_id"), "server-side matching");
        });
        test("a dispatcher may name the zone and the report is marked as taken by phone", () -> {
            Map<String, Object> b = reportBody(20.9665, 105.8712, 45, "EVACUATION");
            b.put("zone_id", "Z02");
            HttpResult r = s.createFloodReport(HOA, b);
            equal("Z02", r.body().get("zone_id"), "named zone");
            equal("PHONE", s.getStore().reports.get(String.valueOf(r.body().get("report_id"))).channel, "channel");
            b.put("zone_id", "Z91");
            equal(404, s.createFloodReport(HOA, b).status(), "another tenant's zone does not exist for this dispatcher");
        });
        test("invalid reports are refused with a specific 400 (no silent defaults)", () -> {
            equal(400, s.createFloodReport(LAN, reportBody(120, 105.8, 45, "EVACUATION")).status(), "latitude");
            equal(400, s.createFloodReport(LAN, reportBody(20.9, 105.8, -1, "EVACUATION")).status(), "negative depth");
            equal(400, s.createFloodReport(LAN, reportBody(20.9, 105.8, 5000, "EVACUATION")).status(), "absurd depth");
            equal(400, s.createFloodReport(LAN, reportBody(20.9, 105.8, 45, "SOMETHING")).status(), "need type");
            Map<String, Object> noDepth = reportBody(20.9, 105.8, 45, "EVACUATION");
            noDepth.remove("depth_cm");
            equal("INVALID_DEPTH", s.createFloodReport(LAN, noDepth).body().get("error"), "missing depth");
            Map<String, Object> people = reportBody(20.9, 105.8, 45, "EVACUATION");
            people.put("people_affected", 2.5);
            equal(400, s.createFloodReport(LAN, people).status(), "fractional people");
        });
        test("a position far from every monitored zone is refused, not assigned to a random zone", () -> {
            HttpResult r = s.createFloodReport(LAN, reportBody(21.2, 105.5, 45, "EVACUATION"));
            equal(422, r.status(), "outside");
            equal("OUTSIDE_MONITORED_AREA", r.body().get("error"), "code");
        });
        test("roles outside the allow-list cannot file reports (403) and the attempt is audited", () -> {
            int before = (int) s.getStore().auditLedger.verifyChainIntegrity().get("total_blocks");
            equal(403, s.createFloodReport(BINH, reportBody(20.9665, 105.8712, 45, "EVACUATION")).status(), "field team");
            equal(403, s.createFloodReport(GIANG, reportBody(20.9665, 105.8712, 45, "EVACUATION")).status(), "resource manager");
            equal(403, s.createFloodReport(ADMIN, reportBody(20.9665, 105.8712, 45, "EVACUATION")).status(), "platform admin has no business actions");
            equal(before + 3, (int) s.getStore().auditLedger.verifyChainIntegrity().get("total_blocks"), "three RBAC_BLOCKED records");
        });
        test("only a dispatcher verifies; tenant and state are enforced", () -> {
            String id = String.valueOf(s.createFloodReport(LAN, reportBody(20.9665, 105.8712, 45, "EVACUATION")).body().get("report_id"));
            equal(403, s.verifyFloodReport(LAN, id, body("decision", "VERIFIED", "priority", "HIGH")).status(), "reporter");
            equal(403, s.verifyFloodReport(BINH, id, body("decision", "VERIFIED", "priority", "HIGH")).status(), "field team");
            equal(404, s.verifyFloodReport(TUAN, id, body("decision", "VERIFIED", "priority", "HIGH")).status(), "other tenant's dispatcher");
            equal(400, s.verifyFloodReport(HOA, id, body("decision", "MAYBE")).status(), "decision");
            equal(400, s.verifyFloodReport(HOA, id, body("decision", "VERIFIED")).status(), "priority is required");
            equal(400, s.verifyFloodReport(HOA, id, body("decision", "VERIFIED", "priority", "ASAP")).status(), "priority value");
            equal(400, s.verifyFloodReport(HOA, id, body("decision", "REJECTED")).status(), "a rejection needs a reason");
            equal(200, s.verifyFloodReport(HOA, id, body("decision", "VERIFIED", "priority", "URGENT", "note", "gọi lại xác nhận")).status(), "verified");
            equal("URGENT", s.getStore().reports.get(id).priority, "priority stored");
            equal(409, s.verifyFloodReport(HOA, id, body("decision", "VERIFIED", "priority", "HIGH")).status(), "cannot verify twice");
        });
        test("a rejected report closes its workflow and cannot be dispatched", () -> {
            String id = String.valueOf(s.createFloodReport(LAN, reportBody(20.9665, 105.8712, 45, "EVACUATION")).body().get("report_id"));
            equal(200, s.verifyFloodReport(HOA, id, body("decision", "REJECTED", "note", "trùng tin báo khác")).status(), "rejected");
            equal("REJECTED", s.getStore().reports.get(id).status, "status");
            isTrue(s.getStore().bpmnEngine.listByTenant(ORG1).stream()
                    .anyMatch(p -> id.equals(p.get("business_key")) && "COMPLETED".equals(p.get("status"))), "workflow completed");
            equal(409, dispatch(s, id, "V02", "T02", W1S, W1E).status(), "dispatching a rejected report");
        });
        test("dispatch needs a verified report and a complete, ordered time window", () -> {
            String raw = String.valueOf(s.createFloodReport(LAN, reportBody(20.9665, 105.8712, 45, "EVACUATION")).body().get("report_id"));
            equal(409, dispatch(s, raw, "V02", "T02", W1S, W1E).status(), "unverified report");
            String id = verifiedReport(s, LAN, "EVACUATION");
            equal(400, s.createDispatchOrder(HOA, body("report_id", id, "vehicle_id", "V02")).status(), "missing fields");
            equal(400, dispatch(s, id, "V02", "T02", "soon", "later").status(), "bad times");
            equal(400, dispatch(s, id, "V02", "T02", W1E, W1S).status(), "end before start");
            equal(403, s.createDispatchOrder(LAN, body("report_id", id, "vehicle_id", "V02", "team_id", "T02", "start_time", W1S, "end_time", W1E)).status(), "reporter");
            equal(403, s.createDispatchOrder(GIANG, body("report_id", id, "vehicle_id", "V02", "team_id", "T02", "start_time", W1S, "end_time", W1E)).status(), "resource manager does not approve dispatches");
            equal(404, dispatch(s, "FR-NOPE", "V02", "T02", W1S, W1E).status(), "unknown report");
            equal(404, dispatch(s, id, "V02", "T99", W1S, W1E).status(), "unknown team");
        });
        test("double booking is blocked: same vehicle, same team, unavailable vehicle, unsuitable vehicle, foreign vehicle", () -> {
            String a = verifiedReport(s, LAN, "EVACUATION");
            String b = verifiedReport(s, HUNG, "EVACUATION");
            HttpResult ok = dispatch(s, a, "V02", "T02", W1S, W1E);
            equal(201, ok.status(), "first booking: " + ok.body());
            HttpResult vehicleBusy = dispatch(s, b, "V02", "T03", "2030-01-01T09:00:00Z", "2030-01-01T11:00:00Z");
            equal(409, vehicleBusy.status(), "same vehicle");
            equal("RESOURCE_TIME_OVERLAP", vehicleBusy.body().get("error"), "code");
            notNull(vehicleBusy.body().get("conflict_details"), "reports the blocking order");
            HttpResult teamBusy = dispatch(s, b, "V01", "T02", W1S, W1E);
            equal(409, teamBusy.status(), "same team");
            equal("HOLDER_TIME_OVERLAP", teamBusy.body().get("error"), "code");
            equal("RESOURCE_UNAVAILABLE", dispatch(s, b, "V05", "T03", W1S, W1E).body().get("error"), "vehicle in maintenance");
            equal(422, dispatch(s, b, "V04", "T03", W1S, W1E).status(), "a pump cannot evacuate");
            equal("RESOURCE_NOT_FOUND", dispatch(s, b, "V91", "T03", W1S, W1E).body().get("error"), "another tenant's vehicle");
            equal("DISPATCHED", s.getStore().reports.get(a).status, "first report dispatched");
            equal("VERIFIED", s.getStore().reports.get(b).status, "second report untouched by the failed attempts");
            back2back(s, b);
        });
        test("every refused dispatch is written to the audit trail with the conflict as evidence", () -> {
            boolean found = s.getStore().auditLedger.listRecentByTenant(ORG1, 200).stream()
                    .anyMatch(r -> String.valueOf(r.get("action")).startsWith("CONFLICT_BLOCKED_"));
            isTrue(found, "CONFLICT_BLOCKED_* record present");
        });
    }

    /** Back-to-back windows touching at an endpoint are allowed (half-open ranges, like the GiST constraint). */
    private static void back2back(FloodOSService s, String reportId) {
        HttpResult r = dispatch(s, reportId, "V02", "T02", W1E, "2030-01-01T12:00:00Z");
        equal(201, r.status(), "starts exactly when the previous order ends: " + r.body());
    }

    private static void fieldAndConfirmationRules() {
        suite("FloodOSService - field updates, completion and confirmation");
        FloodOSService s = newService();
        String id = verifiedReport(s, LAN, "EVACUATION");
        String orderId = String.valueOf(dispatch(s, id, "V02", "T02", W1S, W1E).body().get("order_id"));

        test("only the team that leads the order (or a dispatcher) updates it; others see 404 and an audit record", () -> {
            equal(403, s.updateOrderStatus(LAN, orderId, body("status", "IN_PROGRESS", "progress_pct", 10)).status(), "reporter");
            equal(403, s.updateOrderStatus(GIANG, orderId, body("status", "IN_PROGRESS", "progress_pct", 10)).status(), "resource manager");
            int before = (int) s.getStore().auditLedger.verifyChainIntegrity().get("total_blocks");
            equal(404, s.updateOrderStatus(DUNG, orderId, body("status", "IN_PROGRESS", "progress_pct", 10)).status(), "another team's order");
            equal(before + 1, (int) s.getStore().auditLedger.verifyChainIntegrity().get("total_blocks"), "RLS_BLOCKED record");
            equal(404, s.updateOrderStatus(CUONG, "ORD-NOPE", body("status", "IN_PROGRESS", "progress_pct", 10)).status(), "unknown order");
        });
        test("progress rules: valid transitions, non-decreasing progress, note required, completion needs 100% and an outcome", () -> {
            equal(400, s.updateOrderStatus(CUONG, orderId, body("status", "DONE", "progress_pct", 10)).status(), "status value");
            equal(400, s.updateOrderStatus(CUONG, orderId, body("status", "IN_PROGRESS")).status(), "progress is required");
            equal(409, s.updateOrderStatus(CUONG, orderId, body("status", "COMPLETED", "progress_pct", 100, "outcome", "RESOLVED")).status(), "cannot complete before starting");
            equal(200, s.updateOrderStatus(CUONG, orderId, body("status", "IN_PROGRESS", "progress_pct", 20)).status(), "start");
            equal("WORKING", s.getStore().vehicles.get("V02").status, "vehicle now working");
            equal("ON_MISSION", s.getStore().teams.get("T02").status(), "team on mission");
            equal("IN_PROGRESS", s.getStore().reports.get(id).status, "report in progress");
            equal(400, s.updateOrderStatus(CUONG, orderId, body("status", "IN_PROGRESS", "progress_pct", 40)).status(), "a field note is required for progress updates");
            equal(409, s.updateOrderStatus(CUONG, orderId, body("status", "IN_PROGRESS", "progress_pct", 10, "note", "x")).status(), "progress cannot decrease");
            equal(200, s.updateOrderStatus(CUONG, orderId, body("status", "IN_PROGRESS", "progress_pct", 60, "note", "đã đưa 3 người")).status(), "progress");
            equal(400, s.updateOrderStatus(CUONG, orderId, body("status", "COMPLETED", "progress_pct", 80, "outcome", "RESOLVED")).status(), "not at 100%");
            equal(400, s.updateOrderStatus(CUONG, orderId, body("status", "COMPLETED", "progress_pct", 100)).status(), "outcome required");
        });
        final String[] resolutionId = new String[1];
        test("completion frees the vehicle and team, opens a pending resolution and waits for the reporter", () -> {
            HttpResult r = s.updateOrderStatus(CUONG, orderId, body("status", "COMPLETED", "progress_pct", 100, "outcome", "RESOLVED", "final_depth_cm", 5));
            equal(200, r.status(), "completed: " + r.body());
            resolutionId[0] = String.valueOf(r.body().get("resolution_id"));
            equal("IDLE", s.getStore().vehicles.get("V02").status, "vehicle idle");
            equal("AVAILABLE", s.getStore().teams.get("T02").status(), "team available");
            equal("AWAITING_CONFIRMATION", s.getStore().reports.get(id).status, "report");
            equal("PENDING", s.getStore().resolutions.get(resolutionId[0]).confirmationStatus, "resolution");
            equal("COMPLETED", s.getStore().orders.get(orderId).status, "order");
        });
        test("only the reporter of THAT report (or a dispatcher) confirms; others cannot even tell it exists", () -> {
            equal(404, s.confirmResolution(HUNG, body("resolution_id", resolutionId[0], "decision", "CONFIRMED")).status(), "another reporter");
            equal(404, s.confirmResolution(MAI, body("resolution_id", resolutionId[0], "decision", "CONFIRMED")).status(), "another tenant's reporter");
            equal(403, s.confirmResolution(CUONG, body("resolution_id", resolutionId[0], "decision", "CONFIRMED")).status(), "the field team cannot confirm its own work");
            equal(400, s.confirmResolution(LAN, body("resolution_id", resolutionId[0], "decision", "LATER")).status(), "decision");
            equal(400, s.confirmResolution(LAN, body("resolution_id", resolutionId[0], "decision", "DISPUTED")).status(), "a dispute needs a reason");
            HttpResult r = s.confirmResolution(LAN, body("resolution_id", resolutionId[0], "decision", "CONFIRMED"));
            equal(200, r.status(), "confirmed: " + r.body());
            equal("RESOLVED", s.getStore().reports.get(id).status, "report resolved");
            equal("CONFIRMED", s.getStore().resolutions.get(resolutionId[0]).confirmationStatus, "resolution");
            equal(409, s.confirmResolution(LAN, body("resolution_id", resolutionId[0], "decision", "CONFIRMED")).status(), "no second confirmation");
        });
        test("closing the case completes only that case's workflow and keeps the audit chain valid", () -> {
            long done = s.getStore().bpmnEngine.listByTenant(ORG1).stream().filter(p -> "COMPLETED".equals(p.get("status"))).count();
            equal(1L, done, "exactly one workflow completed; the other open cases stay active");
            equal(Boolean.TRUE, s.getStore().auditLedger.verifyChainIntegrity().get("chain_valid"), "hash chain intact");
            boolean sealed = s.getStore().auditLedger.listRecentByTenant(ORG1, 300).stream()
                    .anyMatch(r -> "CONFIRM_RESOLUTION_AND_SEAL_LEDGER".equals(r.get("action")));
            isTrue(sealed, "seal record");
        });
        test("a disputed result sends the case back to the dispatcher", () -> {
            String id2 = verifiedReport(s, HUNG, "EVACUATION");
            String o2 = String.valueOf(dispatch(s, id2, "V02", "T02", "2030-02-01T08:00:00Z", "2030-02-01T10:00:00Z").body().get("order_id"));
            s.updateOrderStatus(CUONG, o2, body("status", "IN_PROGRESS", "progress_pct", 30));
            String res = String.valueOf(s.updateOrderStatus(CUONG, o2, body("status", "COMPLETED", "progress_pct", 100, "outcome", "PARTIAL")).body().get("resolution_id"));
            equal(200, s.confirmResolution(HUNG, body("resolution_id", res, "decision", "DISPUTED", "notes", "nước vẫn còn cao")).status(), "disputed");
            equal("VERIFIED", s.getStore().reports.get(id2).status, "back to dispatch");
            equal("DISPUTED", s.getStore().resolutions.get(res).confirmationStatus, "resolution");
            isTrue(s.getStore().bpmnEngine.listByTenant(ORG1).stream()
                    .anyMatch(p -> id2.equals(p.get("business_key")) && "taskDispatcherDispatch".equals(p.get("current_step_id"))), "workflow back at dispatch");
        });
        test("a dispatcher can confirm on behalf of a reporter who cannot (e.g. no phone)", () -> {
            String id3 = verifiedReport(s, HUNG, "EVACUATION");
            String o3 = String.valueOf(dispatch(s, id3, "V03", "T02", "2030-03-01T08:00:00Z", "2030-03-01T10:00:00Z").body().get("order_id"));
            s.updateOrderStatus(CUONG, o3, body("status", "IN_PROGRESS", "progress_pct", 50));
            String res = String.valueOf(s.updateOrderStatus(CUONG, o3, body("status", "COMPLETED", "progress_pct", 100, "outcome", "RESOLVED")).body().get("resolution_id"));
            equal(200, s.confirmResolution(HOA, body("resolution_id", res, "decision", "CONFIRMED")).status(), "by dispatcher");
            equal("usr_dispatcher_hoa", s.getStore().resolutions.get(res).confirmedBy, "who confirmed is recorded");
        });
    }

    private static void incidentRules() {
        suite("FloodOSService - vehicle incident, ranked replacements and re-plan");
        FloodOSService s = newService();
        final HttpResult[] reported = new HttpResult[1];

        test("a field team can only report an incident on a vehicle it works with; others get 404", () -> {
            equal(404, s.reportFieldIncident(CUONG, incidentBody("V01")).status(), "another team's vehicle");
            equal(404, s.reportFieldIncident(CUONG, incidentBody("V99")).status(), "unknown vehicle");
            equal(403, s.reportFieldIncident(LAN, incidentBody("V01")).status(), "reporter");
            equal(403, s.reportFieldIncident(GIANG, incidentBody("V01")).status(), "resource manager");
            Map<String, Object> noType = incidentBody("V01");
            noType.put("incident_type", "BORED");
            equal(400, s.reportFieldIncident(BINH, noType).status(), "incident type");
            Map<String, Object> noDown = incidentBody("V01");
            noDown.remove("estimated_downtime_hours");
            equal(400, s.reportFieldIncident(BINH, noDown).status(), "downtime is required");
            equal("IN_PROGRESS", s.getStore().orders.get("ORD-0001").status, "refused reports changed nothing");
        });
        test("the incident marks the vehicle BREAKDOWN, the order IMPACTED, and ranks only suitable, free, crewed replacements", () -> {
            reported[0] = s.reportFieldIncident(BINH, incidentBody("V01"));
            equal(201, reported[0].status(), "reported: " + reported[0].body());
            equal("BREAKDOWN", s.getStore().vehicles.get("V01").status, "vehicle");
            equal("IMPACTED", s.getStore().orders.get("ORD-0001").status, "order");
            equal("IMPACTED", s.getStore().reports.get("FR-0001").status, "report");
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> options = (List<Map<String, Object>>) reported[0].body().get("candidate_options");
            List<String> vehicles = ids(options, "vehicle_id");
            isTrue(vehicles.contains("V02") && vehicles.contains("V03"), "a free boat and a free truck are offered");
            isFalse(vehicles.contains("V01"), "never the broken vehicle");
            isFalse(vehicles.contains("V04"), "a pump cannot evacuate");
            isFalse(vehicles.contains("V05"), "a vehicle in maintenance is not offered");
            isFalse(vehicles.contains("V91"), "never another tenant's vehicle");
            equal("V02", vehicles.get(0), "the boat designed for evacuation ranks first");
            for (Map<String, Object> o : options) {
                equal("STRAIGHT_LINE_HAVERSINE", o.get("distance_kind"), "distance is declared as straight-line");
                isTrue(((Number) o.get("score")).doubleValue() > 0, "scored");
                isTrue(String.valueOf(o.get("explanations")).contains("Haversine"), "the ranking says how distance was measured");
            }
        });
        test("the same vehicle cannot be reported broken twice", () ->
                equal(409, s.reportFieldIncident(BINH, incidentBody("V01")).status(), "already broken"));
        test("approval is a human decision: option_id is mandatory, must exist, and only a dispatcher may approve", () -> {
            String inc = String.valueOf(reported[0].body().get("incident_id"));
            equal(403, s.approveReplan(BINH, inc, body("option_id", "x")).status(), "field team");
            equal(403, s.approveReplan(GIANG, inc, body("option_id", "x")).status(), "resource manager");
            equal(404, s.approveReplan(TUAN, inc, body("option_id", "x")).status(), "another tenant");
            equal(400, s.approveReplan(HOA, inc, body()).status(), "the system never auto-dispatches");
            equal(404, s.approveReplan(HOA, inc, body("option_id", "OPT-NOPE")).status(), "unknown option");
        });
        test("approving supersedes the old order, issues -R1 for the new vehicle and team, and reschedules the report", () -> {
            String inc = String.valueOf(reported[0].body().get("incident_id"));
            HttpResult r = s.approveReplan(HOA, inc, body("option_id", "OPT-V02-T02-ORD-0001"));
            equal(200, r.status(), "approved: " + r.body());
            equal("ORD-0001-R1", r.body().get("new_order_id"), "replacement id");
            DispatchOrder oldO = s.getStore().orders.get("ORD-0001");
            DispatchOrder newO = s.getStore().orders.get("ORD-0001-R1");
            equal("SUPERSEDED", oldO.status, "old");
            equal("ORD-0001-R1", oldO.supersededByOrderId, "link forward");
            equal("ORD-0001", newO.replacesOrderId, "link back");
            equal("V02", newO.vehicleId, "vehicle");
            equal("T02", newO.teamId, "team");
            equal("CONFIRMED", newO.status, "ready for the field team");
            equal("RESCHEDULED", s.getStore().reports.get("FR-0001").status, "report");
            equal("REPLAN_APPROVED", s.getStore().incidents.get(inc).status, "incident");
            equal("MOVING", s.getStore().vehicles.get("V02").status, "replacement heads out");
            equal(409, s.approveReplan(HOA, inc, body("option_id", "OPT-V02-T02-ORD-0001")).status(), "cannot approve twice");
        });
        test("the repair ticket belongs to the vehicle's manager; closing it frees the vehicle", () -> {
            String inc = String.valueOf(reported[0].body().get("incident_id"));
            equal(403, s.updateRepairTicket(DUNG, inc, body("diagnosis", "x")).status(), "field team");
            equal(403, s.updateRepairTicket(LAN, inc, body("diagnosis", "x")).status(), "reporter");
            equal(400, s.updateRepairTicket(GIANG, inc, body()).status(), "diagnosis required");
            equal(200, s.updateRepairTicket(GIANG, inc, body("diagnosis", "thay chân vịt")).status(), "in repair");
            equal("UNDER_REPAIR", s.getStore().incidents.get(inc).status, "status");
            equal("BREAKDOWN", s.getStore().vehicles.get("V01").status, "still broken until resolved");
            equal(200, s.updateRepairTicket(GIANG, inc, body("diagnosis", "đã thay xong", "is_resolved", true)).status(), "resolved");
            equal("IDLE", s.getStore().vehicles.get("V01").status, "vehicle back in service");
            equal(409, s.updateRepairTicket(GIANG, inc, body("diagnosis", "again")).status(), "ticket is closed");
        });
        test("no feasible replacement is reported honestly (422) instead of dispatching something unsuitable", () -> {
            FloodOSService s2 = newService();
            for (String v : new String[]{"V02", "V03", "V04", "V05"}) s2.getStore().vehicles.get(v).status = "MAINTENANCE";
            HttpResult r = s2.reportFieldIncident(BINH, incidentBody("V01"));
            equal(201, r.status(), "reported");
            equal(Boolean.TRUE, r.body().get("no_feasible_option"), "flag");
            equal(422, s2.approveReplan(HOA, String.valueOf(r.body().get("incident_id")), body("option_id", "any")).status(), "nothing to approve");
        });
    }

    private static Map<String, Object> incidentBody(String vehicleId) {
        return body("vehicle_id", vehicleId, "severity", "CRITICAL", "incident_type", "PROPELLER_FOULED",
                "description", "unit test", "estimated_downtime_hours", 6);
    }

    @SuppressWarnings("unchecked")
    private static void visibilityRules() {
        suite("FloodOSService - who sees what (mirrors the row-level security policies)");
        FloodOSService s = newService();

        test("a reporter sees only their own reports, the zones of those reports, and the vehicle serving them", () -> {
            equal(List.of("FR-0001", "FR-0003"), stateIds(s, LAN, "reports", "report_id"), "own reports only");
            equal(List.of("Z01"), stateIds(s, LAN, "zones", "zone_id"), "zones of own reports only");
            equal(List.of("ORD-0001"), stateIds(s, LAN, "orders", "order_id"), "orders of own reports");
            equal(List.of("V01"), stateIds(s, LAN, "vehicles", "vehicle_id"), "only the vehicle assigned to them");
            equal(List.of(), stateIds(s, LAN, "teams", "team_id"), "no teams");
            equal(List.of(), stateIds(s, LAN, "incidents", "incident_id"), "no incidents");
            equal(3, ((List<?>) s.getState(LAN).get("shelters")).size(), "shelters are public-safety information");
            equal(3, ((List<?>) s.getState(LAN).get("gauges")).size(), "gauges are public-safety information");
            equal(List.of(), (List<?>) s.getState(LAN).get("evidence_objects"), "no storage listing");
            Map<String, Object> st = s.getState(LAN);
            isFalse(JsonCodec.toJson(st).contains("FR-0002"), "the other reporter's report appears nowhere in the payload");
            isFalse(JsonCodec.toJson(st).contains("FR-0004"), "nor the other one");
        });
        test("the other reporter sees a disjoint set", () -> {
            equal(List.of("FR-0002", "FR-0004"), stateIds(s, HUNG, "reports", "report_id"), "own reports");
            equal(List.of("Z02", "Z03"), stateIds(s, HUNG, "zones", "zone_id"), "own zones");
            equal(List.of("ORD-0002"), stateIds(s, HUNG, "orders", "order_id"), "own order");
            equal(List.of("V03"), stateIds(s, HUNG, "vehicles", "vehicle_id"), "a CONFIRMED order shows its vehicle");
        });
        test("a dispatcher sees the whole organisation and nothing of another tenant", () -> {
            equal(List.of("FR-0001", "FR-0002", "FR-0003", "FR-0004"), stateIds(s, HOA, "reports", "report_id"), "reports");
            equal(5, ((List<?>) s.getState(HOA).get("vehicles")).size(), "all five vehicles");
            equal(List.of("FR-0091"), stateIds(s, TUAN, "reports", "report_id"), "other tenant has its own data");
            equal(List.of("V91"), stateIds(s, TUAN, "vehicles", "vehicle_id"), "other tenant's vehicle only");
            equal(List.of("Z91"), stateIds(s, TUAN, "zones", "zone_id"), "other tenant's zone only");
            equal(List.of(), stateIds(s, MAI, "orders", "order_id"), "other tenant's reporter");
        });
        test("a field team sees its own team, its orders, its vehicles and the reports behind them", () -> {
            equal(List.of("T01"), stateIds(s, BINH, "teams", "team_id"), "own team");
            equal(List.of("ORD-0001"), stateIds(s, BINH, "orders", "order_id"), "own order");
            equal(List.of("FR-0001"), stateIds(s, BINH, "reports", "report_id"), "report behind own order");
            equal(List.of("V01"), stateIds(s, BINH, "vehicles", "vehicle_id"), "own vehicle");
            equal(List.of(), stateIds(s, DUNG, "orders", "order_id"), "a team without orders sees none");
            equal(List.of("T03"), stateIds(s, DUNG, "teams", "team_id"), "its own team only");
        });
        test("a resource manager sees the fleet and orders but never citizens' reports or resolutions", () -> {
            equal(5, ((List<?>) s.getState(GIANG).get("vehicles")).size(), "fleet");
            equal(3, ((List<?>) s.getState(GIANG).get("teams")).size(), "teams");
            equal(List.of(), stateIds(s, GIANG, "reports", "report_id"), "no reports");
            equal(List.of(), stateIds(s, GIANG, "resolutions", "resolution_id"), "no resolutions");
        });
        test("the platform admin is limited to the tenant of the token but has no business privileges", () -> {
            equal(4, ((List<?>) s.getState(ADMIN).get("reports")).size(), "tenant data");
            isFalse(stateIds(s, ADMIN, "reports", "report_id").contains("FR-0091"), "not another tenant");
        });
        test("audit logs: staff see the tenant's trail, others only their own actions", () -> {
            isFalse(((List<?>) s.getState(HOA).get("audit_logs")).isEmpty(), "dispatcher sees the trail");
            for (Map<String, Object> rec : (List<Map<String, Object>>) s.getState(LAN).get("audit_logs")) {
                equal("reporter_lan", rec.get("actor_user_id"), "only own records");
            }
            equal(Boolean.TRUE, ((Map<String, Object>) s.getState(LAN).get("audit_chain_proof")).get("chain_valid"), "proof of the whole chain is shared");
        });
        test("the state is labelled with its data sources and a plain-language notice", () -> {
            Map<String, Object> st = s.getState(HOA);
            Map<String, Object> sources = (Map<String, Object>) st.get("data_sources");
            equal(Boolean.TRUE, sources.get("contains_simulated_data"), "simulated data is declared");
            equal("STRAIGHT_LINE_HAVERSINE", sources.get("distance_kind"), "distance kind");
            contains(String.valueOf(st.get("data_notice")), "MÔ PHỎNG", "notice");
            for (Map<String, Object> v : (List<Map<String, Object>>) st.get("vehicles")) {
                equal(Boolean.TRUE, v.get("position_is_simulated"), "vehicle " + v.get("vehicle_id") + " is not a real device");
            }
        });
        test("digital twin: tenant and role scoped, with the data source on every entity", () -> {
            List<String> lan = twinIds(s, LAN);
            isTrue(lan.contains("V01") && lan.contains("G01"), "own vehicle and public gauges");
            isFalse(lan.contains("V02"), "not other vehicles");
            equal(8, twinIds(s, GIANG).size(), "five vehicles and three gauges");
            equal(List.of("V91"), twinIds(s, TUAN), "other tenant has one vehicle and no gauge");
            for (Map<String, Object> e : (List<Map<String, Object>>) s.getDigitalTwinEntities(HOA).get("entities")) {
                notNull(e.get("dataSource"), "dataSource on " + e.get("id"));
            }
        });
        test("demo reset is closed by default and reserved to the platform admin", () -> {
            equal(403, s.resetDemo(HOA).status(), "dispatcher");
            equal(403, s.resetDemo(LAN).status(), "reporter");
            HttpResult r = s.resetDemo(ADMIN);
            if (!"true".equalsIgnoreCase(System.getenv("FLOODOS_ALLOW_DEMO_RESET"))) {
                equal("RESET_DISABLED", r.body().get("error"), "disabled unless FLOODOS_ALLOW_DEMO_RESET=true");
            }
        });
    }

    @SuppressWarnings("unchecked")
    private static List<String> twinIds(FloodOSService s, AuthContext a) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> e : (List<Map<String, Object>>) s.getDigitalTwinEntities(a).get("entities")) {
            String id = String.valueOf(e.get("id"));
            out.add(id.substring(id.lastIndexOf(':') + 1));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static void seedRules() {
        suite("Seed data and single sources of truth");
        FloodOSService s = newService();
        File root = FloodOSServer.resolveProjectRoot();

        test("every seeded zone is a closed ring that contains its own centre, and zones of a tenant do not overlap", () -> {
            var zones = new ArrayList<>(s.getStore().zones.values());
            for (FloodZone z : zones) {
                List<List<Double>> ring = z.polygon.get(0);
                equal(ring.get(0), ring.get(ring.size() - 1), "closed " + z.zoneId);
                isTrue(ring.get(0).get(0) < z.centerLng && z.centerLng < ring.get(2).get(0), "centre inside (lng) " + z.zoneId);
                isTrue(ring.get(0).get(1) < z.centerLat && z.centerLat < ring.get(2).get(1), "centre inside (lat) " + z.zoneId);
            }
            for (int i = 0; i < zones.size(); i++) {
                for (int j = i + 1; j < zones.size(); j++) {
                    var a = zones.get(i).polygon.get(0); var b = zones.get(j).polygon.get(0);
                    boolean separated = a.get(2).get(0) < b.get(0).get(0) || b.get(2).get(0) < a.get(0).get(0)
                            || a.get(2).get(1) < b.get(0).get(1) || b.get(2).get(1) < a.get(0).get(1);
                    isTrue(separated, zones.get(i).zoneId + " overlaps " + zones.get(j).zoneId);
                }
            }
        });
        test("every foreign key of the seed resolves in memory (teams, managers, reporters, zones, vehicles, orders)", () -> {
            FloodDataStore st = s.getStore();
            var userIds = new java.util.HashSet<String>();
            st.usersByUsername.values().forEach(u -> userIds.add(u.userId()));
            st.teams.values().forEach(t -> isTrue(userIds.contains(t.leadUserId()), "team lead " + t.teamId()));
            st.vehicles.values().forEach(v -> {
                isTrue(userIds.contains(v.managerUserId), "manager of " + v.vehicleId);
                isTrue(v.assignedTeamId == null || st.teams.containsKey(v.assignedTeamId), "team of " + v.vehicleId);
                equal(v.organizationId, st.teams.get(v.assignedTeamId).organizationId(), "vehicle and team share a tenant: " + v.vehicleId);
            });
            st.reports.values().forEach(r -> {
                isTrue(userIds.contains(r.reporterUserId), "reporter of " + r.reportId);
                equal(r.organizationId, st.zones.get(r.zoneId).organizationId, "report and zone share a tenant: " + r.reportId);
            });
            st.orders.values().forEach(o -> {
                equal(st.reports.get(o.reportId).reporterUserId, o.reporterUserId, "denormalised reporter matches: " + o.orderId);
                equal(st.vehicles.get(o.vehicleId).organizationId, o.organizationId, "order and vehicle share a tenant: " + o.orderId);
            });
            st.gauges.values().forEach(g -> isTrue(st.zones.containsKey(g.zoneId), "zone of gauge " + g.stationId));
            st.usersByUsername.values().forEach(u -> isTrue(FloodRoles.ALL.contains(u.role()), "known role " + u.username()));
        });
        test("the seed is labelled: nothing in it claims to be an observation", () -> {
            s.getStore().vehicles.values().forEach(v -> equal("SEED", v.telemetrySource, "vehicle " + v.vehicleId));
            s.getStore().zones.values().forEach(z -> equal("SEED", z.waterLevelSource, "zone " + z.zoneId));
            s.getStore().gauges.values().forEach(g -> equal("SIMULATOR", g.source, "gauge " + g.stationId));
            s.getStore().shelters.values().forEach(sh -> equal("SEED", sh.occupancySource, "shelter " + sh.shelterId));
        });
        test("the Keycloak realm and the application seed define exactly the same users, roles and tenants", () -> {
            Map<String, Object> realm = JsonCodec.parseObject(java.nio.file.Files.readString(new File(root, "infra/keycloak/floodos-realm.json").toPath()));
            List<Map<String, Object>> users = (List<Map<String, Object>>) realm.get("users");
            equal(s.getStore().usersByUsername.size(), users.size(), "same number of users");
            for (Map<String, Object> ru : users) {
                String name = String.valueOf(ru.get("username"));
                var seeded = s.getStore().usersByUsername.get(name);
                notNull(seeded, "seed has " + name);
                equal(seeded.userId(), ru.get("id"), "id of " + name);
                equal(List.of(seeded.role()), ru.get("realmRoles"), "role of " + name);
                equal(List.of(seeded.organizationId()), ((Map<String, Object>) ru.get("attributes")).get("organization_id"), "tenant of " + name);
            }
            List<String> realmRoles = new ArrayList<>();
            for (Map<String, Object> r : (List<Map<String, Object>>) ((Map<String, Object>) realm.get("roles")).get("realm")) realmRoles.add(String.valueOf(r.get("name")));
            equal(new java.util.TreeSet<>(FloodRoles.ALL), new java.util.TreeSet<>(realmRoles), "the roles of the realm are exactly the roles the application registers");
        });
        test("infra/db/schema.sql is the only DDL: it creates every table the application needs, with forced row-level security", () -> {
            String sql = java.nio.file.Files.readString(new File(root, "infra/db/schema.sql").toPath());
            for (String t : FloodRepository.requiredTables()) {
                isTrue(sql.contains("CREATE TABLE IF NOT EXISTS " + t + " ("), "schema creates " + t);
            }
            for (String t : FloodRepository.TABLES) {
                isTrue(sql.contains("ALTER TABLE " + t + " ENABLE ROW LEVEL SECURITY;"), "RLS enabled on " + t);
                isTrue(sql.contains("ALTER TABLE " + t + " FORCE ROW LEVEL SECURITY;"), "RLS forced on " + t);
            }
            isTrue(sql.contains("DROP POLICY IF EXISTS"), "policies are re-created idempotently");
            String pgSource = java.nio.file.Files.readString(new File(root, "core/data-services/PostgreSqlDataService.java").toPath());
            isFalse(pgSource.contains("CREATE TABLE"), "no second copy of the DDL in Java");
        });
        test("Tier-1 boundary: the platform core names no business domain", () -> {
            String[] forbidden = {"flood", "rescue", "harvest", "farmer", "coordinator", "reporter", "dispatcher", "field_team",
                    "resource_manager", "machine", "crop", "combine", "water-level", "gauge", "shelter", "vehicle"};
            List<String> hits = new ArrayList<>();
            try (var walk = java.nio.file.Files.walk(new File(root, "core").toPath())) {
                for (var p : (Iterable<java.nio.file.Path>) walk.filter(f -> f.toString().endsWith(".java"))::iterator) {
                    // the project name (package org.floodos, FLOODOS_* settings) is not a business-domain word
                    String text = java.nio.file.Files.readString(p).toLowerCase(java.util.Locale.ROOT).replace("floodos", "");
                    for (String word : forbidden) {
                        int at = text.indexOf(word);
                        while (at >= 0) {
                            int ls = text.lastIndexOf('\n', at) + 1;
                            String line = text.substring(ls, text.indexOf('\n', at) < 0 ? text.length() : text.indexOf('\n', at)).trim();
                            if (!(word.equals("machine") && line.contains("state machine"))) hits.add(p.getFileName() + " [" + word + "]: " + line);
                            at = text.indexOf(word, at + word.length());
                        }
                    }
                }
            }
            isTrue(hits.isEmpty(), "domain words found in core/: " + hits);
        });
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
        FloodOSServer server = new FloodOSServer(FloodOSServer.resolveProjectRoot());
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
            test("analytics is forbidden to everyone but dispatchers and the platform admin, even with a valid token", () -> {
                var reporter = new KeycloakOidcEngine.UserAccount("usr_reporter_lan", "reporter_lan", "pw", "Lan", "l@x", "ORG_HN_PILOT_01", "REPORTER");
                String tok = KeycloakOidcEngine.issueJwt(reporter);
                equal(403, http(base, "GET", "/api/v1/analytics/summary", null, "Authorization", "Bearer " + tok).statusCode(), "reporter");
            });
            test("analytics reports 503 (not a crash) when the cold tier is not configured", () -> {
                var coord = new KeycloakOidcEngine.UserAccount("usr_dispatcher_hoa", "dispatcher_hoa", "pw", "Hoa", "h@x", "ORG_HN_PILOT_01", "DISPATCHER");
                String tok = KeycloakOidcEngine.issueJwt(coord);
                HttpResponse<String> r = http(base, "GET", "/api/v1/analytics/summary", null, "Authorization", "Bearer " + tok);
                equal(503, r.statusCode(), "status");
                equal(404, http(base, "GET", "/api/v1/analytics/not-a-query", null, "Authorization", "Bearer " + tok).statusCode(), "unknown query name");
            });
            test("internal ingest endpoints fail closed when no ingest token is configured", () -> {
                if (System.getenv("FLOODOS_INGEST_TOKEN") != null && !System.getenv("FLOODOS_INGEST_TOKEN").isBlank()) {
                    return; // environment deliberately provides a token; the guard is covered by the e2e suite
                }
                equal(503, http(base, "POST", "/api/v1/internal/telemetry", "{}").statusCode(), "telemetry");
                equal(503, http(base, "GET", "/api/v1/internal/assets", null, "X-Ingest-Token", "anything").statusCode(), "asset roster");
            });
            test("a token with a role the application does not know is refused (401), never defaulted to a role", () -> {
                var legacy = new KeycloakOidcEngine.UserAccount("usr_farmer_ba", "farmer_ba", "pw", "Ba", "b@x", "ORG_HN_PILOT_01", "FARMER");
                String tok = KeycloakOidcEngine.issueJwt(legacy);
                equal(401, http(base, "GET", "/api/v1/state", null, "Authorization", "Bearer " + tok).statusCode(), "unknown role");
            });
            test("business routes enforce roles through the real router", () -> {
                var reporter = new KeycloakOidcEngine.UserAccount("usr_reporter_lan", "reporter_lan", "pw", "Lan", "l@x", "ORG_HN_PILOT_01", "REPORTER");
                String tok = KeycloakOidcEngine.issueJwt(reporter);
                String h = "Authorization";
                equal(403, http(base, "POST", "/api/v1/dispatch-orders", "{}", h, "Bearer " + tok).statusCode(), "reporter cannot dispatch");
                equal(403, http(base, "POST", "/api/v1/flood-reports/FR-0001/verify", "{}", h, "Bearer " + tok).statusCode(), "reporter cannot verify");
                equal(403, http(base, "POST", "/api/v1/sim/reset", "{}", h, "Bearer " + tok).statusCode(), "reporter cannot reset the demo data");
                equal(400, http(base, "POST", "/api/v1/flood-reports", "{}", h, "Bearer " + tok).statusCode(), "empty report is a validation error");
                equal(404, http(base, "POST", "/api/v1/nonexistent", "{}", h, "Bearer " + tok).statusCode(), "unknown route");
                equal(200, http(base, "GET", "/api/v1/state", null, h, "Bearer " + tok).statusCode(), "own state");
            });
            test("every request of the Postman collection targets a route the server really has", () -> {
                Map<String, Object> col = JsonCodec.parseObject(java.nio.file.Files.readString(
                        new File(FloodOSServer.resolveProjectRoot(), "tests/postman/FloodOS.postman_collection.json").toPath()));
                int checked = 0;
                for (Object folder : (List<?>) col.get("item")) {
                    for (Object item : (List<?>) ((Map<?, ?>) folder).get("item")) {
                        Map<?, ?> request = (Map<?, ?>) ((Map<?, ?>) item).get("request");
                        String raw = String.valueOf(((Map<?, ?>) request.get("url")).get("raw")).replace("{{base_url}}", "");
                        if (!raw.startsWith("/api/v1")) continue;                      // /trace/* belongs to the Tier-3 module
                        String path = raw.replaceAll("\\{\\{[^}]*\\}\\}", "x");
                        String method = String.valueOf(request.get("method"));
                        String token = null;
                        Map<?, ?> auth = (Map<?, ?>) request.get("auth");
                        if (auth != null && "bearer".equals(auth.get("type"))) {
                            String var = String.valueOf(((Map<?, ?>) ((List<?>) auth.get("bearer")).get(0)).get("value"));
                            String user = var.replace("{{", "").replace("_token}}", "");
                            if (user.equals("replacement_team")) user = "team_binh";
                            String role = user.startsWith("reporter") ? "REPORTER" : user.startsWith("dispatcher") ? "DISPATCHER"
                                    : user.startsWith("team") ? "FIELD_TEAM" : "RESOURCE_MANAGER";
                            String org = (user.endsWith("tuan") || user.endsWith("mai") || user.endsWith("hai")) ? "ORG_HN_PILOT_02" : "ORG_HN_PILOT_01";
                            token = KeycloakOidcEngine.issueJwt(new KeycloakOidcEngine.UserAccount("usr_" + user, user, "pw", user, user + "@x", org, role));
                        }
                        String payload = "{}";
                        if (request.get("body") != null) {
                            payload = String.valueOf(((Map<?, ?>) request.get("body")).get("raw")).replaceAll("\\{\\{[^}]*\\}\\}", "x");
                        }
                        HttpResponse<String> r = token == null
                                ? http(base, method, path, "GET".equals(method) ? null : payload)
                                : http(base, method, path, "GET".equals(method) ? null : payload, "Authorization", "Bearer " + token);
                        Map<String, Object> answer = JsonCodec.parseObject(r.body());
                        // an unknown ROUTE answers {"error":"NOT_FOUND","path":...}; a record the caller cannot see answers NOT_FOUND without "path"
                        boolean unknownRoute = "NOT_FOUND".equals(answer.get("error")) && answer.containsKey("path");
                        isFalse(unknownRoute || r.statusCode() == 405, method + " " + path + " is not a route of the server (" + r.statusCode() + " " + answer.get("error") + ")");
                        checked++;
                    }
                }
                isTrue(checked >= 30, "the collection exercises the API (" + checked + " requests checked)");
            });
            test("health exposes event-bus and cold-tier status", () -> {
                HttpResponse<String> r = http(base, "GET", "/api/v1/health", null);
                equal(200, r.statusCode(), "status");
                Map<?, ?> core = (Map<?, ?>) JsonCodec.parseObject(r.body()).get("core_services");
                Map<?, ?> bus = (Map<?, ?>) core.get("event_bus");
                notNull(bus.get("mode"), "event bus mode");
                notNull(core.get("cold_analytics_lake"), "cold tier status");
            });
            test("capabilities exposes active deployment profile and modular services", () -> {
                HttpResponse<String> r = http(base, "GET", "/api/v1/system/capabilities", null);
                equal(200, r.statusCode(), "status");
                Map<?, ?> caps = JsonCodec.parseObject(r.body());
                equal(1, ((Number) caps.get("tier")).intValue(), "tier 1");
                equal("OPERATIONAL", caps.get("status"), "operational");
                notNull(caps.get("profile"), "profile code");
                notNull(caps.get("profile_label"), "profile label");
                Map<?, ?> s = (Map<?, ?>) caps.get("services");
                notNull(s.get("identity"), "identity service");
                notNull(s.get("workflow"), "workflow service");
                notNull(s.get("database"), "database service");
                notNull(s.get("storage"), "storage service");
                notNull(s.get("gateway"), "gateway service");
            });
            test("DeploymentProfile switches dynamically between FULL, STANDARD, and EDGE_FIELD", () -> {
                try {
                    DeploymentProfile.setProfileForTesting(DeploymentProfile.EDGE_FIELD);
                    isTrue(DeploymentProfile.isEdgeField(), "is edge field");
                    equal("EDGE_FIELD", DeploymentProfile.getActiveProfile().name(), "code");
                    isTrue(DeploymentProfile.getActiveProfile().getMemoryFootprint().contains("<800MB"), "lightweight footprint");

                    DeploymentProfile.setProfileForTesting(DeploymentProfile.STANDARD);
                    equal("STANDARD", DeploymentProfile.getActiveProfile().name(), "standard");

                    DeploymentProfile.setProfileForTesting(DeploymentProfile.FULL);
                    isTrue(DeploymentProfile.isFull(), "is full");
                } finally {
                    DeploymentProfile.resetProfileForTesting();
                }
            });
            test("health exposes ai_assistant status and capabilities includes ai co-pilot", () -> {
                HttpResponse<String> r = http(base, "GET", "/api/v1/health", null);
                equal(200, r.statusCode(), "status");
                Map<?, ?> core = (Map<?, ?>) JsonCodec.parseObject(r.body()).get("core_services");
                notNull(core.get("ai_assistant"), "ai_assistant in core_services");

                HttpResponse<String> capRes = http(base, "GET", "/api/v1/system/capabilities", null);
                equal(200, capRes.statusCode(), "caps status");
                Map<?, ?> caps = JsonCodec.parseObject(capRes.body());
                Map<?, ?> s = (Map<?, ?>) caps.get("services");
                notNull(s.get("ai_assistant"), "ai assistant in capabilities");
            });
            test("ai situation summary and priority classification work seamlessly with fallback", () -> {
                String tok = KeycloakOidcEngine.issueJwt(new KeycloakOidcEngine.UserAccount("usr_dispatcher_hoa", "dispatcher_hoa", "pw", "Hoa", "hoa@x", "ORG_HN_PILOT_01", FloodRoles.DISPATCHER));
                HttpResponse<String> summaryRes = http(base, "GET", "/api/v1/flood-reports/FR-0001/ai-summary", null, "Authorization", "Bearer " + tok);
                equal(200, summaryRes.statusCode(), "ai summary status");
                Map<?, ?> sumBody = JsonCodec.parseObject(summaryRes.body());
                equal("FR-0001", sumBody.get("report_id"), "report id");
                notNull(sumBody.get("summary_text"), "summary text");
                notNull(sumBody.get("suggested_actions"), "suggested actions");
                isTrue(String.valueOf(sumBody.get("engine")).contains("FALLBACK"), "fallback engine active");

                Map<String, Object> classifyReq = Map.of(
                        "description", "Cần cấp cứu khẩn cấp, người già mắc kẹt nguy kịch",
                        "depth_cm", 110.0,
                        "people_affected", 3,
                        "need_type", "MEDICAL"
                );
                HttpResponse<String> clsRes = http(base, "POST", "/api/v1/ai/classify-priority", JsonCodec.toJson(classifyReq), "Authorization", "Bearer " + tok);
                equal(200, clsRes.statusCode(), "classify status");
                Map<?, ?> clsBody = JsonCodec.parseObject(clsRes.body());
                equal("CRITICAL", clsBody.get("suggested_priority"), "critical priority");

                HttpResponse<String> aarRes = http(base, "GET", "/api/v1/flood-reports/FR-0001/after-action-report", null, "Authorization", "Bearer " + tok);
                equal(200, aarRes.statusCode(), "aar status");
                Map<?, ?> aarBody = JsonCodec.parseObject(aarRes.body());
                isTrue(String.valueOf(aarBody.get("markdown_content")).contains("BÁO CÁO TỔNG KẾT"), "aar markdown header");
            });
        } finally {
            server.stop();
            KeycloakOidcEngine.resetAuthModeForTesting();
        }
    }
}
