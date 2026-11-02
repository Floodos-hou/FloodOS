// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.core.dataservices;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Hot-path event publisher: streams domain events to the Apache Kafka event bus through the
 * Kafka REST Proxy (Karapace, Confluent REST v2 API: {@code POST /topics/{topic}}), so the Java core stays dependency-free.
 *
 * <p>Publishing is asynchronous and never blocks a transactional request. Delivery is retried with
 * backoff; events that cannot be delivered are counted and logged (never silently dropped) and are
 * surfaced through {@link #status()} on {@code /api/v1/health}.
 *
 * <p>Configuration: {@code FLOODOS_EVENT_BUS_URL} (e.g. {@code http://kafka-rest:8082}).
 * When unset the publisher is explicitly {@code DISABLED} (standalone/dev without the stack).
 */
public final class EventBusPublisher {

    public static final String TOPIC_AUDIT = "floodos.audit.v1";
    public static final String TOPIC_TELEMETRY = "floodos.telemetry.v1";

    private static final String CONTENT_TYPE = "application/vnd.kafka.json.v2+json";
    private static final int QUEUE_CAPACITY = 10_000;
    private static final int MAX_BATCH = 100;
    private static final int DEFAULT_MAX_ATTEMPTS = 5;
    private static final long DEFAULT_BACKOFF_MS = 500;

    private record Pending(String topic, String key, Map<String, Object> value) {}

    private final String baseUrl;
    private final int maxAttempts;
    private final long initialBackoffMs;
    private final HttpClient http;
    private final LinkedBlockingQueue<Pending> queue = new LinkedBlockingQueue<>(QUEUE_CAPACITY);
    private final AtomicLong published = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();
    private final AtomicLong dropped = new AtomicLong();
    private volatile String lastError = "";
    private volatile String lastSuccessAt = "";

    private EventBusPublisher(String baseUrl, int maxAttempts, long initialBackoffMs) {
        this.baseUrl = baseUrl;
        this.maxAttempts = maxAttempts;
        this.initialBackoffMs = initialBackoffMs;
        if (baseUrl == null) {
            this.http = null;
            return;
        }
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        Thread worker = new Thread(this::drainLoop, "event-bus-publisher");
        worker.setDaemon(true);
        worker.start();
    }

    public static EventBusPublisher fromEnvironment() {
        String url = System.getenv("FLOODOS_EVENT_BUS_URL");
        if (url == null || url.isBlank()) {
            return disabled();
        }
        return new EventBusPublisher(url.replaceAll("/+$", ""), DEFAULT_MAX_ATTEMPTS, DEFAULT_BACKOFF_MS);
    }

    /** Publisher bound to an explicit endpoint with tunable retry policy (tests, embedding). */
    public static EventBusPublisher forUrl(String baseUrl, int maxAttempts, long initialBackoffMs) {
        return new EventBusPublisher(baseUrl.replaceAll("/+$", ""), maxAttempts, initialBackoffMs);
    }

    /** Explicitly disabled publisher (unit/in-process tests). */
    public static EventBusPublisher disabled() {
        return new EventBusPublisher(null, DEFAULT_MAX_ATTEMPTS, DEFAULT_BACKOFF_MS);
    }

    public boolean isEnabled() {
        return baseUrl != null;
    }

    public void publish(String topic, String key, Map<String, Object> value) {
        if (!isEnabled()) {
            return;
        }
        if (!queue.offer(new Pending(topic, key, value))) {
            dropped.incrementAndGet();
            lastError = "queue_full: event dropped for topic " + topic;
            System.err.println("[EVENT-BUS] " + lastError);
        }
    }

    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("mode", isEnabled() ? "KAFKA_REST_PROXY" : "DISABLED");
        m.put("endpoint", isEnabled() ? baseUrl : "");
        m.put("topics", List.of(TOPIC_AUDIT, TOPIC_TELEMETRY));
        m.put("published", published.get());
        m.put("failed", failed.get());
        m.put("dropped", dropped.get());
        m.put("queued", queue.size());
        m.put("last_success_at", lastSuccessAt);
        m.put("last_error", lastError);
        return m;
    }

    private void drainLoop() {
        while (true) {
            try {
                Pending first = queue.poll(500, TimeUnit.MILLISECONDS);
                if (first == null) {
                    continue;
                }
                List<Pending> batch = new ArrayList<>();
                batch.add(first);
                queue.drainTo(batch, MAX_BATCH - 1);
                // The REST proxy accepts one topic per request: group the batch by topic.
                Map<String, List<Pending>> byTopic = new LinkedHashMap<>();
                for (Pending p : batch) {
                    byTopic.computeIfAbsent(p.topic(), t -> new ArrayList<>()).add(p);
                }
                byTopic.forEach(this::sendWithRetry);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            } catch (RuntimeException e) {
                lastError = "worker: " + e;
                System.err.println("[EVENT-BUS] " + lastError);
            }
        }
    }

    private void sendWithRetry(String topic, List<Pending> events) {
        StringBuilder body = new StringBuilder("{\"records\":[");
        for (int i = 0; i < events.size(); i++) {
            Pending p = events.get(i);
            if (i > 0) {
                body.append(',');
            }
            body.append("{\"key\":\"").append(JsonCodec.escape(p.key())).append("\",\"value\":")
                    .append(JsonCodec.toCanonicalJson(p.value())).append('}');
        }
        body.append("]}");

        long backoffMs = initialBackoffMs;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/topics/" + topic))
                        .timeout(Duration.ofSeconds(5))
                        .header("Content-Type", CONTENT_TYPE)
                        .header("Accept", "application/vnd.kafka.v2+json")
                        .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                        .build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() / 100 == 2) {
                    published.addAndGet(events.size());
                    lastSuccessAt = Instant.now().toString();
                    return;
                }
                lastError = "HTTP " + res.statusCode() + " from event bus: " + abbreviate(res.body());
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            }
            if (attempt < maxAttempts) {
                try {
                    Thread.sleep(backoffMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
                backoffMs *= 2;
            }
        }
        failed.addAndGet(events.size());
        System.err.println("[EVENT-BUS] giving up on " + events.size() + " event(s) for " + topic + ": " + lastError);
    }

    private static String abbreviate(String s) {
        return s == null ? "" : (s.length() > 200 ? s.substring(0, 200) + "..." : s);
    }
}
