// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.apps.floodops;

import org.openagrios.apps.floodops.FloodModels.*;
import org.openagrios.core.dataservices.JsonCodec;
import org.openagrios.core.dataservices.PostgreSqlDataService;
import org.openagrios.core.dataservices.TenantRlsContext;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * PostgreSQL persistence of Hanoi FloodOps. The SQL of the application lives here, not in the platform core.
 * Every write runs under the caller's RLS context (organisation, role, user): a row the caller may not touch makes
 * the statement fail loudly instead of being skipped. One business action = one transaction ({@link #saveAll}).
 * The tables are created by infra/db/schema.sql only; this class never issues DDL.
 */
public final class FloodRepository {

    /** Tables this application needs, parents first. {@link #requiredTables()} feeds the fail-fast schema check. */
    public static final List<String> TABLES = List.of(
            "flood_zones", "rescue_teams", "rescue_vehicles", "flood_reports", "dispatch_orders",
            "field_incidents", "report_resolutions", "safe_shelters", "gauge_stations");

    /** Business tables to empty on a reset, children first. audit_records is never touched. */
    public static final List<String> TRANSACTIONAL_TABLES_CHILDREN_FIRST = List.of(
            "report_resolutions", "field_incidents", "dispatch_orders", "flood_reports");

    public record Snapshot(
            List<FloodZone> zones, List<RescueTeam> teams, List<RescueVehicle> vehicles, List<FloodReport> reports,
            List<DispatchOrder> orders, List<FieldIncident> incidents, List<ReportResolution> resolutions,
            List<SafeShelter> shelters, List<GaugeStation> gauges) {
    }

    private final PostgreSqlDataService db;

    public FloodRepository(PostgreSqlDataService db) {
        this.db = db;
    }

    public static List<String> requiredTables() {
        List<String> all = new ArrayList<>(List.of("organizations", "users", "audit_records"));
        all.addAll(TABLES);
        return all;
    }

    // ------------------------------------------------------------------------
    // WRITE
    // ------------------------------------------------------------------------

    /** Upserts the entities in one transaction, in the order given (parents first). */
    public void saveAll(String orgId, String role, String userId, Object... entities) {
        db.inTransaction(orgId, role, userId, conn -> {
            for (Object e : entities) {
                if (e == null) continue;
                if (e instanceof FloodZone z) upsertZone(conn, z);
                else if (e instanceof RescueTeam t) upsertTeam(conn, t);
                else if (e instanceof RescueVehicle v) upsertVehicle(conn, v);
                else if (e instanceof FloodReport r) upsertReport(conn, r);
                else if (e instanceof DispatchOrder o) upsertOrder(conn, o);
                else if (e instanceof FieldIncident i) upsertIncident(conn, i);
                else if (e instanceof ReportResolution rr) upsertResolution(conn, rr);
                else if (e instanceof SafeShelter s) upsertShelter(conn, s);
                else if (e instanceof GaugeStation g) upsertGauge(conn, g);
                else throw new IllegalArgumentException("Unsupported entity " + e.getClass().getName());
            }
        });
    }

    /** Removes the business activity; master data is upserted again by the seed. Audit is append-only and stays. */
    public void deleteTransactional() {
        db.deleteRows(TRANSACTIONAL_TABLES_CHILDREN_FIRST);
    }

    private static void one(PreparedStatement ps, String what) throws SQLException {
        int n = ps.executeUpdate();
        if (n != 1) {
            throw new SQLException(what + ": expected exactly one row to be written, got " + n);
        }
    }

    private static void doubleOrNull(PreparedStatement ps, int idx, Double v) throws SQLException {
        if (v == null) ps.setNull(idx, Types.NUMERIC); else ps.setDouble(idx, v);
    }

    private static void textOrNull(PreparedStatement ps, int idx, String v) throws SQLException {
        if (v == null) ps.setNull(idx, Types.VARCHAR); else ps.setString(idx, v);
    }

    private void upsertZone(Connection c, FloodZone z) throws SQLException {
        String boundary = JsonCodec.toCanonicalJson(Map.of("type", "Polygon", "coordinates",
                z.polygon == null ? List.of() : z.polygon));
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO flood_zones (zone_id, organization_id, name, risk_level, water_level_cm, water_level_source,
                    water_level_updated_at, boundary_geojson, center_lat, center_lng, data_origin, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?::timestamptz, CAST(? AS JSONB), ?, ?, ?, NOW())
                ON CONFLICT (zone_id) DO UPDATE SET
                    name = EXCLUDED.name, risk_level = EXCLUDED.risk_level, water_level_cm = EXCLUDED.water_level_cm,
                    water_level_source = EXCLUDED.water_level_source,
                    water_level_updated_at = EXCLUDED.water_level_updated_at,
                    boundary_geojson = EXCLUDED.boundary_geojson, center_lat = EXCLUDED.center_lat,
                    center_lng = EXCLUDED.center_lng, data_origin = EXCLUDED.data_origin, updated_at = NOW()
                """)) {
            ps.setString(1, z.zoneId);
            ps.setString(2, z.organizationId);
            ps.setString(3, z.name);
            ps.setString(4, z.riskLevel);
            doubleOrNull(ps, 5, z.waterLevelCm);
            ps.setString(6, z.waterLevelSource);
            textOrNull(ps, 7, z.waterLevelUpdatedAt);
            ps.setString(8, boundary);
            ps.setDouble(9, z.centerLat);
            ps.setDouble(10, z.centerLng);
            ps.setString(11, z.dataOrigin);
            one(ps, "flood_zones " + z.zoneId);
        }
    }

    private void upsertTeam(Connection c, RescueTeam t) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO rescue_teams (team_id, organization_id, lead_user_id, name, member_count, skills, rating, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (team_id) DO UPDATE SET
                    lead_user_id = EXCLUDED.lead_user_id, name = EXCLUDED.name, member_count = EXCLUDED.member_count,
                    skills = EXCLUDED.skills, rating = EXCLUDED.rating, status = EXCLUDED.status
                """)) {
            ps.setString(1, t.teamId());
            ps.setString(2, t.organizationId());
            ps.setString(3, t.leadUserId());
            ps.setString(4, t.name());
            ps.setInt(5, t.memberCount());
            ps.setArray(6, c.createArrayOf("text", t.skills().toArray()));
            ps.setDouble(7, t.rating());
            ps.setString(8, t.status());
            one(ps, "rescue_teams " + t.teamId());
        }
    }

    private void upsertVehicle(Connection c, RescueVehicle v) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO rescue_vehicles (vehicle_id, organization_id, manager_user_id, name, vehicle_type,
                    capacity_value, capacity_unit, status, fuel_pct, health_pct, current_lat, current_lng,
                    assigned_team_id, telemetry_updated_at, telemetry_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?)
                ON CONFLICT (vehicle_id) DO UPDATE SET
                    manager_user_id = EXCLUDED.manager_user_id, name = EXCLUDED.name,
                    vehicle_type = EXCLUDED.vehicle_type, capacity_value = EXCLUDED.capacity_value,
                    capacity_unit = EXCLUDED.capacity_unit, status = EXCLUDED.status, fuel_pct = EXCLUDED.fuel_pct,
                    health_pct = EXCLUDED.health_pct, current_lat = EXCLUDED.current_lat,
                    current_lng = EXCLUDED.current_lng, assigned_team_id = EXCLUDED.assigned_team_id,
                    telemetry_updated_at = EXCLUDED.telemetry_updated_at, telemetry_source = EXCLUDED.telemetry_source
                """)) {
            ps.setString(1, v.vehicleId);
            ps.setString(2, v.organizationId);
            ps.setString(3, v.managerUserId);
            ps.setString(4, v.name);
            ps.setString(5, v.vehicleType);
            ps.setDouble(6, v.capacityValue);
            ps.setString(7, v.capacityUnit);
            ps.setString(8, v.status);
            ps.setDouble(9, v.fuelPct);
            ps.setDouble(10, v.healthPct);
            ps.setDouble(11, v.currentLat);
            ps.setDouble(12, v.currentLng);
            textOrNull(ps, 13, v.assignedTeamId);
            ps.setString(14, v.telemetryUpdatedAt);
            ps.setString(15, v.telemetrySource);
            one(ps, "rescue_vehicles " + v.vehicleId);
        }
    }

    private void upsertReport(Connection c, FloodReport r) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO flood_reports (report_id, organization_id, zone_id, reporter_user_id, channel, lat, lng,
                    depth_cm, need_type, people_affected, description, priority, status, verified_by_user_id,
                    verification_note, evidence_object_key, bpmn_process_id, correlation_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
                ON CONFLICT (report_id) DO UPDATE SET
                    priority = EXCLUDED.priority, status = EXCLUDED.status,
                    verified_by_user_id = EXCLUDED.verified_by_user_id, verification_note = EXCLUDED.verification_note,
                    evidence_object_key = EXCLUDED.evidence_object_key, bpmn_process_id = EXCLUDED.bpmn_process_id,
                    updated_at = EXCLUDED.updated_at
                """)) {
            ps.setString(1, r.reportId);
            ps.setString(2, r.organizationId);
            ps.setString(3, r.zoneId);
            ps.setString(4, r.reporterUserId);
            ps.setString(5, r.channel);
            ps.setDouble(6, r.lat);
            ps.setDouble(7, r.lng);
            ps.setDouble(8, r.depthCm);
            ps.setString(9, r.needType);
            ps.setInt(10, r.peopleAffected);
            textOrNull(ps, 11, r.description);
            ps.setString(12, r.priority);
            ps.setString(13, r.status);
            textOrNull(ps, 14, r.verifiedByUserId);
            textOrNull(ps, 15, r.verificationNote);
            textOrNull(ps, 16, r.evidenceObjectKey);
            textOrNull(ps, 17, r.bpmnProcessId);
            ps.setString(18, r.correlationId);
            ps.setString(19, r.createdAt);
            ps.setString(20, r.updatedAt);
            one(ps, "flood_reports " + r.reportId);
        }
    }

    private void upsertOrder(Connection c, DispatchOrder o) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO dispatch_orders (order_id, organization_id, report_id, reporter_user_id, zone_id, vehicle_id,
                    team_id, start_time, end_time, status, progress_pct, replaces_order_id, superseded_by_order_id,
                    correlation_id, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz, ?, ?, ?, ?, ?, ?, ?::timestamptz)
                ON CONFLICT (order_id) DO UPDATE SET
                    status = EXCLUDED.status, progress_pct = EXCLUDED.progress_pct,
                    superseded_by_order_id = EXCLUDED.superseded_by_order_id
                """)) {
            ps.setString(1, o.orderId);
            ps.setString(2, o.organizationId);
            ps.setString(3, o.reportId);
            ps.setString(4, o.reporterUserId);
            ps.setString(5, o.zoneId);
            ps.setString(6, o.vehicleId);
            ps.setString(7, o.teamId);
            ps.setString(8, o.startTime);
            ps.setString(9, o.endTime);
            ps.setString(10, o.status);
            ps.setDouble(11, o.progressPct);
            textOrNull(ps, 12, o.replacesOrderId);
            textOrNull(ps, 13, o.supersededByOrderId);
            ps.setString(14, o.correlationId);
            ps.setString(15, o.createdBy);
            ps.setString(16, o.createdAt);
            one(ps, "dispatch_orders " + o.orderId);
        }
    }

    private void upsertIncident(Connection c, FieldIncident i) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO field_incidents (incident_id, organization_id, vehicle_id, reported_by_user_id, severity,
                    incident_type, description, estimated_downtime_hours, evidence_object_key, evidence_etag,
                    repair_ticket_id, assigned_repair_user_id, status, bpmn_process_id, impacted_order_ids,
                    candidate_options, selected_option, correlation_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), CAST(? AS JSONB), CAST(? AS JSONB),
                    ?, ?::timestamptz)
                ON CONFLICT (incident_id) DO UPDATE SET
                    status = EXCLUDED.status, selected_option = EXCLUDED.selected_option,
                    candidate_options = EXCLUDED.candidate_options, impacted_order_ids = EXCLUDED.impacted_order_ids
                """)) {
            ps.setString(1, i.incidentId);
            ps.setString(2, i.organizationId);
            ps.setString(3, i.vehicleId);
            ps.setString(4, i.reportedByUserId);
            ps.setString(5, i.severity);
            ps.setString(6, i.incidentType);
            textOrNull(ps, 7, i.description);
            ps.setDouble(8, i.estimatedDowntimeHours);
            textOrNull(ps, 9, i.evidenceObjectKey);
            textOrNull(ps, 10, i.evidenceEtag);
            textOrNull(ps, 11, i.repairTicketId);
            textOrNull(ps, 12, i.assignedRepairUserId);
            ps.setString(13, i.status);
            textOrNull(ps, 14, i.bpmnProcessId);
            ps.setString(15, JsonCodec.toJson(i.impactedOrderIds));
            ps.setString(16, JsonCodec.toJson(i.candidateOptions));
            if (i.selectedOption == null) ps.setNull(17, Types.VARCHAR); else ps.setString(17, JsonCodec.toJson(i.selectedOption));
            ps.setString(18, i.correlationId);
            ps.setString(19, i.createdAt);
            one(ps, "field_incidents " + i.incidentId);
        }
    }

    private void upsertResolution(Connection c, ReportResolution r) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO report_resolutions (resolution_id, organization_id, report_id, order_id, outcome,
                    final_depth_cm, evidence_object_key, field_submitted_by, confirmed_by, confirmation_status, notes,
                    correlation_id, confirmed_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
                ON CONFLICT (resolution_id) DO UPDATE SET
                    confirmed_by = EXCLUDED.confirmed_by, confirmation_status = EXCLUDED.confirmation_status,
                    confirmed_at = EXCLUDED.confirmed_at, notes = EXCLUDED.notes
                """)) {
            ps.setString(1, r.resolutionId);
            ps.setString(2, r.organizationId);
            ps.setString(3, r.reportId);
            ps.setString(4, r.orderId);
            ps.setString(5, r.outcome);
            doubleOrNull(ps, 6, r.finalDepthCm);
            textOrNull(ps, 7, r.evidenceObjectKey);
            ps.setString(8, r.fieldSubmittedBy);
            textOrNull(ps, 9, r.confirmedBy);
            ps.setString(10, r.confirmationStatus);
            textOrNull(ps, 11, r.notes);
            ps.setString(12, r.correlationId);
            textOrNull(ps, 13, r.confirmedAt);
            ps.setString(14, r.createdAt);
            one(ps, "report_resolutions " + r.resolutionId);
        }
    }

    private void upsertShelter(Connection c, SafeShelter s) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO safe_shelters (shelter_id, organization_id, name, capacity, occupancy, occupancy_source,
                    lat, lng, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz)
                ON CONFLICT (shelter_id) DO UPDATE SET
                    name = EXCLUDED.name, capacity = EXCLUDED.capacity, occupancy = EXCLUDED.occupancy,
                    occupancy_source = EXCLUDED.occupancy_source, status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                """)) {
            ps.setString(1, s.shelterId);
            ps.setString(2, s.organizationId);
            ps.setString(3, s.name);
            ps.setInt(4, s.capacity);
            ps.setInt(5, s.occupancy);
            ps.setString(6, s.occupancySource);
            ps.setDouble(7, s.lat);
            ps.setDouble(8, s.lng);
            ps.setString(9, s.status);
            ps.setString(10, s.updatedAt);
            one(ps, "safe_shelters " + s.shelterId);
        }
    }

    private void upsertGauge(Connection c, GaugeStation g) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
                INSERT INTO gauge_stations (station_id, organization_id, zone_id, name, lat, lng, warn_level_cm,
                    critical_level_cm, level_cm, level_updated_at, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?)
                ON CONFLICT (station_id) DO UPDATE SET
                    name = EXCLUDED.name, warn_level_cm = EXCLUDED.warn_level_cm,
                    critical_level_cm = EXCLUDED.critical_level_cm, level_cm = EXCLUDED.level_cm,
                    level_updated_at = EXCLUDED.level_updated_at, source = EXCLUDED.source
                """)) {
            ps.setString(1, g.stationId);
            ps.setString(2, g.organizationId);
            ps.setString(3, g.zoneId);
            ps.setString(4, g.name);
            ps.setDouble(5, g.lat);
            ps.setDouble(6, g.lng);
            ps.setDouble(7, g.warnLevelCm);
            ps.setDouble(8, g.criticalLevelCm);
            doubleOrNull(ps, 9, g.levelCm);
            textOrNull(ps, 10, g.levelUpdatedAt);
            ps.setString(11, g.source);
            one(ps, "gauge_stations " + g.stationId);
        }
    }

    // ------------------------------------------------------------------------
    // READ (cold-start rehydration with the platform-level context)
    // ------------------------------------------------------------------------

    public Snapshot loadAll() {
        List<FloodZone> zones = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT zone_id, organization_id, name, risk_level, water_level_cm, water_level_source, water_level_updated_at::text AS water_level_updated_at, boundary_geojson::text AS boundary_geojson, center_lat, center_lng, data_origin FROM flood_zones ORDER BY zone_id")) {
            zones.add(new FloodZone(s(r, "zone_id"), s(r, "organization_id"), s(r, "name"), s(r, "risk_level"),
                    d(r, "water_level_cm"), s(r, "water_level_source"), s(r, "water_level_updated_at"),
                    polygonOf(s(r, "boundary_geojson")), dd(r, "center_lat"), dd(r, "center_lng"), s(r, "data_origin")));
        }
        List<RescueTeam> teams = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT team_id, organization_id, lead_user_id, name, member_count, array_to_string(skills, ',') AS skills, rating, status FROM rescue_teams ORDER BY team_id")) {
            String skills = s(r, "skills");
            teams.add(new RescueTeam(s(r, "team_id"), s(r, "organization_id"), s(r, "lead_user_id"), s(r, "name"),
                    ((Number) r.get("member_count")).intValue(),
                    skills == null || skills.isBlank() ? List.of() : List.of(skills.split(",")),
                    dd(r, "rating"), s(r, "status")));
        }
        List<RescueVehicle> vehicles = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT vehicle_id, organization_id, manager_user_id, name, vehicle_type, capacity_value, capacity_unit, status, fuel_pct, health_pct, current_lat, current_lng, assigned_team_id, telemetry_updated_at::text AS telemetry_updated_at, telemetry_source FROM rescue_vehicles ORDER BY vehicle_id")) {
            vehicles.add(new RescueVehicle(s(r, "vehicle_id"), s(r, "organization_id"), s(r, "manager_user_id"),
                    s(r, "name"), s(r, "vehicle_type"), dd(r, "capacity_value"), s(r, "capacity_unit"), s(r, "status"),
                    dd(r, "fuel_pct"), dd(r, "health_pct"), dd(r, "current_lat"), dd(r, "current_lng"),
                    s(r, "assigned_team_id"), s(r, "telemetry_updated_at"), s(r, "telemetry_source")));
        }
        List<FloodReport> reports = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT report_id, organization_id, zone_id, reporter_user_id, channel, lat, lng, depth_cm, need_type, people_affected, description, priority, status, verified_by_user_id, verification_note, evidence_object_key, bpmn_process_id, correlation_id, created_at::text AS created_at, updated_at::text AS updated_at FROM flood_reports ORDER BY created_at, report_id")) {
            reports.add(new FloodReport(s(r, "report_id"), s(r, "organization_id"), s(r, "zone_id"),
                    s(r, "reporter_user_id"), s(r, "channel"), dd(r, "lat"), dd(r, "lng"), dd(r, "depth_cm"),
                    s(r, "need_type"), ((Number) r.get("people_affected")).intValue(), s(r, "description"),
                    s(r, "priority"), s(r, "status"), s(r, "verified_by_user_id"), s(r, "verification_note"),
                    s(r, "evidence_object_key"), s(r, "bpmn_process_id"), s(r, "correlation_id"),
                    s(r, "created_at"), s(r, "updated_at")));
        }
        List<DispatchOrder> orders = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT order_id, organization_id, report_id, reporter_user_id, zone_id, vehicle_id, team_id, start_time::text AS start_time, end_time::text AS end_time, status, progress_pct, replaces_order_id, superseded_by_order_id, correlation_id, created_by, created_at::text AS created_at FROM dispatch_orders ORDER BY created_at, order_id")) {
            orders.add(new DispatchOrder(s(r, "order_id"), s(r, "organization_id"), s(r, "report_id"),
                    s(r, "reporter_user_id"), s(r, "zone_id"), s(r, "vehicle_id"), s(r, "team_id"),
                    s(r, "start_time"), s(r, "end_time"), s(r, "status"), dd(r, "progress_pct"),
                    s(r, "replaces_order_id"), s(r, "superseded_by_order_id"), s(r, "correlation_id"),
                    s(r, "created_by"), s(r, "created_at")));
        }
        List<FieldIncident> incidents = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT incident_id, organization_id, vehicle_id, reported_by_user_id, severity, incident_type, description, estimated_downtime_hours, evidence_object_key, evidence_etag, repair_ticket_id, assigned_repair_user_id, status, bpmn_process_id, impacted_order_ids::text AS impacted_order_ids, candidate_options::text AS candidate_options, selected_option::text AS selected_option, correlation_id, created_at::text AS created_at FROM field_incidents ORDER BY created_at, incident_id")) {
            incidents.add(new FieldIncident(s(r, "incident_id"), s(r, "organization_id"), s(r, "vehicle_id"),
                    s(r, "reported_by_user_id"), s(r, "severity"), s(r, "incident_type"), s(r, "description"),
                    dd(r, "estimated_downtime_hours"), s(r, "evidence_object_key"), s(r, "evidence_etag"),
                    s(r, "repair_ticket_id"), s(r, "assigned_repair_user_id"), s(r, "status"), s(r, "bpmn_process_id"),
                    stringList(s(r, "impacted_order_ids")), objectList(s(r, "candidate_options")),
                    s(r, "selected_option") == null ? null : JsonCodec.parseObject(s(r, "selected_option")),
                    s(r, "correlation_id"), s(r, "created_at")));
        }
        List<ReportResolution> resolutions = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT resolution_id, organization_id, report_id, order_id, outcome, final_depth_cm, evidence_object_key, field_submitted_by, confirmed_by, confirmation_status, notes, correlation_id, confirmed_at::text AS confirmed_at, created_at::text AS created_at FROM report_resolutions ORDER BY created_at, resolution_id")) {
            resolutions.add(new ReportResolution(s(r, "resolution_id"), s(r, "organization_id"), s(r, "report_id"),
                    s(r, "order_id"), s(r, "outcome"), d(r, "final_depth_cm"), s(r, "evidence_object_key"),
                    s(r, "field_submitted_by"), s(r, "confirmed_by"), s(r, "confirmation_status"), s(r, "notes"),
                    s(r, "correlation_id"), s(r, "confirmed_at"), s(r, "created_at")));
        }
        List<SafeShelter> shelters = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT shelter_id, organization_id, name, capacity, occupancy, occupancy_source, lat, lng, status, updated_at::text AS updated_at FROM safe_shelters ORDER BY shelter_id")) {
            shelters.add(new SafeShelter(s(r, "shelter_id"), s(r, "organization_id"), s(r, "name"),
                    ((Number) r.get("capacity")).intValue(), ((Number) r.get("occupancy")).intValue(),
                    s(r, "occupancy_source"), dd(r, "lat"), dd(r, "lng"), s(r, "status"), s(r, "updated_at")));
        }
        List<GaugeStation> gauges = new ArrayList<>();
        for (Map<String, Object> r : db.queryAsPlatform("SELECT station_id, organization_id, zone_id, name, lat, lng, warn_level_cm, critical_level_cm, level_cm, level_updated_at::text AS level_updated_at, source FROM gauge_stations ORDER BY station_id")) {
            gauges.add(new GaugeStation(s(r, "station_id"), s(r, "organization_id"), s(r, "zone_id"), s(r, "name"),
                    dd(r, "lat"), dd(r, "lng"), dd(r, "warn_level_cm"), dd(r, "critical_level_cm"), d(r, "level_cm"),
                    s(r, "level_updated_at"), s(r, "source")));
        }
        return new Snapshot(zones, teams, vehicles, reports, orders, incidents, resolutions, shelters, gauges);
    }

    /** True when the business tables hold data, i.e. the database must be loaded instead of seeded. */
    public boolean hasData() {
        return db.hasRows("flood_zones");
    }

    private static String s(Map<String, Object> r, String k) {
        Object v = r.get(k);
        return v == null ? null : String.valueOf(v);
    }

    private static Double d(Map<String, Object> r, String k) {
        Object v = r.get(k);
        return v instanceof Number n ? n.doubleValue() : null;
    }

    private static double dd(Map<String, Object> r, String k) {
        Double v = d(r, k);
        if (v == null) throw new IllegalStateException("column " + k + " is NULL but required");
        return v;
    }

    @SuppressWarnings("unchecked")
    private static List<List<List<Double>>> polygonOf(String geoJson) {
        Object coords = JsonCodec.parseObject(geoJson).get("coordinates");
        if (!(coords instanceof List<?> rings)) return List.of();
        List<List<List<Double>>> out = new ArrayList<>();
        for (Object ring : rings) {
            List<List<Double>> pts = new ArrayList<>();
            for (Object p : (List<?>) ring) {
                List<?> xy = (List<?>) p;
                pts.add(List.of(((Number) xy.get(0)).doubleValue(), ((Number) xy.get(1)).doubleValue()));
            }
            out.add(pts);
        }
        return out;
    }

    private static List<Object> jsonArray(String json) {
        if (json == null || json.isBlank()) return List.of();
        Object v = JsonCodec.parseObject("{\"v\":" + json + "}").get("v");
        return v instanceof List<?> l ? new ArrayList<>(l) : List.of();
    }

    private static List<String> stringList(String json) {
        List<String> out = new ArrayList<>();
        for (Object o : jsonArray(json)) out.add(String.valueOf(o));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> objectList(String json) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : jsonArray(json)) if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    /** Role used by the platform when it writes seed or telemetry on its own behalf. */
    public static final String SYSTEM_ROLE = TenantRlsContext.PLATFORM_ROLE;
}
