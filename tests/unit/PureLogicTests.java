// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.tests.unit;

import static org.openagrios.tests.unit.TestKit.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.openagrios.apps.floodops.RescueScoring;
import org.openagrios.core.dataservices.JsonCodec;
import org.openagrios.core.dataservices.NgsiLdTwinMapper;
import org.openagrios.core.dataservices.ScheduleConflictEngine;
import org.openagrios.core.dataservices.ScheduleConflictEngine.Booking;
import org.openagrios.core.dataservices.SpatialMatchingEngine;
import org.openagrios.core.dataservices.TenantRlsContext;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;

/** Deterministic, side-effect-free logic: JSON, scheduling, geodesy/scoring, NGSI-LD, tenant helpers. */
final class PureLogicTests {

    private PureLogicTests() {}

    static void run() {
        json();
        scheduleConflicts();
        spatial();
        rescueScoring();
        ngsiLd();
        tenant();
    }

    // ------------------------------------------------------------------ JsonCodec
    private static void json() {
        suite("JsonCodec");
        test("serialises scalars, null and escapes", () -> {
            equal("null", JsonCodec.toJson(null), "null");
            equal("true", JsonCodec.toJson(true), "boolean");
            equal("42", JsonCodec.toJson(42), "int");
            equal("9000000000", JsonCodec.toJson(9_000_000_000L), "long");
            equal("\"a\\\"b\\\\c\\n\\t\"", JsonCodec.toJson("a\"b\\c\n\t"), "string escapes");
            equal("\"\\u0001\"", JsonCodec.toJson("\u0001"), "control char is \\u-escaped");
            equal("\"Cần Thơ\"", JsonCodec.toJson("Cần Thơ"), "non-ASCII passes through unchanged");
        });
        test("whole doubles keep a fractional part, others use shortest repr", () -> {
            equal("2.0", JsonCodec.toJson(2.0), "whole double");
            equal("0.65", JsonCodec.toJson(0.65), "fraction");
            equal("-3.5", JsonCodec.toJson(-3.5), "negative");
        });
        test("non-finite doubles never produce invalid JSON (RFC 8259 has no NaN/Infinity)", () -> {
            equal("null", JsonCodec.toJson(Double.NaN), "NaN -> null");
            equal("null", JsonCodec.toJson(Double.POSITIVE_INFINITY), "+Inf -> null");
            equal("null", JsonCodec.toJson(Double.NEGATIVE_INFINITY), "-Inf -> null");
            equal("{\"v\":null}", JsonCodec.toJson(Map.of("v", Double.NaN)), "nested NaN");
        });
        test("serialises nested maps and iterables", () -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("b", List.of(1, "x", true));
            m.put("a", Map.of("k", 1.5));
            equal("{\"b\":[1,\"x\",true],\"a\":{\"k\":1.5}}", JsonCodec.toJson(m), "insertion order kept");
            equal("{}", JsonCodec.toJson(Map.of()), "empty map");
            equal("[]", JsonCodec.toJson(List.of()), "empty list");
        });
        test("canonical form sorts keys recursively and ignores insertion order", () -> {
            Map<String, Object> one = new LinkedHashMap<>();
            one.put("z", 1);
            one.put("a", Map.of("y", 1, "b", 2));
            Map<String, Object> two = new LinkedHashMap<>();
            two.put("a", new LinkedHashMap<>(Map.of("b", 2, "y", 1)));
            two.put("z", 1);
            equal(JsonCodec.toCanonicalJson(one), JsonCodec.toCanonicalJson(two), "same canonical text");
            equal("{\"a\":{\"b\":2,\"y\":1},\"z\":1}", JsonCodec.toCanonicalJson(one), "sorted at every level");
        });
        test("parses objects with typed numbers", () -> {
            Map<String, Object> m = JsonCodec.parseObject("{\"i\": 7, \"d\": 2.5, \"e\": 1e3, \"neg\": -4, \"t\": true, \"f\": false, \"n\": null}");
            equal(7L, m.get("i"), "integers become Long");
            equal(2.5, m.get("d"), "decimals become Double");
            equal(1000.0, m.get("e"), "exponent notation is a Double");
            equal(-4L, m.get("neg"), "negative integer");
            equal(Boolean.TRUE, m.get("t"), "true");
            equal(Boolean.FALSE, m.get("f"), "false");
            isTrue(m.containsKey("n") && m.get("n") == null, "null is preserved as a present key");
        });
        test("parses nested structures, whitespace and unicode escapes", () -> {
            Map<String, Object> m = JsonCodec.parseObject(" {\n \"a\" : [ 1 , {\"b\" : \"\\u00e9\\n\\\"q\\\"\"} ] , \"c\":{} } ");
            List<?> a = (List<?>) m.get("a");
            equal(2, a.size(), "list size");
            equal("é\n\"q\"", ((Map<?, ?>) a.get(1)).get("b"), "escapes decoded");
            equal(0, ((Map<?, ?>) m.get("c")).size(), "empty nested object");
        });
        test("blank, null and non-object input yield an empty map, not an exception", () -> {
            equal(0, JsonCodec.parseObject(null).size(), "null");
            equal(0, JsonCodec.parseObject("   ").size(), "blank");
            equal(0, JsonCodec.parseObject("[1,2]").size(), "array root");
        });
        test("round-trips arbitrary payloads", () -> {
            Map<String, Object> src = new LinkedHashMap<>();
            src.put("name", "Máy Gặt \"M01\"");
            src.put("lat", 10.0645);
            src.put("count", 3L);
            src.put("tags", List.of("a", "b"));
            Map<String, Object> back = JsonCodec.parseObject(JsonCodec.toJson(src));
            equal(src.get("name"), back.get("name"), "string");
            equal(src.get("lat"), back.get("lat"), "double");
            equal(src.get("count"), back.get("count"), "long");
            equal(src.get("tags"), back.get("tags"), "list");
        });
        test("strict parser accepts well-formed objects and treats a blank body as empty", () -> {
            equal(0, JsonCodec.parseObjectStrict("").size(), "empty body");
            equal(0, JsonCodec.parseObjectStrict("  \n ").size(), "blank body");
            equal(0, JsonCodec.parseObjectStrict("{}").size(), "empty object");
            Map<String, Object> m = JsonCodec.parseObjectStrict(" {\"a\" : [1, 2.5, \"x\", null, true], \"b\": {\"c\": \"\\u00e9\"} } ");
            equal(5, ((List<?>) m.get("a")).size(), "list");
            equal("é", ((Map<?, ?>) m.get("b")).get("c"), "unicode escape");
        });
        test("strict parser rejects garbage instead of silently degrading to {} (which would trigger handler defaults)", () -> {
            String[] bad = {
                    "not-json", "nope", "{not json at all", "{\"a\": abc}", "{\"a\":1} trailing", "{\"a\":1}{\"b\":2}",
                    "{\"a\":1", "{'a':1}", "{\"a\" 1}", "{\"a\":1,}", "{\"a\":[1,2}", "{\"a\":tru}", "{\"a\":nul}",
                    "{\"a\":\"unterminated}", "{\"a\":\"bad\\q\"}", "{\"a\":\"\\u12\"}", "{\"a\":\"\\uZZZZ\"}",
                    "{\"a\": 99999999999999999999}", "{\"a\": --1}", "{\"a\":\"raw\ncontrol\"}", "{,}", "{\"a\":}"
            };
            for (String b : bad) {
                throwsA(IllegalArgumentException.class, () -> JsonCodec.parseObjectStrict(b), "input: " + b.replace("\n", "\\n"));
            }
        });
        test("strict parser requires an object at the root", () -> {
            for (String b : new String[]{"[1,2]", "\"text\"", "42", "true", "null"}) {
                throwsA(IllegalArgumentException.class, () -> JsonCodec.parseObjectStrict(b), "root: " + b);
            }
        });
        test("lenient parser (trusted upstream responses) still tolerates garbage by returning an empty map", () ->
                equal(0, JsonCodec.parseObject("not-json").size(), "documented lenient behaviour"));
    }

    // ------------------------------------------------------------------ ScheduleConflictEngine
    private record Slot(String id, String org, String resource, String holder,
                        String start, String end, String status) implements Booking {
        public String bookingId() { return id; }
        public String organizationId() { return org; }
        public String resourceId() { return resource; }
        public String holderId() { return holder; }
        public String startTime() { return start; }
        public String endTime() { return end; }
        public Map<String, Object> toConflictSummaryMap() { return Map.of("booking_id", id); }
    }

    private static final Set<String> ACTIVE = Set.of("CONFIRMED", "IN_PROGRESS");
    private static final Set<String> UNAVAILABLE = Set.of("BREAKDOWN", "MAINTENANCE");

    private static Slot slot(String id, String org, String resource, String holder, String s, String e, String status) {
        return new Slot(id, org, resource, holder, s, e, status);
    }

    private static Map<String, Object> check(String resource, String status, boolean exists, String holder,
                                             String s, String e, String ignore, List<Slot> existing) {
        return ScheduleConflictEngine.checkConflict("ORG", resource, status, exists, UNAVAILABLE, holder, s, e, ignore, ACTIVE, existing);
    }

    private static void scheduleConflicts() {
        suite("ScheduleConflictEngine (domain-neutral bookings)");
        final String T8 = "2026-11-20T08:00:00Z", T10 = "2026-11-20T10:00:00Z",
                T12 = "2026-11-20T12:00:00Z", T14 = "2026-11-20T14:00:00Z";
        List<Slot> base = List.of(slot("A1", "ORG", "V01", "T-01", T10, T12, "CONFIRMED"));

        test("unknown resource -> RESOURCE_NOT_FOUND", () ->
                equal("RESOURCE_NOT_FOUND", check("V99", "MISSING", false, "T-01", T8, T10, null, base).get("code"), "code"));
        test("BREAKDOWN and MAINTENANCE resources are unavailable and the status is reported", () -> {
            Map<String, Object> r = check("V01", "BREAKDOWN", true, "T-09", T8, T10, null, List.of());
            equal("RESOURCE_UNAVAILABLE", r.get("code"), "breakdown");
            equal("BREAKDOWN", r.get("resource_status"), "status echoed");
            equal("RESOURCE_UNAVAILABLE", check("V01", "MAINTENANCE", true, "T-09", T8, T10, null, List.of()).get("code"), "maintenance");
        });
        test("overlapping window on the same resource conflicts and names the blocking booking", () -> {
            Map<String, Object> r = check("V01", "IDLE", true, "T-09", T8, "2026-11-20T11:00:00Z", null, base);
            equal("RESOURCE_TIME_OVERLAP", r.get("code"), "code");
            equal(Map.of("booking_id", "A1"), r.get("conflicting_booking"), "reports the blocking booking");
        });
        test("window fully containing / contained by an existing one conflicts", () -> {
            equal("RESOURCE_TIME_OVERLAP", check("V01", "IDLE", true, "T-09", T8, T14, null, base).get("code"), "contains");
            equal("RESOURCE_TIME_OVERLAP", check("V01", "IDLE", true, "T-09", "2026-11-20T10:30:00Z", "2026-11-20T11:30:00Z", null, base).get("code"), "contained");
        });
        test("back-to-back windows touching at an endpoint do NOT conflict (half-open ranges)", () -> {
            isNull(check("V01", "IDLE", true, "T-09", T8, T10, null, base), "ends exactly when the other starts");
            isNull(check("V01", "IDLE", true, "T-09", T12, T14, null, base), "starts exactly when the other ends");
        });
        test("same holder on a different resource at the same time -> HOLDER_TIME_OVERLAP", () ->
                equal("HOLDER_TIME_OVERLAP", check("V02", "IDLE", true, "T-01", T10, T12, null, base).get("code"), "code"));
        test("resource conflict takes precedence over holder conflict", () ->
                equal("RESOURCE_TIME_OVERLAP", check("V01", "IDLE", true, "T-01", T10, T12, null, base).get("code"), "precedence"));
        test("other tenants' bookings never block", () -> {
            List<Slot> other = List.of(slot("X1", "OTHER_ORG", "V01", "T-01", T10, T12, "CONFIRMED"));
            isNull(check("V01", "IDLE", true, "T-01", T10, T12, null, other), "cross-tenant isolation");
        });
        test("only the statuses the caller declares as active block", () -> {
            for (String st : new String[]{"COMPLETED", "SUPERSEDED", "CANCELLED", "IMPACTED", "PENDING"}) {
                List<Slot> l = List.of(slot("S", "ORG", "V01", "T-01", T10, T12, st));
                isNull(check("V01", "IDLE", true, "T-01", T10, T12, null, l), "status " + st + " must not block");
            }
            List<Slot> ip = List.of(slot("S", "ORG", "V01", "T-01", T10, T12, "IN_PROGRESS"));
            equal("RESOURCE_TIME_OVERLAP", check("V01", "IDLE", true, "T-09", T10, T12, null, ip).get("code"), "IN_PROGRESS blocks");
        });
        test("ignoreBookingId lets a re-plan replace its own slot", () ->
                isNull(check("V01", "IDLE", true, "T-01", T10, T12, "A1", base), "ignored id"));
        test("empty schedule never conflicts", () ->
                isNull(check("V01", "IDLE", true, "T-01", T10, T12, null, new ArrayList<>()), "no bookings"));
    }

    // ------------------------------------------------------------------ SpatialMatchingEngine
    private static void spatial() {
        suite("SpatialMatchingEngine");
        test("distance between identical points is 0", () ->
                near(0.0, SpatialMatchingEngine.spatialDistanceKm(10.0, 105.0, 10.0, 105.0), 0.0, "zero"));
        test("one degree of latitude is ~111.19 km (R=6371) and rounds to 2 decimals", () ->
                equal(111.19, SpatialMatchingEngine.spatialDistanceKm(10.0, 105.0, 11.0, 105.0), "1 deg"));
        test("distance is symmetric", () -> {
            double ab = SpatialMatchingEngine.spatialDistanceKm(10.0645, 105.5586, 10.0680, 105.5715);
            double ba = SpatialMatchingEngine.spatialDistanceKm(10.0680, 105.5715, 10.0645, 105.5586);
            equal(ab, ba, "symmetry");
        });
        test("longitude degrees shrink with latitude", () -> {
            double equator = SpatialMatchingEngine.spatialDistanceKm(0, 105, 0, 106);
            double cantho = SpatialMatchingEngine.spatialDistanceKm(10, 105, 10, 106);
            isTrue(cantho < equator, "1 deg lon at 10N must be shorter than at the equator");
            near(111.19, equator, 0.01, "equator");
        });
        test("antipodal-ish points stay finite (no NaN from the atan2 formulation)", () -> {
            double d = SpatialMatchingEngine.spatialDistanceKm(0, 0, 0, 179.999);
            isTrue(Double.isFinite(d) && d > 19_000, "half circumference ~20015 km, got " + d);
        });
        test("GeoJSON polygon is a closed ring in [lng, lat] order", () -> {
            List<List<List<Double>>> poly = SpatialMatchingEngine.makeGeoJsonPolygon(10.0, 105.0, 0.001, 0.002);
            equal(1, poly.size(), "one ring");
            List<List<Double>> ring = poly.get(0);
            equal(5, ring.size(), "5 vertices (closed)");
            equal(ring.get(0), ring.get(4), "first == last");
            equal(List.of(104.998, 9.999), ring.get(0), "south-west corner as [lng, lat]");
            equal(List.of(105.002, 10.001), ring.get(2), "north-east corner as [lng, lat]");
        });
        test("a polygon generated for a stated area really has that area (any latitude)", () -> {
            for (double lat : new double[]{0, 10.07, 21.0, 45}) {
                for (double ha : new double[]{0.5, 2.0, 2.4, 3.1, 12.0}) {
                    double got = SpatialMatchingEngine.ringAreaHa(SpatialMatchingEngine.polygonForArea(lat, 105.5, ha).get(0));
                    near(ha, got, ha * 0.01, "lat " + lat + " area " + ha);
                }
            }
        });
        test("generated polygons are closed rectangles centred on the field with the 1.3 aspect", () -> {
            List<List<Double>> ring = SpatialMatchingEngine.polygonForArea(10.07, 105.57, 2.4).get(0);
            equal(5, ring.size(), "5 vertices");
            equal(ring.get(0), ring.get(4), "closed");
            double cx = (ring.get(0).get(0) + ring.get(2).get(0)) / 2, cy = (ring.get(0).get(1) + ring.get(2).get(1)) / 2;
            near(105.57, cx, 1e-5, "centre lng");
            near(10.07, cy, 1e-5, "centre lat");
            double w = (ring.get(1).get(0) - ring.get(0).get(0)) * 111_320 * Math.cos(Math.toRadians(10.07));
            double h = (ring.get(2).get(1) - ring.get(1).get(1)) * 111_320;
            near(1.3, w / h, 0.01, "aspect ratio");
        });
        test("ring area helper: shoelace is orientation independent and degenerate input is 0", () -> {
            List<List<Double>> ring = SpatialMatchingEngine.polygonForArea(10, 105, 1.0).get(0);
            List<List<Double>> reversed = new java.util.ArrayList<>(ring);
            java.util.Collections.reverse(reversed);
            near(SpatialMatchingEngine.ringAreaHa(ring), SpatialMatchingEngine.ringAreaHa(reversed), 1e-9, "orientation");
            equal(0.0, SpatialMatchingEngine.ringAreaHa(null), "null");
            equal(0.0, SpatialMatchingEngine.ringAreaHa(List.of()), "empty");
        });
    }

    // ------------------------------------------------------------------ RescueScoring (application level)
    private static void rescueScoring() {
        suite("RescueScoring (Hanoi FloodOps ranking)");
        test("a perfect candidate reaches 100 points", () ->
                equal(100.0, RescueScoring.score(0, 1.0, 1.0, 5.0), "ceiling"));
        test("distance is straight-line, decreases the score and reaches zero at the ranked limit", () -> {
            double near = RescueScoring.score(1, 1.0, 1.0, 4.5);
            double far = RescueScoring.score(8, 1.0, 1.0, 4.5);
            double atLimit = RescueScoring.score(RescueScoring.MAX_RANKED_DISTANCE_KM, 1.0, 1.0, 4.5);
            double beyond = RescueScoring.score(80, 1.0, 1.0, 4.5);
            isTrue(near > far, "closer scores higher");
            equal(atLimit, beyond, "the distance term floors at zero beyond the limit");
            near(40.0, RescueScoring.score(0, 1.0, 1.0, 4.5) - atLimit, 0.11, "distance span is 40 points");
        });
        test("team rating contributes up to 15 points", () -> {
            near(15.0, RescueScoring.score(0, 1, 1, 5) - RescueScoring.score(0, 1, 1, 0), 0.11, "rating span");
        });
        test("suitability and capacity fit are clamped to [0,1]", () -> {
            equal(RescueScoring.score(0, 1.0, 1.0, 5), RescueScoring.score(0, 9.0, 9.0, 5), "upper clamp");
            equal(RescueScoring.score(0, 0.0, 0.0, 5), RescueScoring.score(0, -3.0, -3.0, 5), "lower clamp");
        });
        test("vehicle suitability by need: designed, usable, unfit", () -> {
            equal(1.0, RescueScoring.suitability("RESCUE_BOAT", "EVACUATION"), "boat evacuates");
            equal(0.5, RescueScoring.suitability("HIGH_CLEARANCE_TRUCK", "EVACUATION"), "truck can evacuate");
            equal(0.0, RescueScoring.suitability("MOBILE_PUMP", "EVACUATION"), "a pump cannot evacuate");
            equal(1.0, RescueScoring.suitability("MOBILE_PUMP", "PUMPING"), "pump pumps");
            equal(0.0, RescueScoring.suitability("RESCUE_BOAT", "PUMPING"), "a boat cannot pump");
            equal(1.0, RescueScoring.suitability("HIGH_CLEARANCE_TRUCK", "MEDICAL"), "truck for medical");
            equal(0.0, RescueScoring.suitability("RESCUE_BOAT", "UNKNOWN_NEED"), "unknown need offers nothing");
        });
        test("capacity fit: persons are compared with people affected, pumps with a stated m3/h per cm heuristic", () -> {
            equal(1.0, RescueScoring.capacityFit("PERSONS", 10, 6, 60), "enough seats");
            equal(0.5, RescueScoring.capacityFit("PERSONS", 5, 10, 60), "half of the people fit");
            equal(1.0, RescueScoring.capacityFit("PERSONS", 5, 0, 60), "no people stated");
            equal(1.0, RescueScoring.capacityFit("M3_PER_HOUR", 1200, 0, 60), "1200 m3/h covers 60 cm (600 m3/h target)");
            near(0.5, RescueScoring.capacityFit("M3_PER_HOUR", 300, 0, 60), 1e-9, "300 of 600");
        });
    }

    // ------------------------------------------------------------------ NgsiLdTwinMapper
    private static void ngsiLd() {
        suite("NgsiLdTwinMapper");
        test("Property carries value and optional unit / observedAt", () -> {
            Map<String, Object> full = NgsiLdTwinMapper.toProperty(88.0, "P1", "2026-11-20T09:15:00Z");
            equal("Property", full.get("type"), "type");
            equal(88.0, full.get("value"), "value");
            equal("P1", full.get("unitCode"), "unit");
            equal("2026-11-20T09:15:00Z", full.get("observedAt"), "observedAt");
            Map<String, Object> bare = NgsiLdTwinMapper.toProperty("x", null, null);
            isFalse(bare.containsKey("unitCode") || bare.containsKey("observedAt"), "optional keys omitted when null");
        });
        test("entity has urn id, core @context, properties and a GeoJSON Point in [lng, lat]", () -> {
            Map<String, Map<String, Object>> props = new LinkedHashMap<>();
            props.put("status", NgsiLdTwinMapper.toProperty("IDLE", null, null));
            Map<String, Object> e = NgsiLdTwinMapper.toNgsiLdEntity("RescueVehicle", "V02", props, 105.8800, 20.9640);
            equal("urn:ngsi-ld:RescueVehicle:V02", e.get("id"), "id");
            equal("RescueVehicle", e.get("type"), "type");
            contains(String.valueOf(e.get("@context")), "ngsi-ld-core-context", "context");
            notNull(e.get("status"), "property merged at top level");
            Map<?, ?> loc = (Map<?, ?>) e.get("location");
            equal("GeoProperty", loc.get("type"), "GeoProperty");
            Map<?, ?> point = (Map<?, ?>) loc.get("value");
            equal("Point", point.get("type"), "Point");
            equal(List.of(105.88, 20.964), point.get("coordinates"), "[lng, lat] order");
        });
    }

    // ------------------------------------------------------------------ TenantRlsContext
    private static void tenant() {
        suite("TenantRlsContext");
        AuthContext reporter = new AuthContext("usr_reporter_lan", "reporter_lan", "ORG_HN_PILOT_01", "REPORTER");
        AuthContext coordinator = new AuthContext("usr_dispatcher_hoa", "dispatcher_hoa", "ORG_HN_PILOT_01", "DISPATCHER");

        test("RLS SQL sets all three session variables", () -> {
            String sql = TenantRlsContext.buildPostgresRlsPolicySql("ORG_HN_PILOT_01", "REPORTER", "usr_reporter_lan");
            contains(sql, "app.current_org_id = 'ORG_HN_PILOT_01'", "org");
            contains(sql, "app.current_user_role = 'REPORTER'", "role");
            contains(sql, "app.current_user_id = 'usr_reporter_lan'", "user");
        });
        test("single quotes are doubled so a hostile identity cannot break out of the literal", () -> {
            String sql = TenantRlsContext.buildPostgresRlsPolicySql("x'; DROP TABLE flood_reports; --", "r", "u");
            contains(sql, "'x''; DROP TABLE flood_reports; --'", "quote doubled inside the literal");
            isFalse(sql.contains("x'; DROP"), "no unescaped quote followed by a statement");
        });
        test("null identities become empty strings (deny-by-default) instead of throwing", () -> {
            contains(TenantRlsContext.buildPostgresRlsPolicySql(null, null, null), "app.current_org_id = ''", "null org");
            contains(TenantRlsContext.buildPostgresRlsPolicySql((AuthContext) null), "app.current_user_role = ''", "null auth");
        });
        test("applyPostgresRlsSession tolerates a missing connection", () ->
                TenantRlsContext.applyPostgresRlsSession(null, "o", "r", "u"));
        test("isSameTenant is strict equality and null-safe", () -> {
            isTrue(TenantRlsContext.isSameTenant(coordinator, "ORG_HN_PILOT_01"), "same org");
            isFalse(TenantRlsContext.isSameTenant(coordinator, "ORG_HN_PILOT_02"), "other org");
            isFalse(TenantRlsContext.isSameTenant(coordinator, "org_hn_pilot_01"), "case sensitive");
            isFalse(TenantRlsContext.isSameTenant(null, "ORG_HN_PILOT_01"), "null auth");
            isFalse(TenantRlsContext.isSameTenant(coordinator, null), "null resource org");
        });
        test("the platform role used for seeding and rehydration is PLATFORM_ADMIN", () ->
                equal("PLATFORM_ADMIN", TenantRlsContext.PLATFORM_ROLE, "constant"));
    }
}
