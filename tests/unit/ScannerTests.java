// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.tests.unit;

import static org.floodos.tests.unit.TestKit.*;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.floodos.apps.floodos.FloodDataStore;
import org.floodos.apps.floodos.FloodOSServer;
import org.floodos.apps.floodos.FloodOSService;
import org.floodos.apps.floodos.FloodOSService.HttpResult;
import org.floodos.core.dataservices.ImmutableAuditLedger;
import org.floodos.core.dataservices.MalwareScanner;
import org.floodos.core.dataservices.MalwareScanner.ScanUnavailableException;
import org.floodos.core.dataservices.SeaweedS3StorageService;
import org.floodos.core.identity.KeycloakOidcEngine.AuthContext;
import org.floodos.core.workflow.BpmnWorkflowEngine;

/** ClamAV INSTREAM client against a protocol-faithful fake clamd, and the upload gate in the incident flow. */
final class ScannerTests {

    private ScannerTests() {}

    /** The standard antivirus test string, assembled at runtime so no source file contains it (host AVs flag it). */
    static String eicar() {
        return "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS" + "-TEST-FILE!$H+H*";
    }

    /** Fake clamd: parses the real zINSTREAM framing and flags payloads containing the EICAR marker. */
    private static final class FakeClamd implements AutoCloseable {
        enum Mode { NORMAL, ERROR_REPLY, GARBAGE, SILENT, CLOSE }

        final ServerSocket server;
        volatile Mode mode = Mode.NORMAL;
        final AtomicInteger connections = new AtomicInteger();
        final AtomicInteger pings = new AtomicInteger();
        final AtomicLong lastPayloadBytes = new AtomicLong(-1);
        final AtomicInteger lastChunks = new AtomicInteger();
        volatile String lastCommand = "";

        FakeClamd() throws IOException {
            server = new ServerSocket(0);
            Thread t = new Thread(this::loop, "fake-clamd");
            t.setDaemon(true);
            t.start();
        }

        int port() {
            return server.getLocalPort();
        }

        private void loop() {
            while (!server.isClosed()) {
                try (Socket s = server.accept()) {
                    connections.incrementAndGet();
                    handle(s);
                } catch (IOException ignored) {
                    // closed
                }
            }
        }

        private void handle(Socket s) throws IOException {
            DataInputStream in = new DataInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            ByteArrayOutputStream cmd = new ByteArrayOutputStream();
            int b;
            while ((b = in.read()) > 0) cmd.write(b);
            String raw = cmd.toString(StandardCharsets.US_ASCII);
            // real clamd accepts a leading z (NUL-delimited) or n (newline-delimited) before the command name
            lastCommand = (raw.startsWith("z") || raw.startsWith("n")) ? raw.substring(1) : raw;
            if (mode == Mode.CLOSE) return;
            if ("PING".equals(lastCommand)) {
                pings.incrementAndGet();
                out.write("PONG\0".getBytes(StandardCharsets.US_ASCII));
                return;
            }
            if (!"INSTREAM".equals(lastCommand)) {
                out.write("UNKNOWN COMMAND\0".getBytes(StandardCharsets.US_ASCII));
                return;
            }
            ByteArrayOutputStream payload = new ByteArrayOutputStream();
            int chunks = 0;
            while (true) {
                int len;
                try {
                    len = in.readInt();
                } catch (EOFException e) {
                    return;
                }
                if (len == 0) break;
                byte[] chunk = new byte[len];
                in.readFully(chunk);
                payload.write(chunk);
                chunks++;
            }
            lastPayloadBytes.set(payload.size());
            lastChunks.set(chunks);
            if (mode == Mode.SILENT) {
                try {
                    Thread.sleep(5_000);
                } catch (InterruptedException ignored) {
                    // test over
                }
                return;
            }
            String reply = switch (mode) {
                case ERROR_REPLY -> "INSTREAM size limit exceeded. ERROR";
                case GARBAGE -> "what is this";
                default -> payload.toString(StandardCharsets.ISO_8859_1).contains("EICAR-STANDARD-ANTIVIRUS")
                        ? "stream: Eicar-Test-Signature FOUND" : "stream: OK";
            };
            out.write((reply + "\0").getBytes(StandardCharsets.US_ASCII));
        }

        @Override
        public void close() throws IOException {
            server.close();
        }
    }

    private static MalwareScanner scannerFor(FakeClamd f, int timeoutMs, long max) {
        return MalwareScanner.forEndpoint("127.0.0.1", f.port(), timeoutMs, max);
    }

    static void run() throws Exception {
        client();
        configuration();
        uploadGate();
    }

    // ------------------------------------------------------------------ INSTREAM client
    private static void client() throws Exception {
        suite("MalwareScanner (ClamAV INSTREAM client)");
        test("disabled scanner lets everything through and says so", () -> {
            MalwareScanner s = MalwareScanner.disabled();
            isFalse(s.isEnabled(), "disabled");
            isTrue(s.scan(eicar().getBytes(StandardCharsets.US_ASCII)).clean(), "no scanning in disabled mode");
            equal("DISABLED", s.status().get("status"), "status");
            equal("NONE", s.status().get("policy"), "policy");
        });
        test("a clean file is reported clean and counted", () -> {
            try (FakeClamd f = new FakeClamd()) {
                MalwareScanner s = scannerFor(f, 3000, 1 << 20);
                MalwareScanner.Verdict v = s.scan("hello flood relief".getBytes(StandardCharsets.UTF_8));
                isTrue(v.clean(), "clean");
                equal(1L, s.status().get("scanned"), "scanned counter");
                equal(0L, s.status().get("infected"), "infected counter");
            }
        });
        test("the EICAR test file is detected with its signature", () -> {
            try (FakeClamd f = new FakeClamd()) {
                MalwareScanner s = scannerFor(f, 3000, 1 << 20);
                MalwareScanner.Verdict v = s.scan(eicar().getBytes(StandardCharsets.US_ASCII));
                isFalse(v.clean(), "infected");
                equal("Eicar-Test-Signature", v.signature(), "signature");
                equal(1L, s.status().get("infected"), "infected counter");
            }
        });
        test("the wire protocol is zINSTREAM + length-prefixed chunks + zero terminator", () -> {
            try (FakeClamd f = new FakeClamd()) {
                scannerFor(f, 3000, 1 << 20).scan(new byte[10]);
                equal("INSTREAM", f.lastCommand, "command");
                equal(10L, f.lastPayloadBytes.get(), "all bytes delivered");
                equal(1, f.lastChunks.get(), "single chunk");
            }
        });
        test("large payloads are split into 64 KiB chunks and malware at the very end is still found", () -> {
            try (FakeClamd f = new FakeClamd()) {
                byte[] big = new byte[300_000];
                byte[] marker = eicar().getBytes(StandardCharsets.US_ASCII);
                System.arraycopy(marker, 0, big, big.length - marker.length, marker.length);
                MalwareScanner.Verdict v = scannerFor(f, 5000, 1 << 20).scan(big);
                isFalse(v.clean(), "found at the tail");
                equal(300_000L, f.lastPayloadBytes.get(), "nothing truncated");
                equal(5, f.lastChunks.get(), "ceil(300000 / 65536) chunks");
            }
        });
        test("an empty file is scanned (terminator only) and is clean", () -> {
            try (FakeClamd f = new FakeClamd()) {
                isTrue(scannerFor(f, 3000, 1 << 20).scan(new byte[0]).clean(), "clean");
                equal(0, f.lastChunks.get(), "no chunks");
            }
        });
        test("FAIL-CLOSED: no verdict is ever treated as clean", () -> {
            try (FakeClamd f = new FakeClamd()) {
                MalwareScanner s = scannerFor(f, 800, 1 << 20);
                for (FakeClamd.Mode m : new FakeClamd.Mode[]{FakeClamd.Mode.ERROR_REPLY, FakeClamd.Mode.GARBAGE, FakeClamd.Mode.CLOSE, FakeClamd.Mode.SILENT}) {
                    f.mode = m;
                    throwsA(ScanUnavailableException.class, () -> s.scan("data".getBytes(StandardCharsets.UTF_8)), "mode " + m);
                }
                isTrue(((Number) s.status().get("scan_unavailable")).longValue() >= 4, "failures are counted");
                isTrue(!String.valueOf(s.status().get("last_error")).isEmpty(), "last error is reported");
            }
        });
        test("an unreachable daemon raises ScanUnavailableException", () -> {
            MalwareScanner s = MalwareScanner.forEndpoint("127.0.0.1", 1, 500, 1 << 20);
            throwsA(ScanUnavailableException.class, () -> s.scan("x".getBytes(StandardCharsets.UTF_8)), "connection refused");
            equal("DOWN", s.status().get("status"), "health says DOWN");
        });
        test("oversized files are refused without contacting the daemon", () -> {
            try (FakeClamd f = new FakeClamd()) {
                MalwareScanner s = scannerFor(f, 3000, 1000);
                throwsA(ScanUnavailableException.class, () -> s.scan(new byte[1001]), "over the limit");
                equal(0, f.connections.get(), "no connection made");
                isTrue(s.scan(new byte[1000]).clean(), "exactly at the limit is fine");
            }
        });
        test("liveness probe uses PING, reports UP/DOWN and is cached", () -> {
            try (FakeClamd f = new FakeClamd()) {
                MalwareScanner s = scannerFor(f, 3000, 1 << 20);
                isTrue(s.probe(), "UP");
                s.probe();
                s.probe();
                equal(1, f.pings.get(), "cached for a few seconds: one PING for three probes");
                equal("UP", s.status().get("status"), "status");
            }
        });
    }

    // ------------------------------------------------------------------ configuration
    private static void configuration() {
        suite("MalwareScanner configuration");
        test("scanning is off by default and on once a host is configured", () -> {
            isFalse(MalwareScanner.fromSettings(null, null, null).isEnabled(), "nothing configured");
            isFalse(MalwareScanner.fromSettings("", "  ", null).isEnabled(), "blank host");
            isTrue(MalwareScanner.fromSettings(null, "clamav", null).isEnabled(), "host configured");
        });
        test("REQUIRED without a host is a startup error (fail-fast), with a host it is fine", () -> {
            IllegalStateException e = throwsA(IllegalStateException.class, () -> MalwareScanner.fromSettings("REQUIRED", null, null), "required, no host");
            contains(e.getMessage(), "CLAMAV_HOST", "message names the missing setting");
            throwsA(IllegalStateException.class, () -> MalwareScanner.fromSettings(" required ", "", null), "case/blank tolerant");
            isTrue(MalwareScanner.fromSettings("REQUIRED", "clamav", "3310").isEnabled(), "required + host");
        });
        test("DISABLED wins even when a host is configured", () ->
                isFalse(MalwareScanner.fromSettings("DISABLED", "clamav", null).isEnabled(), "explicitly disabled"));
        test("an invalid port falls back to 3310 instead of crashing", () ->
                isTrue(MalwareScanner.fromSettings(null, "clamav", "not-a-port").isEnabled(), "still enabled"));
    }

    // ------------------------------------------------------------------ upload gate in the incident flow
    private static FloodOSService newService(MalwareScanner scanner) {
        java.io.File bpmn = new java.io.File(FloodOSServer.resolveProjectRoot(), "infra/bpmn");
        FloodDataStore store = new FloodDataStore(new ImmutableAuditLedger(), new SeaweedS3StorageService(), new BpmnWorkflowEngine(bpmn));
        store.malwareScanner = scanner;
        return new FloodOSService(store);
    }

    private static Map<String, Object> incident(String evidenceDataUrl) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("vehicle_id", "V01");
        b.put("severity", "CRITICAL");
        b.put("incident_type", "ENGINE_FAILURE");
        b.put("description", "scanner test");
        b.put("estimated_downtime_hours", 6);
        b.put("evidence_filename", "evidence.jpg");
        if (evidenceDataUrl != null) b.put("evidence_data_url", evidenceDataUrl);
        return b;
    }

    private static String dataUrl(byte[] content) {
        return "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(content);
    }

    private static boolean auditHas(FloodOSService svc, String action) {
        return svc.getStore().auditLedger.listRecentByTenant("ORG_HN_PILOT_01", 100).stream().anyMatch(r -> action.equals(r.get("action")));
    }

    private static void uploadGate() throws Exception {
        suite("Upload gate (evidence in incident and flood reports)");
        AuthContext coord = new AuthContext("usr_team_binh", "team_binh", "ORG_HN_PILOT_01", "FIELD_TEAM");
        AuthContext reporter = new AuthContext("usr_reporter_lan", "reporter_lan", "ORG_HN_PILOT_01", "REPORTER");

        test("infected evidence is rejected with 422; nothing is stored, no incident is created, the block is audited", () -> {
            try (FakeClamd f = new FakeClamd()) {
                FloodOSService svc = newService(scannerFor(f, 3000, 1 << 20));
                int objectsBefore = svc.getStore().s3Storage.listByTenant("ORG_HN_PILOT_01").size();
                String statusBefore = svc.getStore().vehicles.get("V01").status;
                HttpResult r = svc.reportFieldIncident(coord, incident(dataUrl(eicar().getBytes(StandardCharsets.US_ASCII))));
                equal(422, r.status(), "status");
                equal("MALWARE_DETECTED", r.body().get("error"), "error code");
                equal("Eicar-Test-Signature", r.body().get("signature"), "signature reported");
                equal(0, svc.getStore().incidents.size(), "no incident created");
                equal(statusBefore, svc.getStore().vehicles.get("V01").status, "the vehicle twin is untouched");
                equal(objectsBefore, svc.getStore().s3Storage.listByTenant("ORG_HN_PILOT_01").size(), "nothing reached object storage");
                isTrue(auditHas(svc, "UPLOAD_BLOCKED_MALWARE"), "audit record written");
                equal(Boolean.TRUE, svc.getStore().auditLedger.verifyChainIntegrity().get("chain_valid"), "audit chain still valid");
            }
        });
        test("an infected photo on a citizen's flood report is rejected with 422 and no report is created", () -> {
            try (FakeClamd f = new FakeClamd()) {
                FloodOSService svc = newService(scannerFor(f, 3000, 1 << 20));
                int reportsBefore = svc.getStore().reports.size();
                Map<String, Object> b = new LinkedHashMap<>();
                b.put("lat", 20.9665); b.put("lng", 105.8712); b.put("depth_cm", 40); b.put("need_type", "EVACUATION");
                b.put("evidence_filename", "nuoc.jpg");
                b.put("evidence_data_url", dataUrl(eicar().getBytes(StandardCharsets.US_ASCII)));
                HttpResult r = svc.createFloodReport(reporter, b);
                equal(422, r.status(), "status");
                equal("MALWARE_DETECTED", r.body().get("error"), "error code");
                equal(reportsBefore, svc.getStore().reports.size(), "no report created from a refused upload");
                isTrue(auditHas(svc, "UPLOAD_BLOCKED_MALWARE"), "audited");
            }
        });
        test("only images are accepted as evidence (415), before any scan", () -> {
            try (FakeClamd f = new FakeClamd()) {
                FloodOSService svc = newService(scannerFor(f, 3000, 1 << 20));
                equal(415, svc.reportFieldIncident(coord, incident("data:application/pdf;base64," + Base64.getEncoder().encodeToString("%PDF".getBytes(StandardCharsets.US_ASCII)))).status(), "pdf");
                equal(0, f.connections.get(), "scanner untouched");
            }
        });
        test("clean evidence is accepted and stored", () -> {
            try (FakeClamd f = new FakeClamd()) {
                FloodOSService svc = newService(scannerFor(f, 3000, 1 << 20));
                HttpResult r = svc.reportFieldIncident(coord, incident(dataUrl("jpeg bytes".getBytes(StandardCharsets.UTF_8))));
                equal(201, r.status(), "accepted");
                equal(1, svc.getStore().incidents.size(), "incident created");
                equal(1, f.connections.get(), "the file was scanned");
            }
        });
        test("scanner down -> 503 fail-closed: not stored, no incident, audited", () -> {
            FloodOSService svc = newService(MalwareScanner.forEndpoint("127.0.0.1", 1, 500, 1 << 20));
            HttpResult r = svc.reportFieldIncident(coord, incident(dataUrl("jpeg".getBytes(StandardCharsets.UTF_8))));
            equal(503, r.status(), "status");
            equal("MALWARE_SCANNER_UNAVAILABLE", r.body().get("error"), "error code");
            equal(0, svc.getStore().incidents.size(), "no incident");
            isTrue(auditHas(svc, "UPLOAD_BLOCKED_SCANNER_UNAVAILABLE"), "audited");
        });
        test("malformed evidence is a 400 and never reaches the scanner", () -> {
            try (FakeClamd f = new FakeClamd()) {
                FloodOSService svc = newService(scannerFor(f, 3000, 1 << 20));
                for (String bad : new String[]{"data:text/plain,not-base64-at-all", "@@@not base64@@@", "data:image/jpeg;base64"}) {
                    equal(400, svc.reportFieldIncident(coord, incident(bad)).status(), "input: " + bad);
                }
                equal(0, f.connections.get(), "scanner untouched");
                equal(0, svc.getStore().incidents.size(), "no incident");
            }
        });
        test("evidence above the size limit is a 413", () -> {
            try (FakeClamd f = new FakeClamd()) {
                FloodOSService svc = newService(scannerFor(f, 3000, 100));
                equal(413, svc.reportFieldIncident(coord, incident(dataUrl(new byte[101]))).status(), "too large");
                equal(0, f.connections.get(), "scanner untouched");
            }
        });
        test("an incident without any attachment does not need the scanner", () -> {
            FloodOSService svc = newService(MalwareScanner.forEndpoint("127.0.0.1", 1, 500, 1 << 20));   // would be unreachable
            equal(201, svc.reportFieldIncident(coord, incident(null)).status(), "no upload, no scan");
        });
        test("with scanning disabled (standalone dev) uploads are accepted unscanned", () -> {
            FloodOSService svc = newService(MalwareScanner.disabled());
            equal(201, svc.reportFieldIncident(coord, incident(dataUrl("anything".getBytes(StandardCharsets.UTF_8)))).status(), "accepted");
        });
        test("health exposes scanner status", () -> {
            FloodOSService svc = newService(MalwareScanner.disabled());
            Map<String, Object> st = svc.getStore().malwareScanner.status();
            for (String k : new String[]{"mode", "status", "policy", "scanned", "infected", "scan_unavailable", "max_bytes"}) {
                isTrue(st.containsKey(k), "field " + k);
            }
        });
    }
}
