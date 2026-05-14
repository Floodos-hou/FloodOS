package org.openagrios.hpdi.intelligence;

import java.util.*;

/**
 * TẦNG 2 (H-P-D-I CAPABILITY SPACE) — KHÔNG GIAN [I]: ĐỘNG CƠ ĐỐI SÁNH KHÔNG GIAN & CHẤM ĐIỂM ĐA TIÊU CHÍ
 * ======================================================================================================
 * Bao gồm:
 * 1. Công thức khoảng cách mặt cầu Haversine (tương đương PostGIS ST_Distance).
 * 2. Bộ sinh đa giác tọa độ địa lý chuẩn GeoJSON Polygon (RFC 7946).
 * 3. Thuật toán chấm điểm đa tiêu chí có giải thích (Explainable Multi-Criteria Scoring):
 *    Tổng điểm 100 = Sẵn sàng (30đ) + Khoảng cách (30đ) + Công suất máy (25đ) + Đánh giá nhân sự (15đ).
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

    private static double round6(double v) {
        return Math.round(v * 1_000_000.0) / 1_000_000.0;
    }

    public static double computeMultiCriteriaScore(double distKm, double capacityHaPerHr, double operatorRating) {
        double distScore = Math.max(0.0, 30.0 * (1.0 - distKm / 10.0));
        double capScore = Math.min(25.0, capacityHaPerHr * 32.0);
        double ratingScore = (operatorRating / 5.0) * 15.0;
        return Math.round((30.0 + distScore + capScore + ratingScore) * 10.0) / 10.0;
    }
}
