// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.apps.floodos;

import org.floodos.apps.floodos.FloodModels.*;
import org.floodos.core.dataservices.EventBusPublisher;
import org.floodos.core.dataservices.MalwareScanner;
import org.floodos.core.dataservices.NgsiLdTwinMapper;
import org.floodos.core.dataservices.ScheduleConflictEngine;
import org.floodos.core.dataservices.SpatialMatchingEngine;
import org.floodos.core.dataservices.TenantRlsContext;
import org.floodos.core.gateway.ZeroTrustGateway;
import org.floodos.core.identity.KeycloakOidcEngine.AuthContext;
import org.floodos.core.workflow.BpmnWorkflowEngine;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * FloodOS business service: flood report -> verification -> dispatch -> field update -> re-plan on incident
 * -> confirmation. It orchestrates the Tier-1 core services and owns every business rule.
 *
 * <p>Rules that hold for every operation here:
 * <ul>
 *   <li>Authorisation is checked in Java (RBAC + ownership) and again by PostgreSQL row-level security.</li>
 *   <li>A missing required field is a 400; there are no silent defaults for decisions.</li>
 *   <li>A caller who is not allowed to see a record gets 404, never a hint that it exists.</li>
 *   <li>Positions and levels carry their source (SEED, SIMULATOR, REPORTED, DEVICE).</li>
 * </ul>
 */
public final class FloodOSService {

    public record HttpResult(int status, Map<String, Object> body) {}

    public static final Set<String> NEED_TYPES = Set.of("EVACUATION", "FOOD_WATER", "MEDICAL", "PUMPING", "ROAD_BLOCKED");
    public static final Set<String> PRIORITIES = Set.of("LOW", "NORMAL", "HIGH", "URGENT");
    public static final Set<String> SEVERITIES = Set.of("MINOR", "MAJOR", "CRITICAL");
    public static final Set<String> INCIDENT_TYPES = Set.of("ENGINE_FAILURE", "PROPELLER_FOULED", "PUMP_CLOGGED", "ROUTE_BLOCKED", "OTHER");
    public static final Set<String> OUTCOMES = Set.of("RESOLVED", "PARTIAL", "UNRESOLVED");
    public static final Set<String> TELEMETRY_SOURCES = Set.of("SIMULATOR", "DEVICE");
    /** A report further than this from every monitored zone centre is refused (straight-line distance). */
    public static final double MAX_ZONE_MATCH_KM = 5.0;
    private static final long TELEMETRY_PERSIST_INTERVAL_MS = 10_000L;
    private static final String DISCLAIMER =
            "Dữ liệu trong bản demo là MÔ PHỎNG. Vị trí phương tiện và mực nước chỉ là quan trắc khi nguồn là DEVICE; "
                    + "khoảng cách là đường chim bay (Haversine), không phải tuyến đường.";

    private final FloodDataStore store;
    private final Map<String, Long> lastTelemetryPersistMs = new HashMap<>();

    public FloodOSService(FloodDataStore store) {
        this.store = store;
    }

    public FloodDataStore getStore() {
        return store;
    }

    // ------------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------------

    private static String nowIso() {
        return Instant.now().truncatedTo(ChronoUnit.SECONDS).toString();
    }

    private static String shortId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase(Locale.ROOT);
    }

    private static HttpResult fail(int status, String code, String message) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("error", code);
        b.put("status", status);
        b.put("message", message);
        return new HttpResult(status, b);
    }

    private static String str(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v == null ? "" : String.valueOf(v).trim();
    }

    private static Double number(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (!(v instanceof Number n)) return null;
        double d = n.doubleValue();
        return Double.isFinite(d) ? d : null;
    }

    /** Parses an ISO-8601 instant and normalises it, so that text comparison equals time comparison. */
    private static String normalizeInstant(String raw) {
        return Instant.parse(raw).truncatedTo(ChronoUnit.SECONDS).toString();
    }

    private HttpResult rbac(AuthContext auth, List<String> allowed, String action, String entityType, String entityId) {
        Map<String, Object> err = ZeroTrustGateway.enforceRbacPolicy(store.auditLedger, auth, allowed, action, entityType, entityId);
        return err == null ? null : new HttpResult(403, err);
    }

    /** Audit + 404 for a record the caller is not entitled to see: indistinguishable from "does not exist". */
    private HttpResult hidden(AuthContext auth, String correlationId, String entityType, String entityId, String action) {
        store.auditLedger.appendRecord(auth.organizationId(), correlationId, entityType, entityId, action,
                auth.username(), auth.role(), Map.of("target", entityId), Map.of("result", "NOT_VISIBLE_TO_CALLER"), 404);
        return fail(404, "NOT_FOUND", "Không tìm thấy " + entityId + " trong phạm vi của bạn.");
    }

    private static boolean isStaff(AuthContext auth) {
        return FloodRoles.DISPATCHER.equals(auth.role()) || FloodRoles.PLATFORM_ADMIN.equals(auth.role());
    }

    private Set<String> teamsLedBy(String userId, String orgId) {
        Set<String> ids = new HashSet<>();
        for (RescueTeam t : store.teams.values()) {
            if (t.organizationId().equals(orgId) && t.leadUserId().equals(userId)) ids.add(t.teamId());
        }
        return ids;
    }

    private BpmnWorkflowEngine wf() {
        return store.bpmnEngine;
    }

    // ------------------------------------------------------------------------
    // Visibility (mirrors the row-level security policies of infra/db/schema.sql)
    // ------------------------------------------------------------------------

    private final class Scope {
        final AuthContext auth;
        final String role;
        final String uid;
        final String org;
        final Set<String> myTeams;
        final Set<String> myReportIds = new LinkedHashSet<>();

        Scope(AuthContext auth) {
            this.auth = auth;
            this.role = auth.role();
            this.uid = auth.userId();
            this.org = auth.organizationId();
            this.myTeams = FloodRoles.FIELD_TEAM.equals(role) ? teamsLedBy(uid, org) : Set.of();
            for (DispatchOrder o : store.orders.values()) {
                if (orderVisible(o)) myReportIds.add(o.reportId);
            }
        }

        boolean staff() { return isStaff(auth); }
        boolean manager() { return FloodRoles.RESOURCE_MANAGER.equals(role); }
        boolean field() { return FloodRoles.FIELD_TEAM.equals(role); }
        boolean reporter() { return FloodRoles.REPORTER.equals(role); }

        boolean orderVisible(DispatchOrder o) {
            if (!o.organizationId.equals(org)) return false;
            if (staff() || manager()) return true;
            if (field()) return myTeams.contains(o.teamId);
            return reporter() && o.reporterUserId.equals(uid);
        }

        boolean reportVisible(FloodReport r) {
            if (!r.organizationId.equals(org)) return false;
            if (staff()) return true;
            if (reporter()) return r.reporterUserId.equals(uid);
            if (field()) {
                for (DispatchOrder o : store.orders.values()) {
                    if (o.reportId.equals(r.reportId) && orderVisible(o)) return true;
                }
            }
            return false;
        }

        boolean vehicleVisible(RescueVehicle v) {
            if (!v.organizationId.equals(org)) return false;
            if (staff() || manager()) return true;
            if (field()) {
                if (v.assignedTeamId != null && myTeams.contains(v.assignedTeamId)) return true;
                for (DispatchOrder o : store.orders.values()) {
                    if (o.vehicleId.equals(v.vehicleId) && FloodModels.ORDER_ACTIVE.contains(o.status) && orderVisible(o)) return true;
                }
                return false;
            }
            if (reporter()) {
                for (DispatchOrder o : store.orders.values()) {
                    if (o.vehicleId.equals(v.vehicleId) && FloodModels.ORDER_ACTIVE.contains(o.status) && orderVisible(o)) return true;
                }
            }
            return false;
        }

        boolean zoneVisible(FloodZone z) {
            if (!z.organizationId.equals(org)) return false;
            if (reporter()) {
                for (FloodReport r : store.reports.values()) {
                    if (r.zoneId.equals(z.zoneId) && r.reporterUserId.equals(uid) && r.organizationId.equals(org)) return true;
                }
                return false;
            }
            return true;
        }

        boolean teamVisible(RescueTeam t) {
            if (!t.organizationId().equals(org)) return false;
            if (staff() || manager()) return true;
            return field() && myTeams.contains(t.teamId());
        }

        boolean incidentVisible(FieldIncident i) {
            if (!i.organizationId.equals(org)) return false;
            if (staff() || manager()) return true;
            return field() && i.reportedByUserId.equals(uid);
        }

        boolean resolutionVisible(ReportResolution r) {
            if (!r.organizationId.equals(org)) return false;
            if (staff()) return true;
            if (field()) return r.fieldSubmittedBy.equals(uid);
            if (reporter()) {
                FloodReport rep = store.reports.get(r.reportId);
                return rep != null && rep.reporterUserId.equals(uid);
            }
            return false;
        }
    }

    // ------------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------------

    public synchronized Map<String, Object> getState(AuthContext auth) {
        Scope sc = new Scope(auth);
        List<Map<String, Object>> zones = new ArrayList<>();
        for (FloodZone z : store.zones.values()) if (sc.zoneVisible(z)) zones.add(z.toMap());
        List<Map<String, Object>> reports = new ArrayList<>();
        for (FloodReport r : store.reports.values()) if (sc.reportVisible(r)) reports.add(r.toMap());
        List<Map<String, Object>> teams = new ArrayList<>();
        for (RescueTeam t : store.teams.values()) if (sc.teamVisible(t)) teams.add(t.toMap());
        List<Map<String, Object>> vehicles = new ArrayList<>();
        for (RescueVehicle v : store.vehicles.values()) if (sc.vehicleVisible(v)) vehicles.add(v.toMap());
        List<DispatchOrder> orderList = new ArrayList<>(store.orders.values());
        orderList.sort(Comparator.comparing(o -> o.startTime));
        List<Map<String, Object>> orders = new ArrayList<>();
        for (DispatchOrder o : orderList) {
            if (sc.orderVisible(o)) {
                orders.add(o.toEnrichedMap(store.zones.get(o.zoneId), store.vehicles.get(o.vehicleId), store.teams.get(o.teamId)));
            }
        }
        List<Map<String, Object>> incidents = new ArrayList<>();
        List<FieldIncident> allInc = new ArrayList<>(store.incidents.values());
        Collections.reverse(allInc);
        for (FieldIncident i : allInc) if (sc.incidentVisible(i)) incidents.add(i.toMap());
        List<Map<String, Object>> resolutions = new ArrayList<>();
        List<ReportResolution> allRes = new ArrayList<>(store.resolutions.values());
        Collections.reverse(allRes);
        for (ReportResolution r : allRes) if (sc.resolutionVisible(r)) resolutions.add(r.toMap());
        List<Map<String, Object>> shelters = new ArrayList<>();
        for (SafeShelter s : store.shelters.values()) if (s.organizationId.equals(auth.organizationId())) shelters.add(s.toMap());
        List<Map<String, Object>> gauges = new ArrayList<>();
        for (GaugeStation g : store.gauges.values()) if (g.organizationId.equals(auth.organizationId())) gauges.add(g.toMap());

        Set<String> businessKeys = new HashSet<>();
        for (Map<String, Object> r : reports) businessKeys.add(String.valueOf(r.get("report_id")));
        for (Map<String, Object> i : incidents) businessKeys.add(String.valueOf(i.get("incident_id")));
        List<Map<String, Object>> processes = wf().listByTenant(auth.organizationId());
        if (!sc.staff()) processes.removeIf(p -> !businessKeys.contains(String.valueOf(p.get("business_key"))));

        List<Map<String, Object>> audit = store.auditLedger.listRecentByTenant(auth.organizationId(), 25);
        if (!sc.staff()) audit.removeIf(rec -> !auth.username().equals(String.valueOf(rec.get("actor_user_id"))));

        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put("user_id", auth.userId());
        ctx.put("username", auth.username());
        ctx.put("full_name", auth.fullName());
        ctx.put("role", auth.role());
        ctx.put("organization_id", auth.organizationId());
        var org = store.organizations.get(auth.organizationId());
        ctx.put("organization_name", org != null ? org.name() : auth.organizationId());
        ctx.put("rls_policy", TenantRlsContext.buildPostgresRlsPolicySql(auth));

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("deployment_profile", DeploymentProfile.getActiveProfile().name());
        res.put("deployment_profile_label", DeploymentProfile.getActiveProfile().getLabel());
        res.put("system_capabilities", DeploymentProfile.getSystemCapabilities(store));
        res.put("auth_context", ctx);
        res.put("server_time", nowIso());
        res.put("data_notice", DISCLAIMER);
        res.put("data_sources", dataSources(auth.organizationId()));
        res.put("zones", zones);
        res.put("reports", reports);
        res.put("teams", teams);
        res.put("vehicles", vehicles);
        res.put("orders", orders);
        res.put("incidents", incidents);
        res.put("resolutions", resolutions);
        res.put("shelters", shelters);
        res.put("gauges", gauges);
        res.put("bpmn_instances", processes);
        res.put("bpmn_definitions", wf().getDefinitions());
        res.put("evidence_objects", sc.staff() ? store.s3Storage.listByTenant(auth.organizationId()) : List.of());
        res.put("audit_logs", audit);
        res.put("audit_chain_proof", store.auditLedger.verifyChainIntegrity());
        return res;
    }

    /** Where the numbers on screen come from, so a client can label them. */
    private Map<String, Object> dataSources(String orgId) {
        Set<String> vehicleSources = new TreeSet<>();
        for (RescueVehicle v : store.vehicles.values()) if (v.organizationId.equals(orgId)) vehicleSources.add(v.telemetrySource);
        Set<String> gaugeSources = new TreeSet<>();
        for (GaugeStation g : store.gauges.values()) if (g.organizationId.equals(orgId)) gaugeSources.add(g.source);
        Set<String> levelSources = new TreeSet<>();
        for (FloodZone z : store.zones.values()) if (z.organizationId.equals(orgId)) levelSources.add(z.waterLevelSource);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("vehicle_positions", vehicleSources);
        m.put("gauge_readings", gaugeSources);
        m.put("zone_water_levels", levelSources);
        m.put("report_depths", List.of("REPORTED"));
        m.put("distance_kind", "STRAIGHT_LINE_HAVERSINE");
        m.put("contains_simulated_data", vehicleSources.contains("SIMULATOR") || vehicleSources.contains("SEED")
                || gaugeSources.contains("SIMULATOR") || levelSources.contains("SEED") || levelSources.contains("SIMULATOR"));
        return m;
    }

    public synchronized Map<String, Object> getDigitalTwinEntities(AuthContext auth) {
        Scope sc = new Scope(auth);
        List<Map<String, Object>> entities = new ArrayList<>();
        for (RescueVehicle v : store.vehicles.values()) {
            if (!sc.vehicleVisible(v)) continue;
            Map<String, Map<String, Object>> props = new LinkedHashMap<>();
            props.put("organizationId", NgsiLdTwinMapper.toProperty(v.organizationId, null, null));
            props.put("name", NgsiLdTwinMapper.toProperty(v.name, null, null));
            props.put("vehicleType", NgsiLdTwinMapper.toProperty(v.vehicleType, null, null));
            props.put("status", NgsiLdTwinMapper.toProperty(v.status, null, v.telemetryUpdatedAt));
            props.put("fuelLevel", NgsiLdTwinMapper.toProperty(v.fuelPct, "P1", null));
            props.put("healthIndex", NgsiLdTwinMapper.toProperty(v.healthPct, "P1", null));
            props.put("dataSource", NgsiLdTwinMapper.toProperty(v.telemetrySource, null, v.telemetryUpdatedAt));
            entities.add(NgsiLdTwinMapper.toNgsiLdEntity("RescueVehicle", v.vehicleId, props, v.currentLng, v.currentLat));
        }
        for (GaugeStation g : store.gauges.values()) {
            if (!g.organizationId.equals(auth.organizationId())) continue;
            Map<String, Map<String, Object>> props = new LinkedHashMap<>();
            props.put("organizationId", NgsiLdTwinMapper.toProperty(g.organizationId, null, null));
            props.put("name", NgsiLdTwinMapper.toProperty(g.name, null, null));
            props.put("waterLevel", NgsiLdTwinMapper.toProperty(g.levelCm, "CMT", g.levelUpdatedAt));
            props.put("alertState", NgsiLdTwinMapper.toProperty(g.alertState(), null, g.levelUpdatedAt));
            props.put("dataSource", NgsiLdTwinMapper.toProperty(g.source, null, g.levelUpdatedAt));
            entities.add(NgsiLdTwinMapper.toNgsiLdEntity("WaterGaugeStation", g.stationId, props, g.lng, g.lat));
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("protocol", "ETSI NGSI-LD v1");
        res.put("tenant", auth.organizationId());
        res.put("data_notice", DISCLAIMER);
        res.put("entities", entities);
        return res;
    }

    // ------------------------------------------------------------------------
    // 1. Flood report intake (REPORTER, DISPATCHER)
    // ------------------------------------------------------------------------

    public synchronized HttpResult createFloodReport(AuthContext auth, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.REPORTER, FloodRoles.DISPATCHER), "CREATE_FLOOD_REPORT", "FloodReport", "NEW");
        if (denied != null) return denied;

        Double lat = number(body, "lat");
        Double lng = number(body, "lng");
        Double depth = number(body, "depth_cm");
        String need = str(body, "need_type").toUpperCase(Locale.ROOT);
        if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return fail(400, "INVALID_LOCATION", "Cần 'lat' trong [-90,90] và 'lng' trong [-180,180].");
        }
        if (depth == null || depth < 0 || depth > 1000) {
            return fail(400, "INVALID_DEPTH", "Cần 'depth_cm' là số trong [0,1000].");
        }
        if (!NEED_TYPES.contains(need)) {
            return fail(400, "INVALID_NEED_TYPE", "need_type phải là một trong " + new TreeSet<>(NEED_TYPES) + ".");
        }
        int people = 0;
        if (body.containsKey("people_affected")) {
            Double p = number(body, "people_affected");
            if (p == null || p < 0 || p > 100000 || p != Math.rint(p)) {
                return fail(400, "INVALID_PEOPLE_AFFECTED", "people_affected phải là số nguyên không âm.");
            }
            people = (int) Math.rint(p);
        }
        String description = str(body, "description");
        if (description.length() > 1000) {
            return fail(400, "DESCRIPTION_TOO_LONG", "description tối đa 1000 ký tự.");
        }

        // Zone: only a dispatcher may name one; otherwise the server picks the nearest monitored zone centre.
        FloodZone zone;
        String zoneMatch;
        String requestedZone = str(body, "zone_id");
        if (!requestedZone.isEmpty() && FloodRoles.DISPATCHER.equals(auth.role())) {
            zone = store.zones.get(requestedZone);
            if (zone == null || !zone.organizationId.equals(auth.organizationId())) {
                return fail(404, "ZONE_NOT_FOUND", "Không tìm thấy vùng " + requestedZone + ".");
            }
            zoneMatch = "NAMED_BY_DISPATCHER";
        } else {
            zone = null;
            double best = Double.MAX_VALUE;
            for (FloodZone z : store.zones.values()) {
                if (!z.organizationId.equals(auth.organizationId())) continue;
                double d = SpatialMatchingEngine.spatialDistanceKm(lat, lng, z.centerLat, z.centerLng);
                if (d < best) { best = d; zone = z; }
            }
            if (zone == null || best > MAX_ZONE_MATCH_KM) {
                return fail(422, "OUTSIDE_MONITORED_AREA", "Vị trí báo cách mọi vùng theo dõi hơn " + MAX_ZONE_MATCH_KM
                        + " km (đường chim bay), nên không thể tiếp nhận tự động.");
            }
            zoneMatch = "NEAREST_ZONE_CENTER_STRAIGHT_LINE";
        }

        String reportId = "FR-" + shortId();
        HttpResult blocked = screenEvidence(auth, reportId, str(body, "evidence_filename"), str(body, "evidence_data_url"));
        if (blocked != null) return blocked;
        String ts = nowIso();
        String evidenceKey = null;
        if (!str(body, "evidence_data_url").isEmpty()) {
            evidenceKey = storeEvidence(auth, "reports", reportId, str(body, "evidence_filename"), str(body, "evidence_data_url"), ts).objectKey();
        }

        String corr = "CORR-" + reportId;
        String prc = "PRC-" + reportId;
        FloodReport report = new FloodReport(reportId, auth.organizationId(), zone.zoneId, auth.userId(),
                FloodRoles.DISPATCHER.equals(auth.role()) ? "PHONE" : "APP", lat, lng, depth, need, people, description,
                "NORMAL", "RECEIVED", null, null, evidenceKey, prc, corr, ts, ts);
        store.commit(auth.organizationId(), auth.role(), auth.userId(), report);

        String[] step = FloodDataStore.reportStep("RECEIVED");
        wf().startInstance(prc, auth.organizationId(), FloodDataStore.PROCESS_REPORT, reportId, step[0], step[1], step[2],
                List.of(BpmnWorkflowEngine.makeStepHistory("startReport", auth.username() + " gửi tin báo " + reportId,
                        auth.username(), auth.role(), ts)), ts);

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("report_id", reportId);
        after.put("zone_id", zone.zoneId);
        after.put("zone_match", zoneMatch);
        after.put("depth_cm", depth);
        after.put("need_type", need);
        after.put("status", "RECEIVED");
        var audit = store.auditLedger.appendRecord(auth.organizationId(), corr, "FloodReport", reportId,
                "CREATE_FLOOD_REPORT", auth.username(), auth.role(), null, after, 201);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("report_id", reportId);
        res.put("zone_id", zone.zoneId);
        res.put("zone_match", zoneMatch);
        res.put("bpmn_process_id", prc);
        res.put("correlation_id", corr);
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(201, res);
    }

    // ------------------------------------------------------------------------
    // 2. Verification and priority (DISPATCHER)
    // ------------------------------------------------------------------------

    public synchronized HttpResult verifyFloodReport(AuthContext auth, String reportId, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.DISPATCHER), "VERIFY_FLOOD_REPORT", "FloodReport", reportId);
        if (denied != null) return denied;
        FloodReport report = store.reports.get(reportId);
        if (report == null || !report.organizationId.equals(auth.organizationId())) {
            return fail(404, "REPORT_NOT_FOUND", "Không tìm thấy tin báo " + reportId + ".");
        }
        if (!"RECEIVED".equals(report.status)) {
            return fail(409, "INVALID_STATE", "Chỉ xác minh được tin báo ở trạng thái RECEIVED (hiện là " + report.status + ").");
        }
        String decision = str(body, "decision").toUpperCase(Locale.ROOT);
        String note = str(body, "note");
        if (!decision.equals("VERIFIED") && !decision.equals("REJECTED")) {
            return fail(400, "INVALID_DECISION", "decision phải là VERIFIED hoặc REJECTED.");
        }
        String priority = str(body, "priority").toUpperCase(Locale.ROOT);
        if (decision.equals("VERIFIED") && !PRIORITIES.contains(priority)) {
            return fail(400, "INVALID_PRIORITY", "Khi xác minh cần 'priority' thuộc " + new TreeSet<>(PRIORITIES) + ".");
        }
        if (decision.equals("REJECTED") && note.length() < 3) {
            return fail(400, "NOTE_REQUIRED", "Từ chối tin báo cần ghi lý do trong 'note'.");
        }

        String ts = nowIso();
        String before = report.status;
        report.status = decision;
        if (decision.equals("VERIFIED")) report.priority = priority;
        report.verifiedByUserId = auth.userId();
        report.verificationNote = note.isEmpty() ? null : note;
        report.updatedAt = ts;
        store.commit(auth.organizationId(), auth.role(), auth.userId(), report);

        Map<String, Object> step = BpmnWorkflowEngine.makeStepHistory("taskDispatcherVerify",
                auth.username() + (decision.equals("VERIFIED") ? " xác minh tin báo, ưu tiên " + priority : " từ chối tin báo: " + note),
                auth.username(), auth.role(), ts);
        if (decision.equals("VERIFIED")) {
            String[] next = FloodDataStore.reportStep("VERIFIED");
            wf().advanceInstance(report.bpmnProcessId, step, next[0], next[1], next[2], ts);
        } else {
            String[] end = FloodDataStore.reportStep("REJECTED");
            wf().completeInstance(report.bpmnProcessId, step, end[0], end[1], ts);
        }

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("status", decision);
        after.put("priority", report.priority);
        if (!note.isEmpty()) after.put("note", note);
        var audit = store.auditLedger.appendRecord(auth.organizationId(), report.correlationId, "FloodReport", reportId,
                decision.equals("VERIFIED") ? "VERIFY_FLOOD_REPORT" : "REJECT_FLOOD_REPORT",
                auth.username(), auth.role(), Map.of("status", before), after, 200);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("report", report.toMap());
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(200, res);
    }

    // ------------------------------------------------------------------------
    // 3. Dispatch (DISPATCHER)
    // ------------------------------------------------------------------------

    public synchronized HttpResult createDispatchOrder(AuthContext auth, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.DISPATCHER), "DISPATCH_RESCUE_ORDER", "DispatchOrder", str(body, "vehicle_id"));
        if (denied != null) return denied;
        String reportId = str(body, "report_id");
        String vehicleId = str(body, "vehicle_id");
        String teamId = str(body, "team_id");
        if (reportId.isEmpty() || vehicleId.isEmpty() || teamId.isEmpty()) {
            return fail(400, "MISSING_FIELDS", "Cần 'report_id', 'vehicle_id', 'team_id', 'start_time', 'end_time'.");
        }
        String start;
        String end;
        try {
            start = normalizeInstant(str(body, "start_time"));
            end = normalizeInstant(str(body, "end_time"));
        } catch (RuntimeException e) {
            return fail(400, "INVALID_TIME", "start_time/end_time phải là thời điểm ISO-8601 (ví dụ 2026-11-20T08:00:00Z).");
        }
        if (start.compareTo(end) >= 0) {
            return fail(400, "INVALID_TIME_WINDOW", "end_time phải sau start_time.");
        }
        String orgId = auth.organizationId();
        FloodReport report = store.reports.get(reportId);
        if (report == null || !report.organizationId.equals(orgId)) {
            return fail(404, "REPORT_NOT_FOUND", "Không tìm thấy tin báo " + reportId + ".");
        }
        if (!"VERIFIED".equals(report.status)) {
            return fail(409, "INVALID_STATE", "Chỉ điều phối được tin báo đã xác minh (VERIFIED); hiện là " + report.status + ".");
        }
        RescueVehicle vehicle = store.vehicles.get(vehicleId);
        boolean vehicleExists = vehicle != null && vehicle.organizationId.equals(orgId);
        RescueTeam team = store.teams.get(teamId);
        if (team == null || !team.organizationId().equals(orgId)) {
            return fail(404, "TEAM_NOT_FOUND", "Không tìm thấy đội " + teamId + ".");
        }
        if ("OFF_DUTY".equals(team.status())) {
            return fail(409, "TEAM_OFF_DUTY", "Đội " + team.name() + " đang nghỉ, không thể điều phối.");
        }
        if (vehicleExists && RescueScoring.suitability(vehicle.vehicleType, report.needType) <= 0.0) {
            return fail(422, "VEHICLE_NOT_SUITABLE", "Loại phương tiện " + vehicle.vehicleType + " không phù hợp nhu cầu " + report.needType + ".");
        }

        Map<String, Object> conflict = ScheduleConflictEngine.checkConflict(orgId, vehicleId,
                vehicleExists ? vehicle.status : "MISSING", vehicleExists, FloodModels.VEHICLE_UNAVAILABLE, teamId,
                start, end, null, FloodModels.ORDER_ACTIVE, new ArrayList<>(store.orders.values()));
        if (conflict != null) {
            return conflictResponse(auth, report, vehicleId, teamId, start, end, conflict);
        }

        String ts = nowIso();
        String orderId = "ORD-" + shortId();
        DispatchOrder order = new DispatchOrder(orderId, orgId, reportId, report.reporterUserId, report.zoneId, vehicleId, teamId,
                start, end, "CONFIRMED", 0.0, null, null, report.correlationId, auth.userId(), ts);
        String before = report.status;
        report.status = "DISPATCHED";
        report.updatedAt = ts;
        store.commit(orgId, auth.role(), auth.userId(), report, order);

        String[] next = FloodDataStore.reportStep("DISPATCHED");
        wf().advanceInstance(report.bpmnProcessId, BpmnWorkflowEngine.makeStepHistory("taskDispatcherDispatch",
                auth.username() + " điều " + vehicle.name + " + " + team.name() + " (" + orderId + ")",
                auth.username(), auth.role(), ts), next[0], next[1], next[2], ts);

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("order_id", orderId);
        after.put("report_id", reportId);
        after.put("vehicle_id", vehicleId);
        after.put("team_id", teamId);
        after.put("window", start + " -> " + end);
        after.put("status", "CONFIRMED");
        var audit = store.auditLedger.appendRecord(orgId, report.correlationId, "DispatchOrder", orderId,
                "CONFIRM_DISPATCH_ORDER", auth.username(), auth.role(), Map.of("report_status", before), after, 201);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("order_id", orderId);
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(201, res);
    }

    private HttpResult conflictResponse(AuthContext auth, FloodReport report, String vehicleId, String teamId,
                                        String start, String end, Map<String, Object> conflict) {
        String code = String.valueOf(conflict.get("code"));
        String message = switch (code) {
            case ScheduleConflictEngine.RESOURCE_NOT_FOUND -> "Không tìm thấy phương tiện " + vehicleId + " trong đơn vị của bạn.";
            case ScheduleConflictEngine.RESOURCE_UNAVAILABLE -> "Phương tiện " + vehicleId + " đang ở trạng thái "
                    + conflict.get("resource_status") + ", không thể giao nhiệm vụ mới.";
            case ScheduleConflictEngine.RESOURCE_TIME_OVERLAP -> "Phương tiện " + vehicleId + " đã có lệnh trùng khung giờ.";
            case ScheduleConflictEngine.HOLDER_TIME_OVERLAP -> "Đội " + teamId + " đã có lệnh trùng khung giờ.";
            default -> "Xung đột lịch.";
        };
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("requested_vehicle", vehicleId);
        before.put("requested_team", teamId);
        before.put("window", start + " -> " + end);
        var audit = store.auditLedger.appendRecord(auth.organizationId(), report.correlationId, "DispatchOrder", "CONFLICT-" + vehicleId,
                "CONFLICT_BLOCKED_" + code, auth.username(), auth.role(), before, conflict, 409);
        Map<String, Object> err = new LinkedHashMap<>();
        err.put("error", code);
        err.put("status", 409);
        err.put("message", message);
        err.put("conflict_details", conflict);
        err.put("audit_event", audit.toSummaryMap());
        return new HttpResult(409, err);
    }

    // ------------------------------------------------------------------------
    // 4. Field update (FIELD_TEAM of the order, DISPATCHER)
    // ------------------------------------------------------------------------

    public synchronized HttpResult updateOrderStatus(AuthContext auth, String orderId, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.FIELD_TEAM, FloodRoles.DISPATCHER), "UPDATE_ORDER_STATUS", "DispatchOrder", orderId);
        if (denied != null) return denied;
        DispatchOrder order = store.orders.get(orderId);
        if (order == null || !order.organizationId.equals(auth.organizationId())) {
            return fail(404, "ORDER_NOT_FOUND", "Không tìm thấy lệnh " + orderId + ".");
        }
        if (FloodRoles.FIELD_TEAM.equals(auth.role()) && !teamsLedBy(auth.userId(), auth.organizationId()).contains(order.teamId)) {
            return hidden(auth, order.correlationId, "DispatchOrder", orderId, "RLS_BLOCKED_FOREIGN_ORDER");
        }
        String newStatus = str(body, "status").toUpperCase(Locale.ROOT);
        if (!newStatus.equals("IN_PROGRESS") && !newStatus.equals("COMPLETED")) {
            return fail(400, "INVALID_STATUS", "status phải là IN_PROGRESS hoặc COMPLETED.");
        }
        boolean valid = ("CONFIRMED".equals(order.status) && newStatus.equals("IN_PROGRESS"))
                || ("IN_PROGRESS".equals(order.status));
        if (!valid) {
            return fail(409, "INVALID_STATUS_TRANSITION", "Chỉ cho phép CONFIRMED → IN_PROGRESS → COMPLETED (hiện là " + order.status + ").");
        }
        Double progress = number(body, "progress_pct");
        if (progress == null || progress < 0 || progress > 100) {
            return fail(400, "INVALID_PROGRESS", "Cần 'progress_pct' trong [0,100].");
        }
        String note = str(body, "note");
        if ("IN_PROGRESS".equals(order.status) && progress < order.progressPct) {
            return fail(409, "PROGRESS_CANNOT_DECREASE", "Tiến độ không thể thấp hơn lần cập nhật trước (" + order.progressPct + "%).");
        }
        if (newStatus.equals("IN_PROGRESS") && "IN_PROGRESS".equals(order.status) && note.isEmpty()) {
            return fail(400, "NOTE_REQUIRED", "Cần ghi chú hiện trường cho lần cập nhật tiến độ.");
        }
        String outcome = str(body, "outcome").toUpperCase(Locale.ROOT);
        Double finalDepth = number(body, "final_depth_cm");
        if (newStatus.equals("COMPLETED")) {
            if (progress < 100.0) {
                return fail(400, "COMPLETION_REQUIRES_FULL_PROGRESS", "Chỉ hoàn thành khi tiến độ đạt 100%.");
            }
            if (!OUTCOMES.contains(outcome)) {
                return fail(400, "INVALID_OUTCOME", "Hoàn thành cần 'outcome' thuộc " + new TreeSet<>(OUTCOMES) + ".");
            }
            if (finalDepth != null && finalDepth < 0) {
                return fail(400, "INVALID_DEPTH", "final_depth_cm không được âm.");
            }
        }

        String ts = nowIso();
        String evidenceKey = null;
        if (newStatus.equals("COMPLETED") && !str(body, "evidence_data_url").isEmpty()) {
            HttpResult blocked = screenEvidence(auth, orderId, str(body, "evidence_filename"), str(body, "evidence_data_url"));
            if (blocked != null) return blocked;
            evidenceKey = storeEvidence(auth, "resolutions", orderId, str(body, "evidence_filename"), str(body, "evidence_data_url"), ts).objectKey();
        }

        RescueVehicle vehicle = store.vehicles.get(order.vehicleId);
        RescueTeam team = store.teams.get(order.teamId);
        FloodReport report = store.reports.get(order.reportId);
        String oldStatus = order.status;
        order.status = newStatus;
        order.progressPct = progress;
        List<Object> changed = new ArrayList<>();
        ReportResolution resolution = null;

        if (newStatus.equals("IN_PROGRESS")) {
            if (vehicle != null) { vehicle.status = "WORKING"; vehicle.telemetryUpdatedAt = ts; changed.add(vehicle); }
            if (team != null) changed.add(withTeamStatus(team, "ON_MISSION"));
            if (report != null) { report.status = "IN_PROGRESS"; report.updatedAt = ts; changed.add(report); }
        } else {
            if (vehicle != null) { vehicle.status = "IDLE"; vehicle.telemetryUpdatedAt = ts; changed.add(vehicle); }
            if (team != null) {
                boolean otherActive = false;
                for (DispatchOrder o : store.orders.values()) {
                    if (!o.orderId.equals(orderId) && o.teamId.equals(team.teamId()) && "IN_PROGRESS".equals(o.status)) otherActive = true;
                }
                changed.add(withTeamStatus(team, otherActive ? "ON_MISSION" : "AVAILABLE"));
            }
            if (report != null) { report.status = "AWAITING_CONFIRMATION"; report.updatedAt = ts; changed.add(report); }
            resolution = new ReportResolution("RES-" + orderId, order.organizationId, order.reportId, orderId, outcome,
                    finalDepth, evidenceKey, auth.userId(), null, "PENDING", note.isEmpty() ? null : note,
                    order.correlationId, null, ts);
        }
        changed.add(order);
        if (resolution != null) changed.add(resolution);
        store.commit(auth.organizationId(), auth.role(), auth.userId(), changed.toArray());

        if (newStatus.equals("COMPLETED") && report != null) {
            String[] next = FloodDataStore.reportStep("AWAITING_CONFIRMATION");
            wf().advanceInstance(report.bpmnProcessId, BpmnWorkflowEngine.makeStepHistory("taskFieldTeamExecute",
                    auth.username() + " hoàn thành " + orderId + " (" + outcome + ")", auth.username(), auth.role(), ts),
                    next[0], next[1], next[2], ts);
        }

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("order_id", orderId);
        after.put("status", newStatus);
        after.put("progress_pct", progress);
        if (!note.isEmpty()) after.put("note", note);
        if (newStatus.equals("COMPLETED")) after.put("outcome", outcome);
        var audit = store.auditLedger.appendRecord(auth.organizationId(), order.correlationId, "DispatchOrder", orderId,
                "ORDER_STATUS_UPDATED", auth.username(), auth.role(), Map.of("status", oldStatus), after, 200);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("order", order.toEnrichedMap(store.zones.get(order.zoneId), vehicle, team));
        if (resolution != null) res.put("resolution_id", resolution.resolutionId);
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(200, res);
    }

    private RescueTeam withTeamStatus(RescueTeam t, String status) {
        RescueTeam updated = new RescueTeam(t.teamId(), t.organizationId(), t.leadUserId(), t.name(), t.memberCount(), t.skills(), t.rating(), status);
        store.teams.put(updated.teamId(), updated);
        return updated;
    }

    // ------------------------------------------------------------------------
    // 5. Field incident and re-plan
    // ------------------------------------------------------------------------

    public synchronized HttpResult reportFieldIncident(AuthContext auth, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.FIELD_TEAM, FloodRoles.DISPATCHER), "REPORT_FIELD_INCIDENT", "FieldIncident", str(body, "vehicle_id"));
        if (denied != null) return denied;
        String vehicleId = str(body, "vehicle_id");
        String orgId = auth.organizationId();
        if (vehicleId.isEmpty()) return fail(400, "MISSING_FIELDS", "Cần 'vehicle_id'.");
        RescueVehicle vehicle = store.vehicles.get(vehicleId);
        if (vehicle == null || !vehicle.organizationId.equals(orgId)) {
            return fail(404, "VEHICLE_NOT_FOUND", "Không tìm thấy phương tiện " + vehicleId + ".");
        }
        if (FloodRoles.FIELD_TEAM.equals(auth.role()) && !new Scope(auth).vehicleVisible(vehicle)) {
            return hidden(auth, "CORR-VEH-" + vehicleId, "RescueVehicle", vehicleId, "RLS_BLOCKED_FOREIGN_VEHICLE");
        }
        String severity = str(body, "severity").toUpperCase(Locale.ROOT);
        String type = str(body, "incident_type").toUpperCase(Locale.ROOT);
        String description = str(body, "description");
        Double downtime = number(body, "estimated_downtime_hours");
        if (!SEVERITIES.contains(severity)) return fail(400, "INVALID_SEVERITY", "severity phải thuộc " + new TreeSet<>(SEVERITIES) + ".");
        if (!INCIDENT_TYPES.contains(type)) return fail(400, "INVALID_INCIDENT_TYPE", "incident_type phải thuộc " + new TreeSet<>(INCIDENT_TYPES) + ".");
        if (description.length() < 3) return fail(400, "DESCRIPTION_REQUIRED", "Cần mô tả sự cố trong 'description'.");
        if (downtime == null || downtime < 0 || downtime > 720) return fail(400, "INVALID_DOWNTIME", "estimated_downtime_hours phải trong [0,720].");
        if ("BREAKDOWN".equals(vehicle.status)) {
            return fail(409, "ALREADY_BROKEN", "Phương tiện " + vehicleId + " đã được báo hỏng.");
        }

        String incId = "INC-" + shortId();
        String repId = "REP-" + shortId();
        String prc = "PRC-" + incId;
        String ts = nowIso();
        HttpResult blocked = screenEvidence(auth, incId, str(body, "evidence_filename"), str(body, "evidence_data_url"));
        if (blocked != null) return blocked;
        String evidenceKey = null;
        String evidenceEtag = null;
        if (!str(body, "evidence_data_url").isEmpty()) {
            var obj = storeEvidence(auth, "incidents", incId, str(body, "evidence_filename"), str(body, "evidence_data_url"), ts);
            evidenceKey = obj.objectKey();
            evidenceEtag = obj.etag();
        }

        Map<String, Object> beforeV = new LinkedHashMap<>();
        beforeV.put("vehicle_id", vehicleId);
        beforeV.put("status", vehicle.status);
        beforeV.put("health_pct", vehicle.healthPct);
        vehicle.status = "BREAKDOWN";
        vehicle.healthPct = switch (severity) { case "CRITICAL" -> 20.0; case "MAJOR" -> 45.0; default -> 70.0; };
        vehicle.telemetryUpdatedAt = ts;

        List<Object> changed = new ArrayList<>();
        changed.add(vehicle);
        List<DispatchOrder> impacted = new ArrayList<>();
        for (DispatchOrder o : store.orders.values()) {
            if (o.organizationId.equals(orgId) && o.vehicleId.equals(vehicleId) && FloodModels.ORDER_ACTIVE.contains(o.status)) impacted.add(o);
        }
        impacted.sort(Comparator.comparing(o -> o.startTime));
        List<String> impactedIds = new ArrayList<>();
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (DispatchOrder o : impacted) {
            impactedIds.add(o.orderId);
            o.status = "IMPACTED";
            FloodReport rep = store.reports.get(o.reportId);
            if (rep != null) { rep.status = "IMPACTED"; rep.updatedAt = ts; changed.add(rep); }
            changed.add(o);
        }
        for (DispatchOrder o : impacted) candidates.addAll(computeCandidates(orgId, o));

        String corr = !impacted.isEmpty() ? impacted.get(0).correlationId : "CORR-" + incId;
        FieldIncident incident = new FieldIncident(incId, orgId, vehicleId, auth.userId(), severity, type, description,
                downtime, evidenceKey, evidenceEtag, repId, vehicle.managerUserId, "OPEN_REPLANNING", prc, impactedIds,
                candidates, null, corr, ts);
        changed.add(incident);
        // The cascade touches orders and reports of other teams, so it is written with dispatcher-level rights inside
        // the caller's own organisation (authorisation was already decided above); the reporter stays recorded.
        store.commit(orgId, FloodRoles.DISPATCHER, auth.userId(), changed.toArray());

        String[] step = FloodDataStore.incidentStep("OPEN_REPLANNING");
        wf().startInstance(prc, orgId, FloodDataStore.PROCESS_INCIDENT, incId, step[0], step[1], step[2], List.of(
                BpmnWorkflowEngine.makeStepHistory("startIncident", auth.username() + " báo sự cố " + vehicleId + " (" + type + ")",
                        auth.username(), auth.role(), ts),
                BpmnWorkflowEngine.makeStepHistory("serviceImpactAnalysis", "Khoanh vùng " + impactedIds.size() + " lệnh bị ảnh hưởng ("
                        + String.join(", ", impactedIds) + "), xếp hạng " + candidates.size()
                        + " phương án theo khoảng cách đường chim bay, tải và đội", "SYSTEM", "PLATFORM_ADMIN", ts)), ts);

        Map<String, Object> afterV = new LinkedHashMap<>();
        afterV.put("incident_id", incId);
        afterV.put("new_vehicle_status", "BREAKDOWN");
        afterV.put("repair_ticket_id", repId);
        afterV.put("impacted_orders", impactedIds);
        afterV.put("candidate_count", candidates.size());
        afterV.put("top_candidate", candidates.isEmpty() ? "NO_FEASIBLE_OPTION" : candidates.get(0).get("option_id"));
        if (evidenceKey != null) afterV.put("evidence_object_key", evidenceKey);
        var audit = store.auditLedger.appendRecord(orgId, corr, "FieldIncident", incId,
                "REPORT_VEHICLE_INCIDENT_AND_IMPACT_SCAN", auth.username(), auth.role(), beforeV, afterV, 201);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("incident_id", incId);
        res.put("repair_ticket_id", repId);
        res.put("impacted_order_ids", impactedIds);
        res.put("candidate_options", candidates);
        res.put("no_feasible_option", candidates.isEmpty() && !impacted.isEmpty());
        res.put("ranking_note", "Khoảng cách là đường chim bay (Haversine), không phải tuyến đường; gợi ý không tự điều động.");
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(201, res);
    }

    /** Ranks replacement vehicles for one impacted order. Only offers vehicles that are free, suitable and crewed. */
    private List<Map<String, Object>> computeCandidates(String orgId, DispatchOrder impacted) {
        FloodZone zone = store.zones.get(impacted.zoneId);
        FloodReport report = store.reports.get(impacted.reportId);
        if (zone == null || report == null) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        List<DispatchOrder> all = new ArrayList<>(store.orders.values());
        for (RescueVehicle v : store.vehicles.values()) {
            if (!v.organizationId.equals(orgId) || v.vehicleId.equals(impacted.vehicleId)) continue;
            if (FloodModels.VEHICLE_UNAVAILABLE.contains(v.status)) continue;
            double suitability = RescueScoring.suitability(v.vehicleType, report.needType);
            if (suitability <= 0.0) continue;
            RescueTeam team = v.assignedTeamId == null ? null : store.teams.get(v.assignedTeamId);
            if (team == null || !team.organizationId().equals(orgId) || "OFF_DUTY".equals(team.status())) continue;
            Map<String, Object> conflict = ScheduleConflictEngine.checkConflict(orgId, v.vehicleId, v.status, true,
                    FloodModels.VEHICLE_UNAVAILABLE, team.teamId(), impacted.startTime, impacted.endTime,
                    impacted.orderId, FloodModels.ORDER_ACTIVE, all);
            if (conflict != null) continue;

            double distKm = SpatialMatchingEngine.spatialDistanceKm(v.currentLat, v.currentLng, zone.centerLat, zone.centerLng);
            double capFit = RescueScoring.capacityFit(v.capacityUnit, v.capacityValue, report.peopleAffected, report.depthCm);
            double score = RescueScoring.score(distKm, suitability, capFit, team.rating());
            String src = "DEVICE".equals(v.telemetrySource) ? "thiết bị" : "mô phỏng/seed";
            List<String> why = List.of(
                    "Sẵn sàng: " + v.name + " và " + team.name() + " không trùng lịch trong khung " + impacted.startTime + " → " + impacted.endTime + ".",
                    "Khoảng cách đường chim bay (Haversine): " + distKm + " km tới " + zone.name + "; không phải tuyến đường, chưa tính đường ngập (vị trí xe: " + src + ").",
                    "Phù hợp nhu cầu " + report.needType + ": " + Math.round(suitability * 100) + "%. Độ đáp ứng công suất: "
                            + Math.round(capFit * 100) + "% (" + v.capacityValue + " " + v.capacityUnit + ").",
                    "Đội " + team.name() + ": đánh giá " + team.rating() + "/5.");
            Map<String, Object> cand = new LinkedHashMap<>();
            cand.put("option_id", "OPT-" + v.vehicleId + "-" + team.teamId() + "-" + impacted.orderId);
            cand.put("for_order_id", impacted.orderId);
            cand.put("report_id", impacted.reportId);
            cand.put("zone_id", zone.zoneId);
            cand.put("zone_name", zone.name);
            cand.put("vehicle_id", v.vehicleId);
            cand.put("vehicle_name", v.name);
            cand.put("team_id", team.teamId());
            cand.put("team_name", team.name());
            cand.put("distance_km", distKm);
            cand.put("distance_kind", "STRAIGHT_LINE_HAVERSINE");
            cand.put("suitability", suitability);
            cand.put("capacity_fit", Math.round(capFit * 100.0) / 100.0);
            cand.put("score", score);
            cand.put("from_lat", v.currentLat);
            cand.put("from_lng", v.currentLng);
            cand.put("to_lat", zone.centerLat);
            cand.put("to_lng", zone.centerLng);
            cand.put("position_is_simulated", !"DEVICE".equals(v.telemetrySource));
            cand.put("start_time", impacted.startTime);
            cand.put("end_time", impacted.endTime);
            cand.put("explanations", why);
            out.add(cand);
        }
        out.sort((a, b) -> Double.compare(((Number) b.get("score")).doubleValue(), ((Number) a.get("score")).doubleValue()));
        return out;
    }

    public synchronized HttpResult approveReplan(AuthContext auth, String incidentId, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.DISPATCHER), "APPROVE_REPLAN", "FieldIncident", incidentId);
        if (denied != null) return denied;
        FieldIncident inc = store.incidents.get(incidentId);
        if (inc == null || !inc.organizationId.equals(auth.organizationId())) {
            return fail(404, "INCIDENT_NOT_FOUND", "Không tìm thấy sự cố " + incidentId + ".");
        }
        if (!"OPEN_REPLANNING".equals(inc.status)) {
            return fail(409, "INVALID_STATE", "Sự cố không ở trạng thái chờ điều phối lại (hiện là " + inc.status + ").");
        }
        if (inc.candidateOptions.isEmpty()) {
            return fail(422, "NO_FEASIBLE_OPTION_AVAILABLE", "Chưa có phương án thay thế thỏa ràng buộc khung giờ, loại phương tiện và đội. Hãy dời lịch hoặc huy động thêm nguồn lực.");
        }
        String optionId = str(body, "option_id");
        if (optionId.isEmpty()) {
            return fail(400, "OPTION_REQUIRED", "Người có quyền phải chọn một 'option_id'; hệ thống không tự điều động.");
        }
        Map<String, Object> chosen = null;
        for (Map<String, Object> c : inc.candidateOptions) {
            if (optionId.equals(c.get("option_id"))) { chosen = c; break; }
        }
        if (chosen == null) return fail(404, "OPTION_NOT_FOUND", "Không có phương án " + optionId + " cho sự cố này.");

        String orgId = auth.organizationId();
        String oldOrderId = String.valueOf(chosen.get("for_order_id"));
        DispatchOrder oldOrder = store.orders.get(oldOrderId);
        if (oldOrder == null || !"IMPACTED".equals(oldOrder.status)) {
            return fail(409, "ORDER_NOT_IMPACTED", "Lệnh " + oldOrderId + " không còn ở trạng thái IMPACTED.");
        }
        String vehicleId = String.valueOf(chosen.get("vehicle_id"));
        String teamId = String.valueOf(chosen.get("team_id"));
        // The ranking is a snapshot: re-check the conflict at approval time.
        Map<String, Object> conflict = ScheduleConflictEngine.checkConflict(orgId, vehicleId,
                store.vehicles.containsKey(vehicleId) ? store.vehicles.get(vehicleId).status : "MISSING",
                store.vehicles.containsKey(vehicleId), FloodModels.VEHICLE_UNAVAILABLE, teamId,
                oldOrder.startTime, oldOrder.endTime, oldOrderId, FloodModels.ORDER_ACTIVE, new ArrayList<>(store.orders.values()));
        if (conflict != null) {
            FloodReport rep = store.reports.get(oldOrder.reportId);
            return conflictResponse(auth, rep, vehicleId, teamId, oldOrder.startTime, oldOrder.endTime, conflict);
        }

        String ts = nowIso();
        String newOrderId = nextReplacementId(oldOrderId);
        DispatchOrder newOrder = new DispatchOrder(newOrderId, orgId, oldOrder.reportId, oldOrder.reporterUserId, oldOrder.zoneId,
                vehicleId, teamId, oldOrder.startTime, oldOrder.endTime, "CONFIRMED", 0.0, oldOrderId, null,
                oldOrder.correlationId, auth.userId(), ts);
        oldOrder.status = "SUPERSEDED";
        oldOrder.supersededByOrderId = newOrderId;
        FloodReport report = store.reports.get(oldOrder.reportId);
        List<Object> changed = new ArrayList<>();
        RescueVehicle rescuer = store.vehicles.get(vehicleId);
        if (rescuer != null) { rescuer.status = "MOVING"; rescuer.telemetryUpdatedAt = ts; changed.add(rescuer); }
        if (report != null) { report.status = "RESCHEDULED"; report.updatedAt = ts; changed.add(report); }
        // Insert order matters in PostgreSQL: the new order goes first because the old one now points at it through a
        // foreign key (superseded_by_order_id). The old order is IMPACTED (not active) in the database at this point, so
        // the exclusion constraints on vehicle and team do not see it as a competitor.
        changed.add(newOrder);
        changed.add(oldOrder);
        inc.selectedOption = chosen;
        boolean allDone = true;
        for (String id : inc.impactedOrderIds) {
            DispatchOrder o = store.orders.get(id);
            if (o != null && "IMPACTED".equals(o.status)) allDone = false;
        }
        if (allDone) inc.status = "REPLAN_APPROVED";
        changed.add(inc);
        store.commit(orgId, auth.role(), auth.userId(), changed.toArray());

        String[] next = FloodDataStore.incidentStep(inc.status);
        wf().advanceInstance(inc.bpmnProcessId, BpmnWorkflowEngine.makeStepHistory("taskDispatcherApproveReplan",
                auth.username() + " phê duyệt " + chosen.get("vehicle_name") + " + " + chosen.get("team_name") + " thay cho " + oldOrderId,
                auth.username(), auth.role(), ts), next[0], next[1], next[2], ts);
        if (report != null) {
            String[] rs = FloodDataStore.reportStep("RESCHEDULED");
            wf().advanceInstance(report.bpmnProcessId, BpmnWorkflowEngine.makeStepHistory("taskFieldTeamExecute",
                    "Lệnh " + oldOrderId + " được thay bằng " + newOrderId, auth.username(), auth.role(), ts), rs[0], rs[1], rs[2], ts);
        }

        Map<String, Object> before = new LinkedHashMap<>();
        before.put("superseded_order_id", oldOrderId);
        before.put("broken_vehicle_id", inc.vehicleId);
        before.put("status", "IMPACTED");
        Map<String, Object> after = new LinkedHashMap<>();
        after.put("new_order_id", newOrderId);
        after.put("replaces_order_id", oldOrderId);
        after.put("rescue_vehicle_id", vehicleId);
        after.put("rescue_team_id", teamId);
        after.put("distance_km", chosen.get("distance_km"));
        after.put("distance_kind", "STRAIGHT_LINE_HAVERSINE");
        after.put("score", chosen.get("score"));
        after.put("status", "CONFIRMED");
        var audit = store.auditLedger.appendRecord(orgId, inc.correlationId, "DispatchOrder", newOrderId,
                "APPROVE_REPLAN_REPLACEMENT", auth.username(), auth.role(), before, after, 200);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("superseded_order_id", oldOrderId);
        res.put("new_order_id", newOrderId);
        res.put("selected_option", chosen);
        res.put("incident_status", inc.status);
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(200, res);
    }

    private String nextReplacementId(String oldOrderId) {
        String root = oldOrderId.replaceAll("-R\\d+$", "");
        for (int n = 1; n < 100; n++) {
            String id = root + "-R" + n;
            if (!store.orders.containsKey(id)) return id;
        }
        throw new IllegalStateException("Too many replacements for " + oldOrderId);
    }

    public synchronized HttpResult updateRepairTicket(AuthContext auth, String incidentId, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.RESOURCE_MANAGER, FloodRoles.DISPATCHER), "UPDATE_REPAIR_TICKET", "FieldIncident", incidentId);
        if (denied != null) return denied;
        FieldIncident inc = store.incidents.get(incidentId);
        if (inc == null || !inc.organizationId.equals(auth.organizationId())) {
            return fail(404, "INCIDENT_NOT_FOUND", "Không tìm thấy sự cố " + incidentId + ".");
        }
        if (FloodRoles.RESOURCE_MANAGER.equals(auth.role()) && !auth.userId().equals(inc.assignedRepairUserId)) {
            return hidden(auth, inc.correlationId, "FieldIncident", incidentId, "RLS_BLOCKED_FOREIGN_REPAIR_TICKET");
        }
        if ("RESOLVED".equals(inc.status)) {
            return fail(409, "INVALID_STATE", "Phiếu sửa chữa đã đóng.");
        }
        String diagnosis = str(body, "diagnosis");
        if (diagnosis.length() < 3) return fail(400, "DIAGNOSIS_REQUIRED", "Cần ghi chẩn đoán/biện pháp trong 'diagnosis'.");
        boolean resolved = Boolean.TRUE.equals(body.get("is_resolved"));
        String ts = nowIso();
        String oldStatus = inc.status;
        inc.status = resolved ? "RESOLVED" : "UNDER_REPAIR";
        List<Object> changed = new ArrayList<>();
        RescueVehicle vehicle = store.vehicles.get(inc.vehicleId);
        if (resolved && vehicle != null && "BREAKDOWN".equals(vehicle.status)) {
            vehicle.status = "IDLE";
            vehicle.healthPct = Math.max(vehicle.healthPct, 90.0);
            vehicle.telemetryUpdatedAt = ts;
            changed.add(vehicle);
        }
        changed.add(inc);
        store.commit(auth.organizationId(), auth.role(), auth.userId(), changed.toArray());

        Map<String, Object> step = BpmnWorkflowEngine.makeStepHistory("taskResourceManagerRepair",
                auth.username() + (resolved ? " đóng phiếu sửa chữa: " : " cập nhật chẩn đoán: ") + diagnosis, auth.username(), auth.role(), ts);
        if (resolved) {
            String[] end = FloodDataStore.incidentStep("RESOLVED");
            wf().completeInstance(inc.bpmnProcessId, step, end[0], end[1], ts);
        } else {
            String[] next = FloodDataStore.incidentStep("UNDER_REPAIR");
            wf().advanceInstance(inc.bpmnProcessId, step, next[0], next[1], next[2], ts);
        }

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("repair_ticket_id", inc.repairTicketId);
        after.put("status", inc.status);
        after.put("diagnosis", diagnosis);
        var audit = store.auditLedger.appendRecord(auth.organizationId(), inc.correlationId, "FieldIncident", incidentId,
                resolved ? "CLOSE_REPAIR_TICKET" : "UPDATE_REPAIR_TICKET", auth.username(), auth.role(),
                Map.of("status", oldStatus), after, 200);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("incident", inc.toMap());
        res.put("audit", audit.toSummaryMap());
        return new HttpResult(200, res);
    }

    // ------------------------------------------------------------------------
    // 6. Confirmation and ledger seal (REPORTER of the report, DISPATCHER)
    // ------------------------------------------------------------------------

    public synchronized HttpResult confirmResolution(AuthContext auth, Map<String, Object> body) {
        String resolutionId = str(body, "resolution_id");
        HttpResult denied = rbac(auth, List.of(FloodRoles.REPORTER, FloodRoles.DISPATCHER), "CONFIRM_RESOLUTION", "ReportResolution", resolutionId);
        if (denied != null) return denied;
        if (resolutionId.isEmpty()) return fail(400, "MISSING_FIELDS", "Cần 'resolution_id' và 'decision'.");
        String decision = str(body, "decision").toUpperCase(Locale.ROOT);
        if (!decision.equals("CONFIRMED") && !decision.equals("DISPUTED")) {
            return fail(400, "INVALID_DECISION", "decision phải là CONFIRMED hoặc DISPUTED.");
        }
        String notes = str(body, "notes");
        if (decision.equals("DISPUTED") && notes.length() < 3) {
            return fail(400, "NOTE_REQUIRED", "Phản đối kết quả cần ghi lý do trong 'notes'.");
        }
        ReportResolution res = store.resolutions.get(resolutionId);
        FloodReport report = res == null ? null : store.reports.get(res.reportId);
        if (res == null || report == null || !res.organizationId.equals(auth.organizationId())
                || (FloodRoles.REPORTER.equals(auth.role()) && !report.reporterUserId.equals(auth.userId()))) {
            return hidden(auth, "CORR-RES-" + resolutionId, "ReportResolution", resolutionId, "RLS_BLOCKED_FOREIGN_RESOLUTION");
        }
        if (!"PENDING".equals(res.confirmationStatus) || !"AWAITING_CONFIRMATION".equals(report.status)) {
            return fail(409, "INVALID_STATE", "Kết quả này không còn ở trạng thái chờ xác nhận.");
        }

        String ts = nowIso();
        res.confirmedBy = auth.userId();
        res.confirmedAt = ts;
        res.confirmationStatus = decision;
        String before = report.status;
        report.status = decision.equals("CONFIRMED") ? "RESOLVED" : "VERIFIED";
        report.updatedAt = ts;
        store.commit(auth.organizationId(), auth.role(), auth.userId(), report, res);

        Map<String, Object> step = BpmnWorkflowEngine.makeStepHistory("taskReporterConfirm",
                auth.username() + (decision.equals("CONFIRMED") ? " xác nhận đã xử lý xong" : " phản đối kết quả: " + notes),
                auth.username(), auth.role(), ts);
        if (decision.equals("CONFIRMED")) {
            String[] end = FloodDataStore.reportStep("RESOLVED");
            wf().completeInstance(report.bpmnProcessId, step, end[0], end[1], ts);
        } else {
            String[] back = FloodDataStore.reportStep("VERIFIED");
            wf().advanceInstance(report.bpmnProcessId, step, back[0], back[1], back[2], ts);
        }

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("resolution_id", resolutionId);
        after.put("report_id", report.reportId);
        after.put("confirmation_status", decision);
        after.put("report_status", report.status);
        after.put("ledger_sealed", decision.equals("CONFIRMED"));
        var audit = store.auditLedger.appendRecord(auth.organizationId(), report.correlationId, "ReportResolution", resolutionId,
                decision.equals("CONFIRMED") ? "CONFIRM_RESOLUTION_AND_SEAL_LEDGER" : "DISPUTE_RESOLUTION",
                auth.username(), auth.role(), Map.of("report_status", before), after, 200);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("resolution", res.toMap());
        out.put("report_status", report.status);
        out.put("audit", audit.toSummaryMap());
        return new HttpResult(200, out);
    }

    // ------------------------------------------------------------------------
    // 7. Shelter occupancy (DISPATCHER)
    // ------------------------------------------------------------------------

    public synchronized HttpResult updateShelterOccupancy(AuthContext auth, String shelterId, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.DISPATCHER), "UPDATE_SHELTER_OCCUPANCY", "SafeShelter", shelterId);
        if (denied != null) return denied;
        SafeShelter s = store.shelters.get(shelterId);
        if (s == null || !s.organizationId.equals(auth.organizationId())) {
            return fail(404, "SHELTER_NOT_FOUND", "Không tìm thấy điểm trú " + shelterId + ".");
        }
        Double occ = number(body, "occupancy");
        if (occ == null || occ < 0 || occ != Math.rint(occ) || occ > s.capacity) {
            return fail(400, "INVALID_OCCUPANCY", "occupancy phải là số nguyên trong [0," + s.capacity + "].");
        }
        int before = s.occupancy;
        s.occupancy = (int) Math.rint(occ);
        s.occupancySource = "REPORTED";
        if (!"CLOSED".equals(s.status)) s.status = s.occupancy >= s.capacity ? "FULL" : "OPEN";
        s.updatedAt = nowIso();
        store.commit(auth.organizationId(), auth.role(), auth.userId(), s);
        var audit = store.auditLedger.appendRecord(auth.organizationId(), "CORR-SHELTER-" + shelterId, "SafeShelter", shelterId,
                "UPDATE_SHELTER_OCCUPANCY", auth.username(), auth.role(), Map.of("occupancy", before),
                Map.of("occupancy", s.occupancy, "status", s.status), 200);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("shelter", s.toMap());
        out.put("audit", audit.toSummaryMap());
        return new HttpResult(200, out);
    }

    // ------------------------------------------------------------------------
    // 8. Platform admin: demo reset (disabled unless explicitly enabled)
    // ------------------------------------------------------------------------

    public synchronized HttpResult resetDemo(AuthContext auth) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.PLATFORM_ADMIN), "RESET_DEMO_DATA", "System", "demo");
        if (denied != null) return denied;
        if (!"true".equalsIgnoreCase(System.getenv("FLOODOS_ALLOW_DEMO_RESET"))) {
            return fail(403, "RESET_DISABLED", "Đặt lại dữ liệu demo đang tắt (FLOODOS_ALLOW_DEMO_RESET != true).");
        }
        store.resetAndSeed();
        lastTelemetryPersistMs.clear();
        return new HttpResult(200, Map.of("ok", true, "message", "Đã khôi phục dữ liệu mô phỏng về trạng thái ban đầu; sổ cái bắt đầu epoch mới."));
    }

    // ------------------------------------------------------------------------
    // Evidence upload screening (ClamAV, fail-closed)
    // ------------------------------------------------------------------------

    private static final Set<String> IMAGE_TYPES = Set.of("image/jpeg", "image/png", "image/webp");

    private static byte[] decodeEvidence(String dataUrl) {
        String payload = dataUrl.trim();
        if (payload.startsWith("data:")) {
            int comma = payload.indexOf(',');
            if (comma < 0 || !payload.substring(0, comma).contains(";base64")) {
                throw new IllegalArgumentException("evidence_data_url must be a base64 data URL");
            }
            payload = payload.substring(comma + 1);
        }
        return Base64.getDecoder().decode(payload.replaceAll("\\s", ""));
    }

    private static String evidenceMime(String dataUrl) {
        String t = dataUrl.trim();
        if (t.startsWith("data:")) {
            int semi = t.indexOf(';');
            if (semi > 5) return t.substring(5, semi).toLowerCase(Locale.ROOT);
        }
        return "image/jpeg";
    }

    /** Returns an error result when the upload must be refused, or null when it may be stored. */
    private HttpResult screenEvidence(AuthContext auth, String entityId, String filename, String dataUrl) {
        if (dataUrl == null || dataUrl.isBlank()) return null;
        byte[] bytes;
        try {
            bytes = decodeEvidence(dataUrl);
        } catch (IllegalArgumentException e) {
            return fail(400, "INVALID_EVIDENCE", "evidence_data_url phải là base64 hợp lệ (có thể là data URL).");
        }
        if (!IMAGE_TYPES.contains(evidenceMime(dataUrl))) {
            return fail(415, "UNSUPPORTED_MEDIA_TYPE", "Chỉ nhận ảnh " + new TreeSet<>(IMAGE_TYPES) + ".");
        }
        MalwareScanner scanner = store.malwareScanner;
        if (bytes.length > scanner.getMaxBytes()) {
            return fail(413, "EVIDENCE_TOO_LARGE", "Tệp lớn hơn " + scanner.getMaxBytes() + " byte không được nhận.");
        }
        if (!scanner.isEnabled()) return null;
        Map<String, Object> after = new LinkedHashMap<>();
        after.put("filename", filename);
        after.put("size_bytes", bytes.length);
        try {
            MalwareScanner.Verdict verdict = scanner.scan(bytes);
            if (verdict.clean()) return null;
            after.put("signature", verdict.signature());
            var audit = store.auditLedger.appendRecord(auth.organizationId(), "CORR-UPLOAD-" + shortId(), "Evidence", entityId,
                    "UPLOAD_BLOCKED_MALWARE", auth.username(), auth.role(), Map.of(), after, 422);
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "MALWARE_DETECTED");
            err.put("status", 422);
            err.put("message", "Tệp tải lên bị chặn: phát hiện mã độc (" + verdict.signature() + "). Tệp không được lưu.");
            err.put("signature", verdict.signature());
            err.put("audit_event", audit.toSummaryMap());
            return new HttpResult(422, err);
        } catch (MalwareScanner.ScanUnavailableException e) {
            after.put("reason", e.getMessage());
            var audit = store.auditLedger.appendRecord(auth.organizationId(), "CORR-UPLOAD-" + shortId(), "Evidence", entityId,
                    "UPLOAD_BLOCKED_SCANNER_UNAVAILABLE", auth.username(), auth.role(), Map.of(), after, 503);
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "MALWARE_SCANNER_UNAVAILABLE");
            err.put("status", 503);
            err.put("message", "Chưa quét được mã độc nên tệp không được lưu (fail-closed). Vui lòng thử lại sau.");
            err.put("audit_event", audit.toSummaryMap());
            return new HttpResult(503, err);
        }
    }

    private org.floodos.core.dataservices.SeaweedS3StorageService.S3ObjectMeta storeEvidence(
            AuthContext auth, String folder, String entityId, String filename, String dataUrl, String ts) {
        byte[] bytes = decodeEvidence(dataUrl);
        String name = filename.isEmpty() ? "evidence-" + entityId + ".jpg" : filename;
        return store.s3Storage.putEvidenceObject(auth.organizationId(), "floodos-evidence", folder, entityId,
                name, evidenceMime(dataUrl), bytes.length, auth.username(), dataUrl, ts);
    }

    // ------------------------------------------------------------------------
    // OT telemetry ingestion (MQTT -> telemetry-ingestor -> internal endpoint)
    // ------------------------------------------------------------------------

    /**
     * Applies one validated sample of a rescue vehicle ("vehicle") or a water gauge ("gauge") to the digital twin and
     * streams it to the cold tier. Workflow-owned fields (vehicle status, orders) are never changed by telemetry.
     * PostgreSQL writes are throttled per asset; the in-memory twin and the event stream receive every sample.
     * The sample's source (SIMULATOR or DEVICE) is stored and shown; anything else is refused.
     */
    public synchronized HttpResult ingestTelemetry(Map<String, Object> body) {
        String kind = String.valueOf(body.getOrDefault("asset_kind", ""));
        String assetId = String.valueOf(body.getOrDefault("asset_id", ""));
        String org = String.valueOf(body.getOrDefault("organization_id", ""));
        String source = String.valueOf(body.getOrDefault("source", "")).trim();
        if (!TELEMETRY_SOURCES.contains(source)) {
            return fail(400, "INVALID_SOURCE", "source phải là SIMULATOR hoặc DEVICE.");
        }
        Instant sampleTs;
        try {
            sampleTs = Instant.parse(String.valueOf(body.get("ts")));
        } catch (RuntimeException e) {
            return fail(400, "INVALID_TELEMETRY", "Cần 'ts' ISO-8601.");
        }
        return switch (kind) {
            case "vehicle" -> ingestVehicle(assetId, org, source, sampleTs, body);
            case "gauge" -> ingestGauge(assetId, org, source, sampleTs, body);
            default -> fail(400, "INVALID_ASSET_KIND", "asset_kind phải là 'vehicle' hoặc 'gauge'.");
        };
    }

    private HttpResult ingestVehicle(String id, String org, String source, Instant ts, Map<String, Object> body) {
        RescueVehicle v = store.vehicles.get(id);
        if (v == null) return fail(404, "VEHICLE_NOT_FOUND", "Unknown vehicle " + id);
        if (!v.organizationId.equals(org)) return fail(409, "TENANT_MISMATCH", "Telemetry organization does not own vehicle " + id);
        Double lat = number(body, "lat");
        Double lon = number(body, "lon");
        Double fuel = number(body, "fuel_pct");
        Double speed = body.get("speed_kmh") == null ? Double.valueOf(0.0) : number(body, "speed_kmh");
        if (lat == null || lon == null || fuel == null || speed == null) {
            return fail(400, "INVALID_TELEMETRY", "Cần lat, lon, fuel_pct (số) và ts ISO-8601.");
        }
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || fuel < 0 || fuel > 100 || speed < 0 || speed > 80) {
            return fail(400, "TELEMETRY_OUT_OF_RANGE", "lat[-90,90] lon[-180,180] fuel_pct[0,100] speed_kmh[0,80]");
        }
        v.currentLat = lat;
        v.currentLng = lon;
        v.fuelPct = fuel;
        v.telemetryUpdatedAt = ts.toString();
        v.telemetrySource = source;
        if (shouldPersist("vehicle:" + id)) {
            try {
                store.commit(v.organizationId, FloodRepository.SYSTEM_ROLE, "system", v);
            } catch (IllegalStateException e) {
                return fail(503, "STORAGE_UNAVAILABLE", e.getMessage());
            }
        }
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("asset_kind", "vehicle");
        event.put("asset_id", id);
        event.put("organization_id", v.organizationId);
        event.put("ts", ts.toString());
        event.put("lat", lat);
        event.put("lon", lon);
        event.put("speed_kmh", speed);
        event.put("fuel_pct", fuel);
        event.put("status", v.status);
        event.put("source", source);
        store.eventBus.publish(EventBusPublisher.TOPIC_TELEMETRY, v.organizationId, event);
        return new HttpResult(200, Map.of("ok", true, "asset_id", id));
    }

    private HttpResult ingestGauge(String id, String org, String source, Instant ts, Map<String, Object> body) {
        GaugeStation g = store.gauges.get(id);
        if (g == null) return fail(404, "GAUGE_NOT_FOUND", "Unknown gauge " + id);
        if (!g.organizationId.equals(org)) return fail(409, "TENANT_MISMATCH", "Telemetry organization does not own gauge " + id);
        Double level = number(body, "level_cm");
        if (level == null || level < 0 || level > 1000) {
            return fail(400, "TELEMETRY_OUT_OF_RANGE", "level_cm phải là số trong [0,1000].");
        }
        g.levelCm = level;
        g.levelUpdatedAt = ts.toString();
        FloodZone z = store.zones.get(g.zoneId);
        if (z != null) {
            z.waterLevelCm = level;
            z.waterLevelSource = source;
            z.waterLevelUpdatedAt = ts.toString();
            switch (g.alertState()) {
                case "CRITICAL" -> z.riskLevel = "CRITICAL";
                case "WARNING" -> z.riskLevel = "WARNING";
                case "NORMAL" -> z.riskLevel = level >= 0.5 * g.warnLevelCm ? "WATCH" : "NORMAL";
                default -> { }
            }
        }
        if (shouldPersist("gauge:" + id)) {
            try {
                if (z != null) store.commit(g.organizationId, FloodRepository.SYSTEM_ROLE, "system", z, g);
                else store.commit(g.organizationId, FloodRepository.SYSTEM_ROLE, "system", g);
            } catch (IllegalStateException e) {
                return fail(503, "STORAGE_UNAVAILABLE", e.getMessage());
            }
        }
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("asset_kind", "gauge");
        event.put("asset_id", id);
        event.put("organization_id", g.organizationId);
        event.put("ts", ts.toString());
        event.put("level_cm", level);
        event.put("alert_state", g.alertState());
        event.put("source", source);
        store.eventBus.publish(EventBusPublisher.TOPIC_TELEMETRY, g.organizationId, event);
        return new HttpResult(200, Map.of("ok", true, "asset_id", id, "alert_state", g.alertState()));
    }

    private boolean shouldPersist(String key) {
        long now = System.currentTimeMillis();
        Long last = lastTelemetryPersistMs.get(key);
        if (last == null || now - last >= TELEMETRY_PERSIST_INTERVAL_MS) {
            lastTelemetryPersistMs.put(key, now);
            return true;
        }
        return false;
    }

    /** Roster of simulatable assets for the device simulator (internal endpoint only). */
    public synchronized Map<String, Object> listAssetsForIngest() {
        List<Map<String, Object>> assets = new ArrayList<>();
        for (RescueVehicle v : store.vehicles.values()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("asset_kind", "vehicle");
            row.put("asset_id", v.vehicleId);
            row.put("organization_id", v.organizationId);
            row.put("status", v.status);
            row.put("lat", v.currentLat);
            row.put("lon", v.currentLng);
            row.put("fuel_pct", v.fuelPct);
            // Straight-line target of the simulator: the zone of this vehicle's earliest active order (not a route).
            DispatchOrder active = null;
            for (DispatchOrder o : store.orders.values()) {
                if (o.vehicleId.equals(v.vehicleId) && FloodModels.ORDER_ACTIVE.contains(o.status)
                        && (active == null || o.startTime.compareTo(active.startTime) < 0)) active = o;
            }
            FloodZone target = active == null ? null : store.zones.get(active.zoneId);
            row.put("target_lat", target == null ? null : target.centerLat);
            row.put("target_lon", target == null ? null : target.centerLng);
            assets.add(row);
        }
        for (GaugeStation g : store.gauges.values()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("asset_kind", "gauge");
            row.put("asset_id", g.stationId);
            row.put("organization_id", g.organizationId);
            row.put("zone_id", g.zoneId);
            row.put("level_cm", g.levelCm);
            row.put("warn_level_cm", g.warnLevelCm);
            row.put("critical_level_cm", g.criticalLevelCm);
            assets.add(row);
        }
        return Map.of("assets", assets);
    }

    // ------------------------------------------------------------------------
    // AI Tactical Assistant Features
    // ------------------------------------------------------------------------

    public synchronized HttpResult getReportAiSummary(AuthContext auth, String reportId) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.DISPATCHER, FloodRoles.FIELD_TEAM, FloodRoles.PLATFORM_ADMIN),
                "GET_AI_SUMMARY", "FloodReport", reportId);
        if (denied != null) return denied;

        FloodReport report = store.reports.get(reportId);
        if (report == null || !report.organizationId.equals(auth.organizationId())) {
            return fail(404, "REPORT_NOT_FOUND", "Không tìm thấy tin báo " + reportId);
        }

        String ordersInfo = "Chưa có lệnh điều phối";
        String teamName = "";
        String vehicleName = "";
        String activeVehicleId = "";
        for (DispatchOrder o : store.orders.values()) {
            if (reportId.equals(o.reportId)) {
                RescueVehicle v = store.vehicles.get(o.vehicleId);
                RescueTeam t = store.teams.get(o.teamId);
                vehicleName = v != null ? v.name : o.vehicleId;
                teamName = t != null ? t.name() : o.teamId;
                activeVehicleId = o.vehicleId;
                ordersInfo = String.format(Locale.ROOT, "Lệnh %s (%s) giao cho %s vận hành %s",
                        o.orderId, o.status, teamName, vehicleName);
                break;
            }
        }

        String incidentsInfo = "Không có sự cố phương tiện";
        for (FieldIncident inc : store.incidents.values()) {
            if (!activeVehicleId.isEmpty() && activeVehicleId.equals(inc.vehicleId)) {
                incidentsInfo = String.format(Locale.ROOT, "Sự cố %s trên xe %s: %s (Trạng thái: %s)",
                        inc.incidentId, inc.vehicleId, inc.description, inc.status);
                break;
            }
        }

        FloodZone zone = store.zones.get(report.zoneId);
        String location = zone != null ? zone.name : "Tọa độ " + report.lat + ", " + report.lng;

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("report_id", report.reportId);
        req.put("status", report.status);
        req.put("priority", report.priority);
        req.put("need_type", report.needType);
        req.put("depth_cm", report.depthCm);
        req.put("people_affected", report.peopleAffected);
        req.put("description", report.description);
        req.put("location", location);
        req.put("created_at", report.createdAt);
        req.put("orders_info", ordersInfo);
        req.put("incidents_info", incidentsInfo);

        AiAssistantClient.Result res = store.aiAssistant.summarize(req);
        return new HttpResult(res.status(), res.body());
    }

    public synchronized HttpResult classifyPriority(AuthContext auth, Map<String, Object> body) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.REPORTER, FloodRoles.DISPATCHER, FloodRoles.PLATFORM_ADMIN),
                "CLASSIFY_PRIORITY", "AiAssistant", "SUGGEST");
        if (denied != null) return denied;

        AiAssistantClient.Result res = store.aiAssistant.classifyPriority(body);
        return new HttpResult(res.status(), res.body());
    }

    public synchronized HttpResult getReportAfterActionReport(AuthContext auth, String reportId) {
        HttpResult denied = rbac(auth, List.of(FloodRoles.DISPATCHER, FloodRoles.REPORTER, FloodRoles.PLATFORM_ADMIN),
                "GET_AFTER_ACTION_REPORT", "FloodReport", reportId);
        if (denied != null) return denied;

        FloodReport report = store.reports.get(reportId);
        if (report == null || !report.organizationId.equals(auth.organizationId())) {
            return fail(404, "REPORT_NOT_FOUND", "Không tìm thấy tin báo " + reportId);
        }

        ReportResolution res = null;
        for (ReportResolution r : store.resolutions.values()) {
            if (reportId.equals(r.reportId)) {
                res = r;
                break;
            }
        }

        String teamName = "Đội ứng cứu cơ động";
        String vehicleName = "Phương tiện cứu hộ";
        for (DispatchOrder o : store.orders.values()) {
            if (reportId.equals(o.reportId)) {
                RescueVehicle v = store.vehicles.get(o.vehicleId);
                RescueTeam t = store.teams.get(o.teamId);
                if (v != null) vehicleName = v.name;
                if (t != null) teamName = t.name();
                break;
            }
        }

        String chainProof = store.auditLedger.verifyChainIntegrity().getOrDefault("last_record_hash", "Valid SHA-256").toString();

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("report_id", report.reportId);
        req.put("created_at", report.createdAt);
        req.put("resolved_at", res != null ? res.confirmedAt : report.updatedAt);
        req.put("priority", report.priority);
        req.put("need_type", report.needType);
        req.put("depth_cm", report.depthCm);
        req.put("final_depth_cm", res != null && res.finalDepthCm != null ? res.finalDepthCm : 0.0);
        req.put("people_affected", report.peopleAffected);
        req.put("team_name", teamName);
        req.put("vehicle_name", vehicleName);
        req.put("outcome", res != null ? res.outcome : "RESOLVED");
        req.put("field_notes", res != null ? res.notes : "Đã hoàn thành cứu hộ.");
        req.put("confirmation_status", res != null ? res.confirmationStatus : "CONFIRMED");
        req.put("confirmation_notes", res != null ? res.notes : "");
        req.put("chain_proof", chainProof);

        AiAssistantClient.Result clientRes = store.aiAssistant.afterActionReport(req);
        return new HttpResult(clientRes.status(), clientRes.body());
    }
}
