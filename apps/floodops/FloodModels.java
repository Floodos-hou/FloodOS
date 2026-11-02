// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.apps.floodops;

import org.openagrios.core.dataservices.ScheduleConflictEngine;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Domain models of Hanoi FloodOps: flood zones and reports, rescue teams and vehicles, dispatch orders,
 * field incidents, resolutions, safe shelters and gauge stations.
 *
 * <p>Every number that did not come from a person or a physical device carries a source label (SEED, SIMULATOR,
 * REPORTED, DEVICE) so a screen can never present a simulated value as an observation.
 */
public final class FloodModels {

    private FloodModels() {}

    public static final Set<String> VEHICLE_UNAVAILABLE = Set.of("BREAKDOWN", "MAINTENANCE");
    public static final Set<String> ORDER_ACTIVE = Set.of("CONFIRMED", "IN_PROGRESS");

    // ------------------------------------------------------------------------
    public static final class FloodZone {
        public final String zoneId;
        public final String organizationId;
        public final String name;
        public String riskLevel;
        public Double waterLevelCm;
        public String waterLevelSource;
        public String waterLevelUpdatedAt;
        public final List<List<List<Double>>> polygon;
        public final double centerLat;
        public final double centerLng;
        public final String dataOrigin;

        public FloodZone(String zoneId, String organizationId, String name, String riskLevel, Double waterLevelCm,
                         String waterLevelSource, String waterLevelUpdatedAt, List<List<List<Double>>> polygon,
                         double centerLat, double centerLng, String dataOrigin) {
            this.zoneId = zoneId;
            this.organizationId = organizationId;
            this.name = name;
            this.riskLevel = riskLevel;
            this.waterLevelCm = waterLevelCm;
            this.waterLevelSource = waterLevelSource;
            this.waterLevelUpdatedAt = waterLevelUpdatedAt;
            this.polygon = polygon;
            this.centerLat = centerLat;
            this.centerLng = centerLng;
            this.dataOrigin = dataOrigin;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("zone_id", zoneId);
            m.put("organization_id", organizationId);
            m.put("name", name);
            m.put("risk_level", riskLevel);
            m.put("water_level_cm", waterLevelCm);
            m.put("water_level_source", waterLevelSource);
            m.put("water_level_updated_at", waterLevelUpdatedAt);
            m.put("center_lat", centerLat);
            m.put("center_lng", centerLng);
            m.put("polygon", polygon == null ? Collections.emptyList() : polygon);
            m.put("data_origin", dataOrigin);
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public record RescueTeam(
            String teamId,
            String organizationId,
            String leadUserId,
            String name,
            int memberCount,
            List<String> skills,
            double rating,
            String status
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("team_id", teamId);
            m.put("organization_id", organizationId);
            m.put("lead_user_id", leadUserId);
            m.put("name", name);
            m.put("member_count", memberCount);
            m.put("skills", skills);
            m.put("rating", rating);
            m.put("status", status);
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public static final class RescueVehicle {
        public final String vehicleId;
        public final String organizationId;
        public final String managerUserId;
        public final String name;
        public final String vehicleType;
        public final double capacityValue;
        public final String capacityUnit;
        public String status;
        public double fuelPct;
        public double healthPct;
        public double currentLat;
        public double currentLng;
        public final String assignedTeamId;
        public String telemetryUpdatedAt;
        public String telemetrySource;

        public RescueVehicle(String vehicleId, String organizationId, String managerUserId, String name,
                             String vehicleType, double capacityValue, String capacityUnit, String status,
                             double fuelPct, double healthPct, double currentLat, double currentLng,
                             String assignedTeamId, String telemetryUpdatedAt, String telemetrySource) {
            this.vehicleId = vehicleId;
            this.organizationId = organizationId;
            this.managerUserId = managerUserId;
            this.name = name;
            this.vehicleType = vehicleType;
            this.capacityValue = capacityValue;
            this.capacityUnit = capacityUnit;
            this.status = status;
            this.fuelPct = fuelPct;
            this.healthPct = healthPct;
            this.currentLat = currentLat;
            this.currentLng = currentLng;
            this.assignedTeamId = assignedTeamId;
            this.telemetryUpdatedAt = telemetryUpdatedAt;
            this.telemetrySource = telemetrySource;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("vehicle_id", vehicleId);
            m.put("organization_id", organizationId);
            m.put("manager_user_id", managerUserId);
            m.put("name", name);
            m.put("vehicle_type", vehicleType);
            m.put("capacity_value", capacityValue);
            m.put("capacity_unit", capacityUnit);
            m.put("status", status);
            m.put("fuel_pct", fuelPct);
            m.put("health_pct", healthPct);
            m.put("current_lat", currentLat);
            m.put("current_lng", currentLng);
            m.put("assigned_team_id", assignedTeamId);
            m.put("telemetry_updated_at", telemetryUpdatedAt);
            m.put("telemetry_source", telemetrySource);
            // Only a real device is an observation; seed and simulator positions are labelled as such.
            m.put("position_is_simulated", !"DEVICE".equals(telemetrySource));
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public static final class FloodReport {
        public final String reportId;
        public final String organizationId;
        public final String zoneId;
        public final String reporterUserId;
        public final String channel;
        public final double lat;
        public final double lng;
        public final double depthCm;
        public final String needType;
        public final int peopleAffected;
        public final String description;
        public String priority;
        public String status;
        public String verifiedByUserId;
        public String verificationNote;
        public String evidenceObjectKey;
        public final String bpmnProcessId;
        public final String correlationId;
        public final String createdAt;
        public String updatedAt;

        public FloodReport(String reportId, String organizationId, String zoneId, String reporterUserId, String channel,
                           double lat, double lng, double depthCm, String needType, int peopleAffected,
                           String description, String priority, String status, String verifiedByUserId,
                           String verificationNote, String evidenceObjectKey, String bpmnProcessId,
                           String correlationId, String createdAt, String updatedAt) {
            this.reportId = reportId;
            this.organizationId = organizationId;
            this.zoneId = zoneId;
            this.reporterUserId = reporterUserId;
            this.channel = channel;
            this.lat = lat;
            this.lng = lng;
            this.depthCm = depthCm;
            this.needType = needType;
            this.peopleAffected = peopleAffected;
            this.description = description;
            this.priority = priority;
            this.status = status;
            this.verifiedByUserId = verifiedByUserId;
            this.verificationNote = verificationNote;
            this.evidenceObjectKey = evidenceObjectKey;
            this.bpmnProcessId = bpmnProcessId;
            this.correlationId = correlationId;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("report_id", reportId);
            m.put("organization_id", organizationId);
            m.put("zone_id", zoneId);
            m.put("reporter_user_id", reporterUserId);
            m.put("channel", channel);
            m.put("lat", lat);
            m.put("lng", lng);
            m.put("depth_cm", depthCm);
            m.put("depth_source", "REPORTED");
            m.put("need_type", needType);
            m.put("people_affected", peopleAffected);
            m.put("description", description);
            m.put("priority", priority);
            m.put("status", status);
            m.put("verified_by_user_id", verifiedByUserId);
            m.put("verification_note", verificationNote);
            m.put("evidence_object_key", evidenceObjectKey);
            m.put("bpmn_process_id", bpmnProcessId);
            m.put("correlation_id", correlationId);
            m.put("created_at", createdAt);
            m.put("updated_at", updatedAt);
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public static final class DispatchOrder implements ScheduleConflictEngine.Booking {
        public final String orderId;
        public final String organizationId;
        public final String reportId;
        public final String reporterUserId;
        public final String zoneId;
        public final String vehicleId;
        public final String teamId;
        public final String startTime;
        public final String endTime;
        public String status;
        public double progressPct;
        public final String replacesOrderId;
        public String supersededByOrderId;
        public final String correlationId;
        public final String createdBy;
        public final String createdAt;

        public DispatchOrder(String orderId, String organizationId, String reportId, String reporterUserId,
                             String zoneId, String vehicleId, String teamId, String startTime, String endTime,
                             String status, double progressPct, String replacesOrderId, String supersededByOrderId,
                             String correlationId, String createdBy, String createdAt) {
            this.orderId = orderId;
            this.organizationId = organizationId;
            this.reportId = reportId;
            this.reporterUserId = reporterUserId;
            this.zoneId = zoneId;
            this.vehicleId = vehicleId;
            this.teamId = teamId;
            this.startTime = startTime;
            this.endTime = endTime;
            this.status = status;
            this.progressPct = progressPct;
            this.replacesOrderId = replacesOrderId;
            this.supersededByOrderId = supersededByOrderId;
            this.correlationId = correlationId;
            this.createdBy = createdBy;
            this.createdAt = createdAt;
        }

        @Override public String bookingId() { return orderId; }
        @Override public String organizationId() { return organizationId; }
        @Override public String resourceId() { return vehicleId; }
        @Override public String holderId() { return teamId; }
        @Override public String startTime() { return startTime; }
        @Override public String endTime() { return endTime; }
        @Override public String status() { return status; }

        @Override
        public Map<String, Object> toConflictSummaryMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("order_id", orderId);
            m.put("report_id", reportId);
            m.put("vehicle_id", vehicleId);
            m.put("team_id", teamId);
            m.put("start_time", startTime);
            m.put("end_time", endTime);
            m.put("status", status);
            return m;
        }

        public Map<String, Object> toEnrichedMap(FloodZone z, RescueVehicle v, RescueTeam t) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("order_id", orderId);
            m.put("organization_id", organizationId);
            m.put("report_id", reportId);
            m.put("zone_id", zoneId);
            m.put("vehicle_id", vehicleId);
            m.put("team_id", teamId);
            m.put("start_time", startTime);
            m.put("end_time", endTime);
            m.put("status", status);
            m.put("progress_pct", progressPct);
            m.put("replaces_order_id", replacesOrderId);
            m.put("superseded_by_order_id", supersededByOrderId);
            m.put("correlation_id", correlationId);
            m.put("created_by", createdBy);
            m.put("created_at", createdAt);
            if (z != null) {
                m.put("zone_name", z.name);
                m.put("zone_lat", z.centerLat);
                m.put("zone_lng", z.centerLng);
            }
            if (v != null) {
                m.put("vehicle_name", v.name);
                m.put("vehicle_lat", v.currentLat);
                m.put("vehicle_lng", v.currentLng);
                m.put("vehicle_position_is_simulated", !"DEVICE".equals(v.telemetrySource));
            }
            if (t != null) {
                m.put("team_name", t.name());
            }
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public static final class FieldIncident {
        public final String incidentId;
        public final String organizationId;
        public final String vehicleId;
        public final String reportedByUserId;
        public final String severity;
        public final String incidentType;
        public final String description;
        public final double estimatedDowntimeHours;
        public final String evidenceObjectKey;
        public final String evidenceEtag;
        public final String repairTicketId;
        public final String assignedRepairUserId;
        public String status;
        public final String bpmnProcessId;
        public final List<String> impactedOrderIds;
        public final List<Map<String, Object>> candidateOptions;
        public Map<String, Object> selectedOption;
        public final String correlationId;
        public final String createdAt;

        public FieldIncident(String incidentId, String organizationId, String vehicleId, String reportedByUserId,
                             String severity, String incidentType, String description, double estimatedDowntimeHours,
                             String evidenceObjectKey, String evidenceEtag, String repairTicketId,
                             String assignedRepairUserId, String status, String bpmnProcessId,
                             List<String> impactedOrderIds, List<Map<String, Object>> candidateOptions,
                             Map<String, Object> selectedOption, String correlationId, String createdAt) {
            this.incidentId = incidentId;
            this.organizationId = organizationId;
            this.vehicleId = vehicleId;
            this.reportedByUserId = reportedByUserId;
            this.severity = severity;
            this.incidentType = incidentType;
            this.description = description;
            this.estimatedDowntimeHours = estimatedDowntimeHours;
            this.evidenceObjectKey = evidenceObjectKey;
            this.evidenceEtag = evidenceEtag;
            this.repairTicketId = repairTicketId;
            this.assignedRepairUserId = assignedRepairUserId;
            this.status = status;
            this.bpmnProcessId = bpmnProcessId;
            this.impactedOrderIds = impactedOrderIds;
            this.candidateOptions = candidateOptions;
            this.selectedOption = selectedOption;
            this.correlationId = correlationId;
            this.createdAt = createdAt;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("incident_id", incidentId);
            m.put("organization_id", organizationId);
            m.put("vehicle_id", vehicleId);
            m.put("reported_by_user_id", reportedByUserId);
            m.put("severity", severity);
            m.put("incident_type", incidentType);
            m.put("description", description);
            m.put("estimated_downtime_hours", estimatedDowntimeHours);
            m.put("evidence_object_key", evidenceObjectKey);
            m.put("evidence_etag", evidenceEtag);
            m.put("repair_ticket_id", repairTicketId);
            m.put("assigned_repair_user_id", assignedRepairUserId);
            m.put("status", status);
            m.put("bpmn_process_id", bpmnProcessId);
            m.put("impacted_order_ids", impactedOrderIds);
            m.put("candidate_options", candidateOptions);
            m.put("selected_option", selectedOption);
            m.put("correlation_id", correlationId);
            m.put("created_at", createdAt);
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public static final class ReportResolution {
        public final String resolutionId;
        public final String organizationId;
        public final String reportId;
        public final String orderId;
        public final String outcome;
        public final Double finalDepthCm;
        public final String evidenceObjectKey;
        public final String fieldSubmittedBy;
        public String confirmedBy;
        public String confirmationStatus;
        public final String notes;
        public final String correlationId;
        public String confirmedAt;
        public final String createdAt;

        public ReportResolution(String resolutionId, String organizationId, String reportId, String orderId,
                                String outcome, Double finalDepthCm, String evidenceObjectKey, String fieldSubmittedBy,
                                String confirmedBy, String confirmationStatus, String notes, String correlationId,
                                String confirmedAt, String createdAt) {
            this.resolutionId = resolutionId;
            this.organizationId = organizationId;
            this.reportId = reportId;
            this.orderId = orderId;
            this.outcome = outcome;
            this.finalDepthCm = finalDepthCm;
            this.evidenceObjectKey = evidenceObjectKey;
            this.fieldSubmittedBy = fieldSubmittedBy;
            this.confirmedBy = confirmedBy;
            this.confirmationStatus = confirmationStatus;
            this.notes = notes;
            this.correlationId = correlationId;
            this.confirmedAt = confirmedAt;
            this.createdAt = createdAt;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("resolution_id", resolutionId);
            m.put("organization_id", organizationId);
            m.put("report_id", reportId);
            m.put("order_id", orderId);
            m.put("outcome", outcome);
            m.put("final_depth_cm", finalDepthCm);
            m.put("evidence_object_key", evidenceObjectKey);
            m.put("field_submitted_by", fieldSubmittedBy);
            m.put("confirmed_by", confirmedBy);
            m.put("confirmation_status", confirmationStatus);
            m.put("notes", notes);
            m.put("correlation_id", correlationId);
            m.put("confirmed_at", confirmedAt);
            m.put("created_at", createdAt);
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public static final class SafeShelter {
        public final String shelterId;
        public final String organizationId;
        public final String name;
        public final int capacity;
        public int occupancy;
        public String occupancySource;
        public final double lat;
        public final double lng;
        public String status;
        public String updatedAt;

        public SafeShelter(String shelterId, String organizationId, String name, int capacity, int occupancy,
                           String occupancySource, double lat, double lng, String status, String updatedAt) {
            this.shelterId = shelterId;
            this.organizationId = organizationId;
            this.name = name;
            this.capacity = capacity;
            this.occupancy = occupancy;
            this.occupancySource = occupancySource;
            this.lat = lat;
            this.lng = lng;
            this.status = status;
            this.updatedAt = updatedAt;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("shelter_id", shelterId);
            m.put("organization_id", organizationId);
            m.put("name", name);
            m.put("capacity", capacity);
            m.put("occupancy", occupancy);
            m.put("occupancy_source", occupancySource);
            m.put("lat", lat);
            m.put("lng", lng);
            m.put("status", status);
            m.put("updated_at", updatedAt);
            return m;
        }
    }

    // ------------------------------------------------------------------------
    public static final class GaugeStation {
        public final String stationId;
        public final String organizationId;
        public final String zoneId;
        public final String name;
        public final double lat;
        public final double lng;
        public final double warnLevelCm;
        public final double criticalLevelCm;
        public Double levelCm;
        public String levelUpdatedAt;
        public final String source;

        public GaugeStation(String stationId, String organizationId, String zoneId, String name, double lat,
                            double lng, double warnLevelCm, double criticalLevelCm, Double levelCm,
                            String levelUpdatedAt, String source) {
            this.stationId = stationId;
            this.organizationId = organizationId;
            this.zoneId = zoneId;
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.warnLevelCm = warnLevelCm;
            this.criticalLevelCm = criticalLevelCm;
            this.levelCm = levelCm;
            this.levelUpdatedAt = levelUpdatedAt;
            this.source = source;
        }

        /** NORMAL / WARNING / CRITICAL from this station's own thresholds; UNKNOWN when it has never reported. */
        public String alertState() {
            if (levelCm == null) return "UNKNOWN";
            if (levelCm >= criticalLevelCm) return "CRITICAL";
            if (levelCm >= warnLevelCm) return "WARNING";
            return "NORMAL";
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("station_id", stationId);
            m.put("organization_id", organizationId);
            m.put("zone_id", zoneId);
            m.put("name", name);
            m.put("lat", lat);
            m.put("lng", lng);
            m.put("warn_level_cm", warnLevelCm);
            m.put("critical_level_cm", criticalLevelCm);
            m.put("level_cm", levelCm);
            m.put("level_updated_at", levelUpdatedAt);
            m.put("alert_state", alertState());
            m.put("source", source);
            m.put("is_simulated", !"DEVICE".equals(source));
            return m;
        }
    }
}
