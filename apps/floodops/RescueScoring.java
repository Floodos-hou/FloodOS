// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.apps.floodops;

/**
 * Explainable ranking of replacement vehicles (pure functions, unit-tested).
 *
 * <p>Distance is the straight-line Haversine distance between the vehicle and the flood zone. It is NOT a road or
 * water route and ignores flooded streets. The capacity targets below are stated heuristics, not hydraulic or
 * regulatory figures.
 *
 * <p>Score (0..100): 40 distance + 25 suitability for the need + 20 capacity fit + 15 team rating.
 */
public final class RescueScoring {

    /** Distance at which the distance component reaches zero. */
    public static final double MAX_RANKED_DISTANCE_KM = 15.0;
    /** Heuristic: a pump should move about 10 m3/h per centimetre of reported depth. */
    public static final double PUMP_M3H_PER_CM = 10.0;

    private RescueScoring() {}

    /**
     * 1.0 = designed for this need, 0.5 = usable, 0.0 = unfit (the vehicle must not be offered).
     */
    public static double suitability(String vehicleType, String needType) {
        return switch (needType) {
            case "EVACUATION" -> switch (vehicleType) {
                case "RESCUE_BOAT" -> 1.0;
                case "HIGH_CLEARANCE_TRUCK" -> 0.5;
                default -> 0.0;
            };
            case "MEDICAL" -> switch (vehicleType) {
                case "HIGH_CLEARANCE_TRUCK" -> 1.0;
                case "RESCUE_BOAT" -> 0.5;
                default -> 0.0;
            };
            case "FOOD_WATER" -> switch (vehicleType) {
                case "HIGH_CLEARANCE_TRUCK" -> 1.0;
                case "RESCUE_BOAT" -> 0.5;
                default -> 0.0;
            };
            case "PUMPING" -> "MOBILE_PUMP".equals(vehicleType) ? 1.0 : 0.0;
            case "ROAD_BLOCKED" -> switch (vehicleType) {
                case "MOBILE_PUMP" -> 1.0;
                case "HIGH_CLEARANCE_TRUCK" -> 0.5;
                default -> 0.0;
            };
            default -> 0.0;
        };
    }

    /** Share (0..1) of the need the vehicle's capacity covers. */
    public static double capacityFit(String capacityUnit, double capacityValue, int peopleAffected, double depthCm) {
        if ("PERSONS".equals(capacityUnit)) {
            if (peopleAffected <= 0) return 1.0;
            return Math.min(1.0, capacityValue / peopleAffected);
        }
        double needed = Math.max(1.0, depthCm) * PUMP_M3H_PER_CM;
        return Math.min(1.0, capacityValue / needed);
    }

    public static double score(double distKm, double suitability, double capacityFit, double teamRating) {
        double dist = 40.0 * Math.max(0.0, 1.0 - distKm / MAX_RANKED_DISTANCE_KM);
        double fit = 25.0 * clamp01(suitability);
        double cap = 20.0 * clamp01(capacityFit);
        double rating = 15.0 * clamp01(teamRating / 5.0);
        return Math.round((dist + fit + cap + rating) * 10.0) / 10.0;
    }

    private static double clamp01(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }
}
