# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""Unit tests for the MQTT ingestor (validation, forwarding, metrics) and the device simulator helpers."""
import json
import os
import sys
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ingestor  # noqa: E402
import simulator  # noqa: E402

TOPIC = "openagrios/HTX_CANTHO_01/machines/M01/telemetry"


def good(**over):
    base = {"ts": "2026-11-20T10:00:00Z", "lat": 10.0645, "lon": 105.5586, "fuel_pct": 78.5, "speed_kmh": 6.0}
    base.update(over)
    return json.dumps(base).encode()


class FakeCore:
    """Scriptable stand-in for the core's internal endpoint; records what it receives."""

    def __init__(self, status=200):
        self.status = status
        self.requests = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def _reply(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                outer.requests.append({"method": self.command, "path": self.path, "token": self.headers.get("X-Ingest-Token"),
                                       "body": body})
                payload = outer.response if hasattr(outer, "response") else b'{"ok":true}'
                self.send_response(outer.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            do_POST = do_GET = _reply

            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def close(self):
        self.httpd.shutdown()


def reset_stats():
    with ingestor.stats_lock:
        for k in ("received", "forwarded", "rejected_invalid", "rejected_by_core", "forward_failed", "mqtt_connected"):
            ingestor.stats[k] = 0
        ingestor.stats["last_error"] = ""


class ValidationTests(unittest.TestCase):
    def test_valid_message_is_normalised_with_tenant_and_machine_taken_from_the_topic(self):
        payload, reason = ingestor.validate(TOPIC, good())
        self.assertIsNone(reason)
        self.assertEqual("HTX_CANTHO_01", payload["organization_id"])
        self.assertEqual("M01", payload["machine_id"])
        self.assertEqual("mqtt", payload["source"])
        self.assertEqual(78.5, payload["fuel_pct"])

    def test_speed_is_optional_and_defaults_to_zero(self):
        raw = json.dumps({"ts": "2026-11-20T10:00:00Z", "lat": 1, "lon": 2, "fuel_pct": 3}).encode()
        payload, reason = ingestor.validate(TOPIC, raw)
        self.assertIsNone(reason)
        self.assertEqual(0.0, payload["speed_kmh"])

    def test_missing_timestamp_is_filled_with_server_time(self):
        raw = json.dumps({"lat": 1, "lon": 2, "fuel_pct": 3}).encode()
        payload, _ = ingestor.validate(TOPIC, raw)
        self.assertRegex(payload["ts"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_topics_that_do_not_match_the_scheme_are_rejected(self):
        bad_topics = [
            "other/HTX/machines/M01/telemetry",
            "openagrios/HTX/machines/M01/telemetry/extra",
            "openagrios/HTX/machines/M01/status",
            "openagrios//machines/M01/telemetry",
            "openagrios/HTX/machines//telemetry",
            "openagrios/../machines/M01/telemetry",
            "openagrios/HTX CANTHO/machines/M01/telemetry",
            "openagrios/HTX/machines/M01;DROP/telemetry",
            "openagrios/#/machines/M01/telemetry",
            "openagrios/+/machines/M01/telemetry",
        ]
        for t in bad_topics:
            payload, reason = ingestor.validate(t, good())
            self.assertIsNone(payload, t)
            self.assertIn("topic", reason, t)

    def test_oversized_payload_is_rejected_before_parsing(self):
        raw = good(note="x" * (ingestor.MAX_PAYLOAD_BYTES + 1))
        _, reason = ingestor.validate(TOPIC, raw)
        self.assertIn("too large", reason)

    def test_non_json_and_non_object_payloads_are_rejected(self):
        self.assertIn("not valid JSON", ingestor.validate(TOPIC, b"not-json")[1])
        self.assertIn("not valid JSON", ingestor.validate(TOPIC, b"\xff\xfe")[1])
        self.assertIn("must be a JSON object", ingestor.validate(TOPIC, b"[1,2,3]")[1])
        self.assertIn("must be a JSON object", ingestor.validate(TOPIC, b'"text"')[1])

    def test_payload_cannot_claim_a_different_tenant_or_machine_than_its_topic(self):
        _, reason = ingestor.validate(TOPIC, good(organization_id="HTX_SOCTRANG_02"))
        self.assertIn("organization_id", reason)
        _, reason = ingestor.validate(TOPIC, good(machine_id="M99"))
        self.assertIn("machine_id", reason)
        payload, reason = ingestor.validate(TOPIC, good(organization_id="HTX_CANTHO_01", machine_id="M01"))
        self.assertIsNone(reason, "matching claims are fine")

    def test_required_numeric_fields_must_be_finite_numbers(self):
        for field in ("lat", "lon", "fuel_pct"):
            for bad in (None, "10.5", True, [1], {"v": 1}):
                _, reason = ingestor.validate(TOPIC, good(**{field: bad}))
                self.assertIn(field, reason, f"{field}={bad!r}")
        for lit in (b"NaN", b"Infinity", b"-Infinity"):
            raw = b'{"lat": ' + lit + b', "lon": 1, "fuel_pct": 2}'
            self.assertIn("lat", ingestor.validate(TOPIC, raw)[1], lit)

    def test_missing_required_field_is_rejected(self):
        data = json.loads(good())
        del data["fuel_pct"]
        _, reason = ingestor.validate(TOPIC, json.dumps(data).encode())
        self.assertIn("fuel_pct", reason)

    def test_speed_when_present_must_be_a_number(self):
        _, reason = ingestor.validate(TOPIC, good(speed_kmh="fast"))
        self.assertIn("speed_kmh", reason)

    def test_timestamp_must_be_iso8601(self):
        _, reason = ingestor.validate(TOPIC, good(ts="yesterday"))
        self.assertIn("ts", reason)
        self.assertIsNone(ingestor.validate(TOPIC, good(ts="2026-11-20T10:00:00+07:00"))[1])

    def test_range_checking_is_deliberately_left_to_the_core(self):
        payload, reason = ingestor.validate(TOPIC, good(lat=999))
        self.assertIsNone(reason, "the core is the single authority on domain ranges")
        self.assertEqual(999, payload["lat"])


class ForwardingTests(unittest.TestCase):
    def setUp(self):
        reset_stats()
        self.core = FakeCore()
        self._old = (ingestor.CORE_URL, ingestor.INGEST_TOKEN)
        ingestor.CORE_URL, ingestor.INGEST_TOKEN = self.core.url, "secret-token"

    def tearDown(self):
        ingestor.CORE_URL, ingestor.INGEST_TOKEN = self._old
        self.core.close()

    def message(self, topic=TOPIC, payload=None):
        return SimpleNamespace(topic=topic, payload=payload if payload is not None else good())

    def test_valid_message_is_posted_with_the_shared_secret(self):
        ingestor.on_message(None, None, self.message())
        self.assertEqual(1, ingestor.stats["forwarded"])
        req = self.core.requests[0]
        self.assertEqual("/api/v1/internal/telemetry", req["path"])
        self.assertEqual("secret-token", req["token"])
        body = json.loads(req["body"])
        self.assertEqual("M01", body["machine_id"])
        self.assertEqual("HTX_CANTHO_01", body["organization_id"])

    def test_invalid_messages_never_reach_the_core(self):
        ingestor.on_message(None, None, self.message(payload=b"not-json"))
        ingestor.on_message(None, None, self.message(topic="bad/topic"))
        self.assertEqual(0, len(self.core.requests))
        self.assertEqual(2, ingestor.stats["rejected_invalid"])
        self.assertEqual(2, ingestor.stats["received"])
        self.assertTrue(ingestor.stats["last_error"], "rejections are recorded, not silent")

    def test_core_client_errors_are_counted_as_rejected_by_core(self):
        self.core.status = 409
        ingestor.on_message(None, None, self.message())
        self.assertEqual(1, ingestor.stats["rejected_by_core"])
        self.assertEqual(0, ingestor.stats["forwarded"])

    def test_core_server_errors_are_counted_as_forward_failures(self):
        self.core.status = 503
        ingestor.on_message(None, None, self.message())
        self.assertEqual(1, ingestor.stats["forward_failed"])
        self.assertEqual(0, ingestor.stats["rejected_by_core"])

    def test_unreachable_core_is_a_forward_failure_not_a_crash(self):
        ingestor.CORE_URL = "http://127.0.0.1:1"
        ingestor.on_message(None, None, self.message())
        self.assertEqual(1, ingestor.stats["forward_failed"])

    def test_every_outcome_is_accounted_for(self):
        ingestor.on_message(None, None, self.message())
        ingestor.on_message(None, None, self.message(payload=b"x"))
        self.core.status = 409
        ingestor.on_message(None, None, self.message())
        s = ingestor.stats
        self.assertEqual(s["received"], s["forwarded"] + s["rejected_invalid"] + s["rejected_by_core"] + s["forward_failed"])


class OperationalTests(unittest.TestCase):
    def setUp(self):
        reset_stats()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), ingestor.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()

    def get(self, path):
        import urllib.error
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def test_health_is_degraded_until_the_broker_is_connected(self):
        status, body = self.get("/health")
        self.assertEqual(503, status)
        self.assertEqual("DEGRADED", json.loads(body)["status"])
        ingestor.stats["mqtt_connected"] = 1
        status, body = self.get("/health")
        self.assertEqual(200, status)
        self.assertEqual("UP", json.loads(body)["status"])

    def test_metrics_expose_every_counter_in_prometheus_format(self):
        ingestor.stats["forwarded"] = 5
        _, text = self.get("/metrics")
        for name in ("received", "forwarded", "rejected_invalid", "rejected_by_core", "forward_failed"):
            self.assertIn(f"# TYPE openagrios_telemetry_{name}_total counter", text)
        self.assertIn("openagrios_telemetry_forwarded_total 5", text)
        self.assertIn("openagrios_telemetry_mqtt_connected 0", text)

    def test_unknown_path_is_404(self):
        self.assertEqual(404, self.get("/secrets")[0])

    def test_ingestor_fails_fast_without_its_secrets(self):
        saved = (ingestor.INGEST_TOKEN, ingestor.MQTT_USER, ingestor.MQTT_PASSWORD)
        try:
            ingestor.INGEST_TOKEN, ingestor.MQTT_USER, ingestor.MQTT_PASSWORD = "", "u", "p"
            with self.assertRaises(SystemExit) as ctx:
                ingestor.main()
            self.assertIn("INGEST_TOKEN", str(ctx.exception))
            ingestor.INGEST_TOKEN, ingestor.MQTT_USER = "t", ""
            with self.assertRaises(SystemExit) as ctx:
                ingestor.main()
            self.assertIn("MQTT_USER", str(ctx.exception))
        finally:
            ingestor.INGEST_TOKEN, ingestor.MQTT_USER, ingestor.MQTT_PASSWORD = saved


class SimulatorTests(unittest.TestCase):
    def test_metres_between_matches_geodesy(self):
        self.assertEqual(0.0, simulator.metres_between(10, 105, 10, 105))
        self.assertAlmostEqual(111.32, simulator.metres_between(10.0, 105.0, 10.001, 105.0), delta=0.5)
        self.assertAlmostEqual(
            simulator.metres_between(10, 105, 10.002, 105.003), simulator.metres_between(10.002, 105.003, 10, 105), places=6)

    def test_longitude_degrees_shrink_with_latitude(self):
        equator = simulator.metres_between(0, 105, 0, 105.001)
        cantho = simulator.metres_between(10, 105, 10, 105.001)
        self.assertLess(cantho, equator)

    def test_fleet_roster_is_fetched_with_the_ingest_token(self):
        core = FakeCore()
        core.response = json.dumps({"machines": [{"machine_id": "M01", "organization_id": "O", "status": "IDLE",
                                                   "lat": 1.0, "lon": 2.0, "fuel_pct": 50.0}]}).encode()
        old = (simulator.CORE_URL, simulator.INGEST_TOKEN)
        simulator.CORE_URL, simulator.INGEST_TOKEN = core.url, "tok"
        try:
            fleet = simulator.fetch_fleet()
        finally:
            simulator.CORE_URL, simulator.INGEST_TOKEN = old
            core.close()
        self.assertEqual("M01", fleet[0]["machine_id"])
        self.assertEqual("tok", core.requests[0]["token"])
        self.assertEqual("/api/v1/internal/fleet", core.requests[0]["path"])

    def test_advance_moves_along_the_heading_at_the_expected_distance(self):
        m = {"lat": 10.0, "lon": 105.0, "heading": 0.0, "fuel_pct": 50.0}
        speed = simulator.advance(m, interval_s=2, timelapse=1, turn_deg=0)
        self.assertEqual(simulator.WORKING_SPEED_KMH, speed)
        # 6 km/h for 2 s = 3.33 m due north
        self.assertAlmostEqual(3.33, simulator.metres_between(10.0, 105.0, m["lat"], m["lon"]), delta=0.05)
        self.assertAlmostEqual(105.0, m["lon"], places=9)
        self.assertLess(m["fuel_pct"], 50.0)

    def test_timelapse_multiplies_distance_but_caps_the_reported_speed(self):
        slow = {"lat": 10.0, "lon": 105.0, "heading": 90.0, "fuel_pct": 50.0}
        fast = dict(slow)
        simulator.advance(slow, 2, 1, 0)
        reported = simulator.advance(fast, 2, 12, 0)
        d_slow = simulator.metres_between(10.0, 105.0, slow["lat"], slow["lon"])
        d_fast = simulator.metres_between(10.0, 105.0, fast["lat"], fast["lon"])
        self.assertAlmostEqual(12.0, d_fast / d_slow, delta=0.05)
        self.assertEqual(72.0, reported)
        self.assertEqual(simulator.MAX_REPORTED_SPEED_KMH, simulator.advance(dict(slow), 2, 50, 0),
                         "the core rejects speeds above 80 km/h, so the report is capped")

    def test_fuel_never_drops_below_the_floor(self):
        m = {"lat": 10.0, "lon": 105.0, "heading": 0.0, "fuel_pct": 5.01}
        for _ in range(10):
            simulator.advance(m, 2, 1, 0)
        self.assertEqual(5.0, m["fuel_pct"])

    def test_simulator_fails_fast_without_credentials(self):
        saved = (simulator.INGEST_TOKEN, simulator.MQTT_USER, simulator.MQTT_PASSWORD)
        try:
            simulator.INGEST_TOKEN = simulator.MQTT_USER = simulator.MQTT_PASSWORD = ""
            with self.assertRaises(SystemExit):
                simulator.main()
        finally:
            simulator.INGEST_TOKEN, simulator.MQTT_USER, simulator.MQTT_PASSWORD = saved


if __name__ == "__main__":
    unittest.main(verbosity=2)
