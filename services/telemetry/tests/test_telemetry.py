# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors
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

TOPIC = "floodos/ORG_HN_PILOT_01/vehicles/V01/telemetry"
GAUGE_TOPIC = "floodos/ORG_HN_PILOT_01/gauges/G01/telemetry"


def good(**over):
    base = {"ts": "2026-11-20T10:00:00Z", "lat": 20.9668, "lon": 105.8718, "fuel_pct": 78.5, "speed_kmh": 6.0,
            "source": "SIMULATOR"}
    base.update(over)
    return json.dumps({k: v for k, v in base.items() if v is not DROP}).encode()


DROP = object()


def good_gauge(**over):
    base = {"ts": "2026-11-20T10:00:00Z", "level_cm": 62.5, "source": "SIMULATOR"}
    base.update(over)
    return json.dumps({k: v for k, v in base.items() if v is not DROP}).encode()


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
    def test_valid_message_is_normalised_with_tenant_and_asset_taken_from_the_topic(self):
        payload, reason = ingestor.validate(TOPIC, good())
        self.assertIsNone(reason)
        self.assertEqual("ORG_HN_PILOT_01", payload["organization_id"])
        self.assertEqual("V01", payload["asset_id"])
        self.assertEqual("vehicle", payload["asset_kind"])
        self.assertEqual("SIMULATOR", payload["source"])
        self.assertEqual(78.5, payload["fuel_pct"])

    def test_a_message_must_declare_where_it_comes_from(self):
        for bad in (DROP, "", "mqtt", "simulator", "OFFICIAL", None, 1):
            payload, reason = ingestor.validate(TOPIC, good(source=bad))
            self.assertIsNone(payload, f"source={bad!r} must be refused")
            self.assertIn("source", reason)
        for ok in ("SIMULATOR", "DEVICE"):
            self.assertIsNone(ingestor.validate(TOPIC, good(source=ok))[1])

    def test_gauge_message_is_validated_with_its_own_fields(self):
        payload, reason = ingestor.validate(GAUGE_TOPIC, good_gauge())
        self.assertIsNone(reason)
        self.assertEqual("gauge", payload["asset_kind"])
        self.assertEqual("G01", payload["asset_id"])
        self.assertEqual(62.5, payload["level_cm"])
        self.assertNotIn("lat", payload)
        for bad in (None, "62", True, [1]):
            _, reason = ingestor.validate(GAUGE_TOPIC, good_gauge(level_cm=bad))
            self.assertIn("level_cm", reason, f"level_cm={bad!r}")
        self.assertIn("level_cm", ingestor.validate(GAUGE_TOPIC, good_gauge(level_cm=DROP))[1])
        self.assertIn("source", ingestor.validate(GAUGE_TOPIC, good_gauge(source=DROP))[1])

    def test_speed_is_optional_and_defaults_to_zero(self):
        raw = json.dumps({"ts": "2026-11-20T10:00:00Z", "lat": 1, "lon": 2, "fuel_pct": 3, "source": "SIMULATOR"}).encode()
        payload, reason = ingestor.validate(TOPIC, raw)
        self.assertIsNone(reason)
        self.assertEqual(0.0, payload["speed_kmh"])

    def test_missing_timestamp_is_filled_with_server_time(self):
        raw = json.dumps({"lat": 1, "lon": 2, "fuel_pct": 3, "source": "SIMULATOR"}).encode()
        payload, _ = ingestor.validate(TOPIC, raw)
        self.assertRegex(payload["ts"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_topics_that_do_not_match_the_scheme_are_rejected(self):
        bad_topics = [
            "other/BCH_PCTT_HN/vehicles/V01/telemetry",
            "floodos/BCH_PCTT_HN/vehicles/V01/telemetry/extra",
            "floodos/BCH_PCTT_HN/vehicles/V01/status",
            "floodos//vehicles/V01/telemetry",
            "floodos/BCH_PCTT_HN/vehicles//telemetry",
            "floodos/../vehicles/V01/telemetry",
            "floodos/BCH ORG/vehicles/V01/telemetry",
            "floodos/BCH_PCTT_HN/vehicles/V01;DROP/telemetry",
            "floodos/#/vehicles/V01/telemetry",
            "floodos/+/vehicles/V01/telemetry",
            "floodos/BCH_PCTT_HN/machines/M01/telemetry",   # the former per-machine topic family no longer exists
            "floodos/BCH_PCTT_HN/sensors/S01/telemetry",
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

    def test_payload_cannot_claim_a_different_tenant_or_asset_than_its_topic(self):
        _, reason = ingestor.validate(TOPIC, good(organization_id="ORG_HN_PILOT_02"))
        self.assertIn("organization_id", reason)
        _, reason = ingestor.validate(TOPIC, good(asset_id="V99"))
        self.assertIn("asset_id", reason)
        payload, reason = ingestor.validate(TOPIC, good(organization_id="ORG_HN_PILOT_01", asset_id="V01"))
        self.assertIsNone(reason, "matching claims are fine")

    def test_required_numeric_fields_must_be_finite_numbers(self):
        for field in ("lat", "lon", "fuel_pct"):
            for bad in (None, "10.5", True, [1], {"v": 1}):
                _, reason = ingestor.validate(TOPIC, good(**{field: bad}))
                self.assertIn(field, reason, f"{field}={bad!r}")
        for lit in (b"NaN", b"Infinity", b"-Infinity"):
            raw = b'{"source": "SIMULATOR", "lat": ' + lit + b', "lon": 1, "fuel_pct": 2}'
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
        self.assertEqual("V01", body["asset_id"])
        self.assertEqual("vehicle", body["asset_kind"])
        self.assertEqual("SIMULATOR", body["source"])
        self.assertEqual("ORG_HN_PILOT_01", body["organization_id"])

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
            self.assertIn(f"# TYPE floodos_telemetry_{name}_total counter", text)
        self.assertIn("floodos_telemetry_forwarded_total 5", text)
        self.assertIn("floodos_telemetry_mqtt_connected 0", text)

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
        hanoi = simulator.metres_between(21, 105, 21, 105.001)
        self.assertLess(hanoi, equator)

    def test_asset_roster_is_fetched_with_the_ingest_token(self):
        core = FakeCore()
        core.response = json.dumps({"assets": [{"asset_kind": "vehicle", "asset_id": "V01", "organization_id": "O",
                                                 "status": "IDLE", "lat": 1.0, "lon": 2.0, "fuel_pct": 50.0}]}).encode()
        old = (simulator.CORE_URL, simulator.INGEST_TOKEN)
        simulator.CORE_URL, simulator.INGEST_TOKEN = core.url, "tok"
        try:
            assets = simulator.fetch_assets()
        finally:
            simulator.CORE_URL, simulator.INGEST_TOKEN = old
            core.close()
        self.assertEqual("V01", assets[0]["asset_id"])
        self.assertEqual("tok", core.requests[0]["token"])
        self.assertEqual("/api/v1/internal/assets", core.requests[0]["path"])

    def test_every_simulated_message_declares_its_source(self):
        self.assertEqual("SIMULATOR", simulator.SOURCE)

    def test_vehicle_moves_in_a_straight_line_toward_its_target(self):
        v = {"lat": 20.9668, "lon": 105.8718, "fuel_pct": 50.0, "target_lat": 20.9768, "target_lon": 105.8718}
        speed = simulator.advance_vehicle(v, interval_s=2, timelapse=1)
        self.assertEqual(simulator.TRAVEL_SPEED_KMH, speed)
        # 12 km/h for 2 s = 6.67 m due north, longitude unchanged
        self.assertAlmostEqual(6.67, simulator.metres_between(20.9668, 105.8718, v["lat"], v["lon"]), delta=0.1)
        self.assertAlmostEqual(105.8718, v["lon"], places=9)
        self.assertLess(v["fuel_pct"], 50.0)

    def test_vehicle_without_a_target_does_not_move(self):
        v = {"lat": 20.9668, "lon": 105.8718, "fuel_pct": 50.0, "target_lat": None, "target_lon": None}
        self.assertEqual(0.0, simulator.advance_vehicle(v, 2, 12))
        self.assertEqual((20.9668, 105.8718, 50.0), (v["lat"], v["lon"], v["fuel_pct"]))

    def test_vehicle_stops_inside_the_arrival_radius_and_never_overshoots(self):
        near = {"lat": 20.9668, "lon": 105.8718, "fuel_pct": 50.0, "target_lat": 20.96683, "target_lon": 105.8718}
        self.assertEqual(0.0, simulator.advance_vehicle(near, 2, 1), "already within 30 m")
        v = {"lat": 20.9668, "lon": 105.8718, "fuel_pct": 50.0, "target_lat": 20.9672, "target_lon": 105.8718}
        for _ in range(500):
            simulator.advance_vehicle(v, 2, 12)
        self.assertLessEqual(simulator.metres_between(v["lat"], v["lon"], 20.9672, 105.8718), simulator.ARRIVAL_RADIUS_M)
        self.assertLessEqual(v["lat"], 20.9672 + 1e-9, "never passes the target")

    def test_timelapse_multiplies_distance_but_caps_the_reported_speed(self):
        base = {"lat": 20.9, "lon": 105.8, "fuel_pct": 50.0, "target_lat": 21.5, "target_lon": 105.8}
        slow, fast = dict(base), dict(base)
        simulator.advance_vehicle(slow, 2, 1)
        reported = simulator.advance_vehicle(fast, 2, 5)
        d_slow = simulator.metres_between(20.9, 105.8, slow["lat"], slow["lon"])
        d_fast = simulator.metres_between(20.9, 105.8, fast["lat"], fast["lon"])
        self.assertAlmostEqual(5.0, d_fast / d_slow, delta=0.05)
        self.assertEqual(60.0, reported)
        self.assertEqual(simulator.MAX_REPORTED_SPEED_KMH, simulator.advance_vehicle(dict(base), 2, 50),
                         "the core rejects speeds above 80 km/h, so the report is capped")

    def test_fuel_never_drops_below_the_floor(self):
        v = {"lat": 20.9, "lon": 105.8, "fuel_pct": 5.01, "target_lat": 21.5, "target_lon": 105.8}
        for _ in range(10):
            simulator.advance_vehicle(v, 2, 1)
        self.assertEqual(5.0, v["fuel_pct"])

    def test_gauge_level_stays_inside_its_bounds(self):
        g = {"level_cm": 60.0, "warn_level_cm": 80.0, "critical_level_cm": 120.0}
        for _ in range(5000):
            simulator.advance_gauge(g, 12)
            self.assertGreaterEqual(g["level_cm"], 0.0)
            self.assertLessEqual(g["level_cm"], 120.0 * 1.3 + 1e-9)

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
