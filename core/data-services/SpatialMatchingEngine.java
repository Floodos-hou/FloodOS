// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.core.dataservices;

import java.util.*;

/**
 * Domain-neutral geodesy and polygon helpers.
 * Haversine gives the straight-line (great-circle) distance between two points. It is NOT a road or water route.
 */
public final class SpatialMatchingEngine {

    private SpatialMatchingEngine() {}

    public static double spatialDistanceKm(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371.0;
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dp = Math.toRadians(lat2 - lat1);
        double dl = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2)
                + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        double dist = 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Math.round(dist * 100.0) / 100.0;
    }

    public static List<List<List<Double>>> makeGeoJsonPolygon(double lat, double lng, double dlat, double dlng) {
        List<List<Double>> ring = List.of(
                List.of(round6(lng - dlng), round6(lat - dlat)),
                List.of(round6(lng + dlng), round6(lat - dlat)),
                List.of(round6(lng + dlng), round6(lat + dlat)),
                List.of(round6(lng - dlng), round6(lat + dlat)),
                List.of(round6(lng - dlng), round6(lat - dlat))
        );
        return List.of(ring);
    }

    /**
     * Rectangle of the STATED area (width : height = 1.3) centred on the given point, as a GeoJSON ring. Seed polygons used
     * to get a fixed ~790 m x 620 m box whatever their area.
     */
    public static List<List<List<Double>>> polygonForArea(double lat, double lng, double areaHa) {
        double areaM2 = Math.max(areaHa, 0.01) * 10_000.0;
        double widthM = Math.sqrt(areaM2 * 1.3);
        double heightM = areaM2 / widthM;
        double dlat = (heightM / 2.0) / 111_320.0;
        double dlng = (widthM / 2.0) / (111_320.0 * Math.cos(Math.toRadians(lat)));
        return makeGeoJsonPolygon(lat, lng, dlat, dlng);
    }

    /** Planar area in hectares of a closed ring of [lng, lat] points (local equirectangular projection, shoelace). */
    public static double ringAreaHa(List<List<Double>> ring) {
        if (ring == null || ring.size() < 4) return 0.0;
        double lat0 = 0;
        for (List<Double> p : ring) lat0 += p.get(1);
        lat0 /= ring.size();
        double mx = 111_320.0 * Math.cos(Math.toRadians(lat0));
        double my = 111_320.0;
        double sum = 0;
        for (int i = 0; i < ring.size() - 1; i++) {
            double x1 = ring.get(i).get(0) * mx, y1 = ring.get(i).get(1) * my;
            double x2 = ring.get(i + 1).get(0) * mx, y2 = ring.get(i + 1).get(1) * my;
            sum += x1 * y2 - x2 * y1;
        }
        return Math.abs(sum) / 2.0 / 10_000.0;
    }

    private static double round6(double v) {
        return Math.round(v * 1_000_000.0) / 1_000_000.0;
    }
}
