// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.dataservices;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Read-side client of the cold analytics tier. The lake-archiver service stores history as Parquet on
 * object storage and answers analytical queries with DuckDB; this core service is the only caller and
 * injects the tenant ({@code org}) from the verified token, so tenants never choose their own scope.
 *
 * <p>Configuration: {@code OPENAGRIOS_ANALYTICS_URL} (e.g. {@code http://lake-archiver:8090}).
 */
public final class AnalyticsLakeClient {

    /** Whitelist of analytical queries exposed through {@code /api/v1/analytics/{name}}. */
    public static final Set<String> QUERIES = Set.of("summary", "actions-by-day", "machine-utilization");

    private final String baseUrl;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    public AnalyticsLakeClient() {
        String url = System.getenv("OPENAGRIOS_ANALYTICS_URL");
        this.baseUrl = (url == null || url.isBlank()) ? null : url.replaceAll("/+$", "");
    }

    public boolean isConfigured() {
        return baseUrl != null;
    }

    public String getBaseUrl() {
        return baseUrl == null ? "" : baseUrl;
    }

    /** Returns {@code [httpStatus, body]}; status 503 when the cold tier is not configured or unreachable. */
    public Result query(String name, String orgId) {
        if (!QUERIES.contains(name)) {
            return new Result(404, error("unknown_query", "Unknown analytics query: " + name));
        }
        if (baseUrl == null) {
            return new Result(503, error("analytics_disabled",
                    "Cold analytics tier is not configured (OPENAGRIOS_ANALYTICS_URL is unset)."));
        }
        try {
            URI uri = URI.create(baseUrl + "/analytics/" + name + "?org="
                    + URLEncoder.encode(orgId, StandardCharsets.UTF_8));
            HttpResponse<String> res = http.send(
                    HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            Map<String, Object> body = JsonCodec.parseObject(res.body());
            return new Result(res.statusCode(), body);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return new Result(503, error("analytics_interrupted", "Interrupted while querying the lake."));
        } catch (Exception e) {
            return new Result(503, error("analytics_unreachable", e.getClass().getSimpleName() + ": " + e.getMessage()));
        }
    }

    /** Lightweight liveness probe used by {@code /api/v1/health}. */
    public String probe() {
        if (baseUrl == null) {
            return "DISABLED";
        }
        try {
            HttpResponse<String> res = http.send(
                    HttpRequest.newBuilder(URI.create(baseUrl + "/health")).timeout(Duration.ofSeconds(2)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            return res.statusCode() == 200 ? "UP" : "DEGRADED (HTTP " + res.statusCode() + ")";
        } catch (Exception e) {
            return "DOWN";
        }
    }

    private static Map<String, Object> error(String code, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", code);
        m.put("message", message);
        return m;
    }

    public record Result(int status, Map<String, Object> body) {}
}
