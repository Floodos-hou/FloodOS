// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.apps.agriops;

import org.openagrios.core.dataservices.ScheduleConflictEngine.SchedulableAssignment;

import java.util.*;

/**
 * Domain Models for Agricultural Mechanization Logistics (AgriOps Application Module).
 * Defines field plots, combine harvesters, operators, service requests, assignments, and incidents.
 */
public final class AgriModels {

    private AgriModels() {}

    public static final class FieldPlot {
        public final String fieldId;
        public final String organizationId;
        public final String ownerUserId;
        public final String ownerName;
        public final String name;
        public final String hamlet;
        public final String crop;
        public final double areaHa;
        public String readinessStatus;
        public double harvestProgressPct;
        public final String windowStart;
        public final String windowEnd;
        public final double centerLat;
        public final double centerLng;
        public final List<List<List<Double>>> polygon;

        public FieldPlot(
                String fieldId, String organizationId, String ownerUserId, String ownerName,
                String name, String hamlet, String crop, double areaHa,
                String readinessStatus, double harvestProgressPct,
                String windowStart, String windowEnd,
                double centerLat, double centerLng, List<List<List<Double>>> polygon
        ) {
            this.fieldId = fieldId;
            this.organizationId = organizationId;
            this.ownerUserId = ownerUserId;
            this.ownerName = ownerName;
            this.name = name;
            this.hamlet = hamlet;
            this.crop = crop;
            this.areaHa = areaHa;
            this.readinessStatus = readinessStatus;
            this.harvestProgressPct = harvestProgressPct;
            this.windowStart = windowStart;
            this.windowEnd = windowEnd;
            this.centerLat = centerLat;
            this.centerLng = centerLng;
            this.polygon = polygon;
        }

        public Map<String, Object> toMapWithVisibility(String visibility) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("field_id", fieldId);
            m.put("organization_id", organizationId);
            m.put("owner_user_id", ownerUserId);
            m.put("owner_name", "FOG_OF_WAR".equals(visibility) ? "🔒 [Ẩn bởi RLS/Fog of War - Hộ khác]" : ownerName);
            m.put("name", name);
            m.put("hamlet", hamlet);
            m.put("crop", crop);
            m.put("area_ha", areaHa);
            m.put("readiness_status", readinessStatus);
            m.put("harvest_progress_pct", harvestProgressPct);
            m.put("window_start", windowStart);
            m.put("window_end", windowEnd);
            m.put("center_lat", centerLat);
            m.put("center_lng", centerLng);
            m.put("polygon", polygon);
            m.put("visibility", visibility);
            return m;
        }
    }

    public static final class HarvesterMachine {
        public final String machineId;
        public final String organizationId;
        public final String ownerUserId;
        public final String name;
        public final String machineType;
        public final String model;
        public final double capacityHaPerHr;
        public String status;
        public double fuelPct;
        public double healthPct;
        public double currentLat;
        public double currentLng;
        public final String assignedOperatorId;
        public String telemetryUpdatedAt;

        public HarvesterMachine(
                String machineId, String organizationId, String ownerUserId, String name,
                String machineType, String model, double capacityHaPerHr,
                String status, double fuelPct, double healthPct,
                double currentLat, double currentLng,
                String assignedOperatorId, String telemetryUpdatedAt
        ) {
            this.machineId = machineId;
            this.organizationId = organizationId;
            this.ownerUserId = ownerUserId;
            this.name = name;
            this.machineType = machineType;
            this.model = model;
            this.capacityHaPerHr = capacityHaPerHr;
            this.status = status;
            this.fuelPct = fuelPct;
            this.healthPct = healthPct;
            this.currentLat = currentLat;
            this.currentLng = currentLng;
            this.assignedOperatorId = assignedOperatorId;
            this.telemetryUpdatedAt = telemetryUpdatedAt;
        }

        public Map<String, Object> toMapWithVisibility(String visibility) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("machine_id", machineId);
            m.put("organization_id", organizationId);
            m.put("owner_user_id", ownerUserId);
            m.put("name", name);
            m.put("machine_type", machineType);
            m.put("model", model);
            m.put("capacity_ha_per_hr", capacityHaPerHr);
            m.put("status", status);
            m.put("fuel_pct", fuelPct);
            m.put("health_pct", healthPct);
            m.put("current_lat", currentLat);
            m.put("current_lng", currentLng);
            m.put("assigned_operator_id", assignedOperatorId);
            m.put("telemetry_updated_at", telemetryUpdatedAt);
            m.put("visibility", visibility);
            return m;
        }
    }

    public record OperatorProfile(
            String operatorId,
            String userId,
            String organizationId,
            String fullName,
            List<String> skills,
            double rating,
            String status
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("operator_id", operatorId);
            m.put("user_id", userId);
            m.put("organization_id", organizationId);
            m.put("full_name", fullName);
            m.put("rating", rating);
            m.put("status", status);
            m.put("skills", skills);
            return m;
        }
    }

    public static final class ServiceRequest {
        public final String requestId;
        public final String organizationId;
        public final String fieldId;
        public final String requesterUserId;
        public final double areaHa;
        public final String requestedStart;
        public final String requestedEnd;
        public final String priority;
        public String status;
        public final String bpmnProcessId;
        public final String correlationId;
        public final String notes;
        public final String createdAt;

        public ServiceRequest(
                String requestId, String organizationId, String fieldId, String requesterUserId,
                double areaHa, String requestedStart, String requestedEnd,
                String priority, String status, String bpmnProcessId,
                String correlationId, String notes, String createdAt
        ) {
            this.requestId = requestId;
            this.organizationId = organizationId;
            this.fieldId = fieldId;
            this.requesterUserId = requesterUserId;
            this.areaHa = areaHa;
            this.requestedStart = requestedStart;
            this.requestedEnd = requestedEnd;
            this.priority = priority;
            this.status = status;
            this.bpmnProcessId = bpmnProcessId;
            this.correlationId = correlationId;
            this.notes = notes;
            this.createdAt = createdAt;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("request_id", requestId);
            m.put("organization_id", organizationId);
            m.put("field_id", fieldId);
            m.put("requester_user_id", requesterUserId);
            m.put("area_ha", areaHa);
            m.put("requested_start", requestedStart);
            m.put("requested_end", requestedEnd);
            m.put("priority", priority);
            m.put("status", status);
            m.put("bpmn_process_id", bpmnProcessId);
            m.put("correlation_id", correlationId);
            m.put("notes", notes);
            m.put("created_at", createdAt);
            return m;
        }
    }

    public static final class DispatchAssignment implements SchedulableAssignment {
        public final String assignmentId;
        public final String organizationId;
        public final String requestId;
        public final String fieldId;
        public final String machineId;
        public final String operatorId;
        public final String startTime;
        public final String endTime;
        public String status;
        public final String replacesAssignmentId;
        public String supersededByAssignmentId;
        public final String correlationId;
        public final String createdBy;
        public final String createdAt;

        public DispatchAssignment(
                String assignmentId, String organizationId, String requestId, String fieldId,
                String machineId, String operatorId, String startTime, String endTime,
                String status, String replacesAssignmentId, String supersededByAssignmentId,
                String correlationId, String createdBy, String createdAt
        ) {
            this.assignmentId = assignmentId;
            this.organizationId = organizationId;
            this.requestId = requestId;
            this.fieldId = fieldId;
            this.machineId = machineId;
            this.operatorId = operatorId;
            this.startTime = startTime;
            this.endTime = endTime;
            this.status = status;
            this.replacesAssignmentId = replacesAssignmentId;
            this.supersededByAssignmentId = supersededByAssignmentId;
            this.correlationId = correlationId;
            this.createdBy = createdBy;
            this.createdAt = createdAt;
        }

        @Override public String assignmentId() { return assignmentId; }
        @Override public String organizationId() { return organizationId; }
        @Override public String fieldId() { return fieldId; }
        @Override public String machineId() { return machineId; }
        @Override public String operatorId() { return operatorId; }
        @Override public String startTime() { return startTime; }
        @Override public String endTime() { return endTime; }
        @Override public String status() { return status; }

        @Override
        public Map<String, Object> toConflictSummaryMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("assignment_id", assignmentId);
            m.put("field_id", fieldId);
            m.put("machine_id", machineId);
            m.put("start_time", startTime);
            m.put("end_time", endTime);
            m.put("status", status);
            return m;
        }

        public Map<String, Object> toEnrichedMap(FieldPlot f, HarvesterMachine m, OperatorProfile o) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("assignment_id", assignmentId);
            map.put("organization_id", organizationId);
            map.put("request_id", requestId);
            map.put("field_id", fieldId);
            map.put("machine_id", machineId);
            map.put("operator_id", operatorId);
            map.put("start_time", startTime);
            map.put("end_time", endTime);
            map.put("status", status);
            map.put("replaces_assignment_id", replacesAssignmentId);
            map.put("superseded_by_assignment_id", supersededByAssignmentId);
            map.put("correlation_id", correlationId);
            map.put("created_by", createdBy);
            map.put("created_at", createdAt);
            if (f != null) {
                map.put("field_name", f.name);
                map.put("field_lat", f.centerLat);
                map.put("field_lng", f.centerLng);
            }
            if (m != null) {
                map.put("machine_name", m.name);
                map.put("machine_lat", m.currentLat);
                map.put("machine_lng", m.currentLng);
            }
            if (o != null) {
                map.put("operator_name", o.fullName());
            }
            return map;
        }
    }

    public static final class MachineIncident {
        public final String incidentId;
        public final String organizationId;
        public final String machineId;
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
        public final List<String> impactedAssignmentIds;
        public final List<Map<String, Object>> candidateOptions;
        public Map<String, Object> selectedOption;
        public final String correlationId;
        public final String createdAt;

        public MachineIncident(
                String incidentId, String organizationId, String machineId, String reportedByUserId,
                String severity, String incidentType, String description, double estimatedDowntimeHours,
                String evidenceObjectKey, String evidenceEtag, String repairTicketId, String assignedRepairUserId,
                String status, String bpmnProcessId, List<String> impactedAssignmentIds,
                List<Map<String, Object>> candidateOptions, Map<String, Object> selectedOption,
                String correlationId, String createdAt
        ) {
            this.incidentId = incidentId;
            this.organizationId = organizationId;
            this.machineId = machineId;
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
            this.impactedAssignmentIds = impactedAssignmentIds;
            this.candidateOptions = candidateOptions;
            this.selectedOption = selectedOption;
            this.correlationId = correlationId;
            this.createdAt = createdAt;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("incident_id", incidentId);
            m.put("organization_id", organizationId);
            m.put("machine_id", machineId);
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
            m.put("impacted_assignment_ids", impactedAssignmentIds);
            m.put("candidate_options", candidateOptions);
            m.put("selected_option", selectedOption);
            m.put("correlation_id", correlationId);
            m.put("created_at", createdAt);
            return m;
        }
    }

    public record WorkAcceptance(
            String acceptanceId,
            String organizationId,
            String assignmentId,
            String requestId,
            double completedAreaHa,
            String evidenceObjectKey,
            String operatorSubmittedBy,
            String farmerConfirmedBy,
            String confirmationStatus,
            String notes,
            String correlationId,
            String confirmedAt,
            String createdAt
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("acceptance_id", acceptanceId);
            m.put("organization_id", organizationId);
            m.put("assignment_id", assignmentId);
            m.put("request_id", requestId);
            m.put("completed_area_ha", completedAreaHa);
            m.put("evidence_object_key", evidenceObjectKey);
            m.put("operator_submitted_by", operatorSubmittedBy);
            m.put("farmer_confirmed_by", farmerConfirmedBy);
            m.put("confirmation_status", confirmationStatus);
            m.put("notes", notes);
            m.put("correlation_id", correlationId);
            m.put("confirmed_at", confirmedAt);
            m.put("created_at", createdAt);
            return m;
        }
    }
}
