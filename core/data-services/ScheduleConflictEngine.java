package org.openagrios.core.dataservices;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Time-Window Resource & Operator Schedule Conflict Engine.
 * Evaluates half-open time-interval intersections (`start_a < end_b AND end_a > start_b`,
 * matching PostgreSQL GiST exclusion semantics) and equipment availability states.
 */
public final class ScheduleConflictEngine {

    public interface SchedulableAssignment {
        String assignmentId();
        String organizationId();
        String fieldId();
        String machineId();
        String operatorId();
        String startTime();
        String endTime();
        String status();
        Map<String, Object> toConflictSummaryMap();
    }

    private ScheduleConflictEngine() {}

    public static Map<String, Object> checkConflict(
            String orgId,
            String machineId,
            String machineStatus,
            boolean machineExists,
            String operatorId,
            String startTime,
            String endTime,
            String ignoreAssignmentId,
            List<? extends SchedulableAssignment> existingAssignments
    ) {
        if (!machineExists) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("code", "MACHINE_NOT_FOUND");
            err.put("message", "Không tìm thấy máy " + machineId + " trong tổ chức " + orgId + ".");
            return err;
        }

        if ("BREAKDOWN".equals(machineStatus) || "MAINTENANCE".equals(machineStatus)) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("code", "MACHINE_UNAVAILABLE");
            err.put("message", "Máy " + machineId + " đang ở trạng thái " + machineStatus + " — không được phép phân công ca mới.");
            err.put("machine_status", machineStatus);
            return err;
        }

        // 1. Check Machine Time Overlap: start_a < end_b AND end_a > start_b
        for (SchedulableAssignment a : existingAssignments) {
            if (!a.organizationId().equals(orgId)) continue;
            if (ignoreAssignmentId != null && ignoreAssignmentId.equals(a.assignmentId())) continue;
            if (!("CONFIRMED".equals(a.status()) || "IN_PROGRESS".equals(a.status()))) continue;

            if (a.machineId().equals(machineId)
                    && a.startTime().compareTo(endTime) < 0
                    && a.endTime().compareTo(startTime) > 0) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("code", "MACHINE_TIME_OVERLAP");
                err.put("message", String.format(
                        "Xung đột lịch máy (GiST Exclusion): Máy %s đã có ca %s tại vùng %s (%s -> %s).",
                        machineId, a.assignmentId(), a.fieldId(), a.startTime(), a.endTime()
                ));
                err.put("conflicting_assignment", a.toConflictSummaryMap());
                return err;
            }
        }

        // 2. Check Operator Time Overlap
        for (SchedulableAssignment a : existingAssignments) {
            if (!a.organizationId().equals(orgId)) continue;
            if (ignoreAssignmentId != null && ignoreAssignmentId.equals(a.assignmentId())) continue;
            if (!("CONFIRMED".equals(a.status()) || "IN_PROGRESS".equals(a.status()))) continue;

            if (a.operatorId().equals(operatorId)
                    && a.startTime().compareTo(endTime) < 0
                    && a.endTime().compareTo(startTime) > 0) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("code", "OPERATOR_TIME_OVERLAP");
                err.put("message", String.format(
                        "Xung đột lịch nhân sự: Người vận hành %s đã được gán cho ca %s trên máy %s (%s -> %s).",
                        operatorId, a.assignmentId(), a.machineId(), a.startTime(), a.endTime()
                ));
                err.put("conflicting_assignment", a.toConflictSummaryMap());
                return err;
            }
        }

        return null;
    }
}
