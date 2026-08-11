// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.core.dataservices;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Domain-neutral booking conflict engine: one resource (a room, a tool, a unit of equipment...) held by one holder
 * (a team, a person...) for a time window.
 *
 * <p>It evaluates half-open interval intersection ({@code start_a < end_b AND end_a > start_b}), the same semantics
 * as the PostgreSQL GiST exclusion constraints in infra/db/schema.sql, plus the availability state of the resource.
 * It returns codes and the facts behind them; the application words the message for its own users.
 */
public final class ScheduleConflictEngine {

    public static final String RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND";
    public static final String RESOURCE_UNAVAILABLE = "RESOURCE_UNAVAILABLE";
    public static final String RESOURCE_TIME_OVERLAP = "RESOURCE_TIME_OVERLAP";
    public static final String HOLDER_TIME_OVERLAP = "HOLDER_TIME_OVERLAP";

    /** An existing booking of a resource. Times are ISO-8601 UTC strings of identical shape (they compare as text). */
    public interface Booking {
        String bookingId();
        String organizationId();
        String resourceId();
        String holderId();
        String startTime();
        String endTime();
        String status();
        Map<String, Object> toConflictSummaryMap();
    }

    private ScheduleConflictEngine() {}

    /**
     * @param activeStatuses              booking statuses that occupy the resource (others never block)
     * @param unavailableResourceStatuses resource statuses that forbid any new booking
     * @return null when the booking is possible, otherwise a map with a {@code code} and the facts of the conflict
     */
    public static Map<String, Object> checkConflict(
            String orgId,
            String resourceId,
            String resourceStatus,
            boolean resourceExists,
            Set<String> unavailableResourceStatuses,
            String holderId,
            String startTime,
            String endTime,
            String ignoreBookingId,
            Set<String> activeStatuses,
            List<? extends Booking> existingBookings
    ) {
        if (!resourceExists) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("code", RESOURCE_NOT_FOUND);
            err.put("resource_id", resourceId);
            return err;
        }

        if (unavailableResourceStatuses.contains(resourceStatus)) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("code", RESOURCE_UNAVAILABLE);
            err.put("resource_id", resourceId);
            err.put("resource_status", resourceStatus);
            return err;
        }

        // 1. Resource time overlap
        for (Booking b : existingBookings) {
            if (!blocks(b, orgId, ignoreBookingId, activeStatuses)) continue;
            if (b.resourceId().equals(resourceId) && overlaps(b, startTime, endTime)) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("code", RESOURCE_TIME_OVERLAP);
                err.put("resource_id", resourceId);
                err.put("conflicting_booking", b.toConflictSummaryMap());
                return err;
            }
        }

        // 2. Holder time overlap
        for (Booking b : existingBookings) {
            if (!blocks(b, orgId, ignoreBookingId, activeStatuses)) continue;
            if (b.holderId().equals(holderId) && overlaps(b, startTime, endTime)) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("code", HOLDER_TIME_OVERLAP);
                err.put("holder_id", holderId);
                err.put("conflicting_booking", b.toConflictSummaryMap());
                return err;
            }
        }

        return null;
    }

    private static boolean blocks(Booking b, String orgId, String ignoreBookingId, Set<String> activeStatuses) {
        if (!b.organizationId().equals(orgId)) return false;
        if (ignoreBookingId != null && ignoreBookingId.equals(b.bookingId())) return false;
        return activeStatuses.contains(b.status());
    }

    private static boolean overlaps(Booking b, String startTime, String endTime) {
        return b.startTime().compareTo(endTime) < 0 && b.endTime().compareTo(startTime) > 0;
    }
}
