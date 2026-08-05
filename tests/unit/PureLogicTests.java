// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.tests.unit;

import static org.openagrios.tests.unit.TestKit.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.openagrios.core.dataservices.JsonCodec;
import org.openagrios.core.dataservices.NgsiLdTwinMapper;
import org.openagrios.core.dataservices.ScheduleConflictEngine;
import org.openagrios.core.dataservices.ScheduleConflictEngine.SchedulableAssignment;
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
    private record Asg(String id, String org, String field, String machine, String operator,
                       String start, String end, String status) implements SchedulableAssignment {
        public String assignmentId() { return id; }
        public String organizationId() { return org; }
        public String fieldId() { return field; }
        public String machineId() { return machine; }
        public String operatorId() { return operator; }
        public String startTime() { return start; }
        public String endTime() { return end; }
        public Map<String, Object> toConflictSummaryMap() { return Map.of("assignment_id", id); }
    }

    private static Asg asg(String id, String org, String machine, String op, String s, String e, String status) {
        return new Asg(id, org, "F01", machine, op, s, e, status);
    }

    private static Map<String, Object> check(String machine, String status, boolean exists, String op,
                                             String s, String e, String ignore, List<Asg> existing) {
        return ScheduleConflictEngine.checkConflict("ORG", machine, status, exists, op, s, e, ignore, existing);
    }

    private static void scheduleConflicts() {
        suite("ScheduleConflictEngine");
        final String T8 = "2026-11-20T08:00:00Z", T10 = "2026-11-20T10:00:00Z",
                T12 = "2026-11-20T12:00:00Z", T14 = "2026-11-20T14:00:00Z";
        List<Asg> base = List.of(asg("A1", "ORG", "M01", "OP-01", T10, T12, "CONFIRMED"));

        test("unknown machine -> MACHINE_NOT_FOUND", () ->
                equal("MACHINE_NOT_FOUND", check("M99", "MISSING", false, "OP-01", T8, T10, null, base).get("code"), "code"));
        test("BREAKDOWN and MAINTENANCE machines are unavailable", () -> {
            equal("MACHINE_UNAVAILABLE", check("M01", "BREAKDOWN", true, "OP-09", T8, T10, null, List.of()).get("code"), "breakdown");
            equal("MACHINE_UNAVAILABLE", check("M01", "MAINTENANCE", true, "OP-09", T8, T10, null, List.of()).get("code"), "maintenance");
        });
        test("overlapping window on the same machine conflicts", () -> {
            Map<String, Object> r = check("M01", "IDLE", true, "OP-09", T8, "2026-11-20T11:00:00Z", null, base);
            equal("MACHINE_TIME_OVERLAP", r.get("code"), "code");
            equal(Map.of("assignment_id", "A1"), r.get("conflicting_assignment"), "reports the blocking assignment");
        });
        test("window fully containing / contained by an existing one conflicts", () -> {
            equal("MACHINE_TIME_OVERLAP", check("M01", "IDLE", true, "OP-09", T8, T14, null, base).get("code"), "contains");
            equal("MACHINE_TIME_OVERLAP", check("M01", "IDLE", true, "OP-09", "2026-11-20T10:30:00Z", "2026-11-20T11:30:00Z", null, base).get("code"), "contained");
        });
        test("back-to-back windows touching at an endpoint do NOT conflict (half-open ranges)", () -> {
            isNull(check("M01", "IDLE", true, "OP-09", T8, T10, null, base), "ends exactly when the other starts");
            isNull(check("M01", "IDLE", true, "OP-09", T12, T14, null, base), "starts exactly when the other ends");
        });
        test("same operator on a different machine at the same time -> OPERATOR_TIME_OVERLAP", () ->
                equal("OPERATOR_TIME_OVERLAP", check("M02", "IDLE", true, "OP-01", T10, T12, null, base).get("code"), "code"));
        test("machine conflict takes precedence over operator conflict", () ->
                equal("MACHINE_TIME_OVERLAP", check("M01", "IDLE", true, "OP-01", T10, T12, null, base).get("code"), "precedence"));
        test("other tenants' assignments never block", () -> {
            List<Asg> other = List.of(asg("X1", "OTHER_ORG", "M01", "OP-01", T10, T12, "CONFIRMED"));
            isNull(check("M01", "IDLE", true, "OP-01", T10, T12, null, other), "cross-tenant isolation");
        });
        test("only CONFIRMED / IN_PROGRESS assignments block", () -> {
            for (String st : new String[]{"COMPLETED", "SUPERSEDED", "CANCELLED", "PENDING"}) {
                List<Asg> l = List.of(asg("S", "ORG", "M01", "OP-01", T10, T12, st));
                isNull(check("M01", "IDLE", true, "OP-01", T10, T12, null, l), "status " + st + " must not block");
            }
            List<Asg> ip = List.of(asg("S", "ORG", "M01", "OP-01", T10, T12, "IN_PROGRESS"));
            equal("MACHINE_TIME_OVERLAP", check("M01", "IDLE", true, "OP-09", T10, T12, null, ip).get("code"), "IN_PROGRESS blocks");
        });
        test("ignoreAssignmentId lets a re-plan replace its own slot", () ->
                isNull(check("M01", "IDLE", true, "OP-01", T10, T12, "A1", base), "ignored id"));
        test("empty schedule never conflicts", () ->
                isNull(check("M01", "IDLE", true, "OP-01", T10, T12, null, new ArrayList<>()), "no assignments"));
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
        test("score reproduces the documented rescue example (M02: 1.37 km, 0.72 ha/h, rating 4.95 -> 93.8)", () ->
                equal(93.8, SpatialMatchingEngine.computeMultiCriteriaScore(1.37, 0.72, 4.95), "golden score"));
        test("score decreases monotonically with distance and floors the distance term at 10 km", () -> {
            double near = SpatialMatchingEngine.computeMultiCriteriaScore(1, 0.7, 4.5);
            double far = SpatialMatchingEngine.computeMultiCriteriaScore(8, 0.7, 4.5);
            double veryFar = SpatialMatchingEngine.computeMultiCriteriaScore(50, 0.7, 4.5);
            double at10 = SpatialMatchingEngine.computeMultiCriteriaScore(10, 0.7, 4.5);
            isTrue(near > far, "closer scores higher");
            equal(at10, veryFar, "distance term is clamped at 0 beyond 10 km");
        });
        test("capacity contribution is capped at 25 points", () -> {
            double a = SpatialMatchingEngine.computeMultiCriteriaScore(0, 0.78125, 5);
            double b = SpatialMatchingEngine.computeMultiCriteriaScore(0, 5.0, 5);
            equal(a, b, "capacity beyond 0.78125 ha/h adds nothing");
        });
        test("operator rating scales linearly up to 15 points", () -> {
            double r0 = SpatialMatchingEngine.computeMultiCriteriaScore(0, 0.5, 0);
            double r5 = SpatialMatchingEngine.computeMultiCriteriaScore(0, 0.5, 5);
            near(15.0, r5 - r0, 0.11, "rating span");
        });
        test("perfect candidate reaches the 100-point ceiling", () ->
                equal(100.0, SpatialMatchingEngine.computeMultiCriteriaScore(0, 1.0, 5), "ceiling"));
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
            Map<String, Object> e = NgsiLdTwinMapper.toNgsiLdEntity("HarvesterMachine", "M02", props, 105.5715, 10.068);
            equal("urn:ngsi-ld:HarvesterMachine:M02", e.get("id"), "id");
            equal("HarvesterMachine", e.get("type"), "type");
            contains(String.valueOf(e.get("@context")), "ngsi-ld-core-context", "context");
            notNull(e.get("status"), "property merged at top level");
            Map<?, ?> loc = (Map<?, ?>) e.get("location");
            equal("GeoProperty", loc.get("type"), "GeoProperty");
            Map<?, ?> point = (Map<?, ?>) loc.get("value");
            equal("Point", point.get("type"), "Point");
            equal(List.of(105.5715, 10.068), point.get("coordinates"), "[lng, lat] order");
        });
    }

    // ------------------------------------------------------------------ TenantRlsContext
    private static void tenant() {
        suite("TenantRlsContext");
        AuthContext farmerBa = new AuthContext("usr_farmer_ba", "farmer_ba", "HTX_CANTHO_01", "FARMER");
        AuthContext coordinator = new AuthContext("usr_coord_01", "coord_htx01", "HTX_CANTHO_01", "COORDINATOR");
        AuthContext repair = new AuthContext("usr_repair", "repair_01", "HTX_CANTHO_01", "REPAIR_TEAM");

        test("RLS SQL sets all three session variables", () -> {
            String sql = TenantRlsContext.buildPostgresRlsPolicySql("HTX_CANTHO_01", "FARMER", "usr_farmer_ba");
            contains(sql, "app.current_org_id = 'HTX_CANTHO_01'", "org");
            contains(sql, "app.current_user_role = 'FARMER'", "role");
            contains(sql, "app.current_user_id = 'usr_farmer_ba'", "user");
        });
        test("single quotes are doubled so a hostile identity cannot break out of the literal", () -> {
            String sql = TenantRlsContext.buildPostgresRlsPolicySql("x'; DROP TABLE fields; --", "r", "u");
            contains(sql, "'x''; DROP TABLE fields; --'", "quote doubled inside the literal");
            isFalse(sql.contains("x'; DROP"), "no unescaped quote followed by a statement");
        });
        test("null identities become empty strings (deny-by-default) instead of throwing", () -> {
            contains(TenantRlsContext.buildPostgresRlsPolicySql(null, null, null), "app.current_org_id = ''", "null org");
            contains(TenantRlsContext.buildPostgresRlsPolicySql((AuthContext) null), "app.current_user_role = ''", "null auth");
        });
        test("applyPostgresRlsSession tolerates a missing connection", () ->
                TenantRlsContext.applyPostgresRlsSession(null, "o", "r", "u"));
        test("isSameTenant is strict equality and null-safe", () -> {
            isTrue(TenantRlsContext.isSameTenant(coordinator, "HTX_CANTHO_01"), "same org");
            isFalse(TenantRlsContext.isSameTenant(coordinator, "HTX_SOCTRANG_02"), "other org");
            isFalse(TenantRlsContext.isSameTenant(coordinator, "htx_cantho_01"), "case sensitive");
            isFalse(TenantRlsContext.isSameTenant(null, "HTX_CANTHO_01"), "null auth");
            isFalse(TenantRlsContext.isSameTenant(coordinator, null), "null resource org");
        });
        test("field visibility: owner and coordinator see everything, others are fogged", () -> {
            equal("FULL", TenantRlsContext.resolveFieldVisibility(farmerBa, "usr_farmer_ba"), "own field");
            equal("FOG_OF_WAR", TenantRlsContext.resolveFieldVisibility(farmerBa, "usr_farmer_tam"), "neighbour's field");
            equal("FULL", TenantRlsContext.resolveFieldVisibility(coordinator, "usr_farmer_tam"), "coordinator");
            equal("FOG_OF_WAR", TenantRlsContext.resolveFieldVisibility(repair, "usr_repair"), "repair team never sees fields");
        });
    }
}
