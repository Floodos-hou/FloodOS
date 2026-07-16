# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""Unit tests for the cold-tier archiver, run against real DuckDB + real Parquet files in a temp directory."""
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import archiver  # noqa: E402


def audit_event(event_id="EVT-2026-0001", epoch="E1", org="ORG_A", corr="CORR-1", action="CREATE",
                created="2026-11-20T09:15:00Z", seq=1):
    return {
        "event_id": event_id, "ledger_epoch": epoch, "seq_no": seq, "organization_id": org,
        "correlation_id": corr, "entity_type": "ServiceRequest", "entity_id": "REQ-1", "action": action,
        "actor_user_id": "alice", "actor_role": "COORDINATOR", "gateway_status": 200,
        "before_state": {"b": 1}, "after_state": {"a": 2}, "prev_hash": "0" * 64, "record_hash": "f" * 64,
        "created_at": created,
    }


def telemetry_event(machine="M01", org="ORG_A", ts="2026-11-20T10:00:00Z", lat=10.0, lon=105.0, fuel=80.0, speed=5.0):
    return {"machine_id": machine, "organization_id": org, "ts": ts, "lat": lat, "lon": lon,
            "fuel_pct": fuel, "speed_kmh": speed, "status": "WORKING", "source": "mqtt"}


class LakeTestCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="lake-test-")
        self._old_root = archiver.LAKE_ROOT
        archiver.LAKE_ROOT = self.root
        self.con = archiver.root.cursor()

    def tearDown(self):
        archiver.LAKE_ROOT = self._old_root
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, table, events):
        now = datetime(2026, 11, 20, 12, 0, 0)
        builder = archiver.ROW_BUILDERS[table]
        return archiver.write_parquet(self.con, table, [builder(e, now) for e in events])

    def query(self, name, org="ORG_A"):
        return archiver.run_query(name, org)


class TimestampAndRowTests(unittest.TestCase):
    def test_parse_ts_normalises_to_naive_utc(self):
        self.assertEqual(datetime(2026, 11, 20, 9, 15), archiver.parse_ts("2026-11-20T09:15:00Z"))
        self.assertEqual(datetime(2026, 11, 20, 2, 15), archiver.parse_ts("2026-11-20T09:15:00+07:00"))

    def test_parse_ts_empty_is_none_and_garbage_raises(self):
        self.assertIsNone(archiver.parse_ts(None))
        self.assertIsNone(archiver.parse_ts(""))
        with self.assertRaises(ValueError):
            archiver.parse_ts("not-a-date")

    def test_audit_row_serialises_states_with_sorted_keys(self):
        ev = audit_event()
        ev["after_state"] = {"z": 1, "a": 2}
        row = archiver.audit_row(ev, datetime(2026, 1, 1))
        self.assertEqual('{"a": 2, "z": 1}', row[12])
        self.assertEqual(len(archiver.AUDIT_COLUMNS), len(row))

    def test_audit_row_defaults_missing_epoch_to_empty_string(self):
        ev = audit_event()
        del ev["ledger_epoch"]
        self.assertEqual("", archiver.audit_row(ev, datetime(2026, 1, 1))[1])

    def test_telemetry_row_shape_and_default_source(self):
        ev = telemetry_event()
        del ev["source"]
        row = archiver.telemetry_row(ev, datetime(2026, 1, 1))
        self.assertEqual(len(archiver.TELEMETRY_COLUMNS), len(row))
        self.assertEqual("unknown", row[8])

    def test_audit_row_rejects_unparseable_timestamp(self):
        with self.assertRaises(ValueError):
            archiver.audit_row(audit_event(created="yesterday"), datetime(2026, 1, 1))


class QueryTests(LakeTestCase):
    def test_empty_lake_is_a_valid_empty_answer_not_an_error(self):
        for name in ("actions-by-day", "machine-utilization"):
            status, body = self.query(name)
            self.assertEqual(200, status, name)
            self.assertTrue(body["lake_empty"], name)
            self.assertEqual([], body["rows"], name)

    def test_unknown_query_is_404(self):
        self.write("audit", [audit_event()])
        status, body = self.query("drop-everything")
        self.assertEqual(404, status)
        self.assertEqual("unknown_query", body["error"])

    def test_actions_by_day_groups_per_day_and_action(self):
        self.write("audit", [
            audit_event("E1", action="CREATE", created="2026-11-20T08:00:00Z"),
            audit_event("E2", action="CREATE", created="2026-11-20T09:00:00Z", seq=2),
            audit_event("E3", action="DISPATCH", created="2026-11-20T10:00:00Z", seq=3),
            audit_event("E4", action="CREATE", created="2026-11-21T10:00:00Z", seq=4),
        ])
        status, body = self.query("actions-by-day")
        self.assertEqual(200, status)
        got = {(r["day"][:10], r["action"]): r["events"] for r in body["rows"]}
        self.assertEqual({("2026-11-20", "CREATE"): 2, ("2026-11-20", "DISPATCH"): 1, ("2026-11-21", "CREATE"): 1}, got)

    def test_replayed_events_are_deduplicated(self):
        ev = audit_event("EVT-1", epoch="E1")
        self.write("audit", [ev])
        self.write("audit", [ev])  # at-least-once redelivery writes the same event into a second file
        status, body = self.query("summary")
        self.assertEqual(1, body["audit"]["events"])

    def test_same_event_id_in_a_new_ledger_epoch_is_a_different_event(self):
        self.write("audit", [audit_event("EVT-1", epoch="E1"), audit_event("EVT-1", epoch="E2")])
        _, body = self.query("summary")
        self.assertEqual(2, body["audit"]["events"], "simulator reset restarts ids; epochs keep them apart")

    def test_tenants_are_isolated(self):
        self.write("audit", [audit_event("A1", org="ORG_A"), audit_event("B1", org="ORG_B", corr="CORR-B", seq=2),
                             audit_event("B2", org="ORG_B", corr="CORR-B", seq=3)])
        self.write("telemetry", [telemetry_event("M-A", org="ORG_A"), telemetry_event("M-B", org="ORG_B")])
        _, a = self.query("summary", "ORG_A")
        _, b = self.query("summary", "ORG_B")
        self.assertEqual(1, a["audit"]["events"])
        self.assertEqual(2, b["audit"]["events"])
        _, util_a = self.query("machine-utilization", "ORG_A")
        self.assertEqual(["M-A"], [r["machine_id"] for r in util_a["rows"]])
        _, none = self.query("summary", "ORG_NOBODY")
        self.assertEqual(0, none["audit"]["events"])

    def test_org_value_is_bound_as_a_parameter_not_interpolated(self):
        self.write("audit", [audit_event("A1", org="ORG_A")])
        status, body = self.query("summary", "x' OR '1'='1")
        self.assertEqual(200, status)
        self.assertEqual(0, body["audit"]["events"], "SQL-injection style tenant sees nothing")

    def test_summary_without_telemetry_reports_zero_samples(self):
        self.write("audit", [audit_event()])
        _, body = self.query("summary")
        self.assertEqual(0, body["telemetry"]["samples"])
        self.assertIn("archiver", body)

    def test_machine_utilization_computes_haversine_distance_per_machine(self):
        # 0.001 deg of latitude = 111.19 m; three points -> two 111.19 m legs
        self.write("telemetry", [
            telemetry_event("M01", ts="2026-11-20T10:00:00Z", lat=10.000, fuel=80),
            telemetry_event("M01", ts="2026-11-20T10:00:02Z", lat=10.001, fuel=79),
            telemetry_event("M01", ts="2026-11-20T10:00:04Z", lat=10.002, fuel=78),
            telemetry_event("M02", ts="2026-11-20T10:00:00Z", lat=9.0, fuel=60, speed=0),
            telemetry_event("M02", ts="2026-11-20T10:00:02Z", lat=9.0, fuel=60, speed=0),
        ])
        _, body = self.query("machine-utilization")
        rows = {r["machine_id"]: r for r in body["rows"]}
        self.assertEqual(3, rows["M01"]["samples"])
        self.assertAlmostEqual(0.222, rows["M01"]["distance_km"], places=2)
        self.assertEqual(78.0, rows["M01"]["min_fuel_pct"])
        self.assertEqual(0.0, rows["M02"]["distance_km"], "a stationary machine travels no distance")
        self.assertEqual("M01", body["rows"][0]["machine_id"], "ordered by distance descending")

    def test_machine_utilization_orders_samples_by_time_not_arrival(self):
        self.write("telemetry", [
            telemetry_event("M01", ts="2026-11-20T10:00:04Z", lat=10.002),
            telemetry_event("M01", ts="2026-11-20T10:00:00Z", lat=10.000),
            telemetry_event("M01", ts="2026-11-20T10:00:02Z", lat=10.001),
        ])
        _, body = self.query("machine-utilization")
        self.assertAlmostEqual(0.222, body["rows"][0]["distance_km"], places=2)


class FlushTests(LakeTestCase):
    class FakeConsumer:
        def __init__(self):
            self.commits = []

        def commit(self, offsets):
            self.commits.append(dict(offsets))

    def setUp(self):
        super().setUp()
        with archiver.state_lock:
            archiver.state["rows_archived"] = {"audit": 0, "telemetry": 0}
            archiver.state["files_written"] = 0
            archiver.state["rejected_events"] = 0

    def test_offsets_are_committed_only_after_the_files_are_written(self):
        consumer = self.FakeConsumer()
        archiver.flush(self.con, consumer, {"audit": [audit_event()], "telemetry": []}, {("openagrios.audit.v1", 0): 41})
        self.assertEqual([{("openagrios.audit.v1", 0): 41}], consumer.commits)
        self.assertEqual(1, self.query("summary")[1]["audit"]["events"])
        self.assertEqual(1, archiver.state["rows_archived"]["audit"])

    def test_a_failed_write_does_not_commit_so_the_batch_is_redelivered(self):
        consumer = self.FakeConsumer()
        original = archiver.write_parquet
        archiver.write_parquet = lambda *a, **k: (_ for _ in ()).throw(IOError("object storage down"))
        try:
            with self.assertRaises(IOError):
                archiver.flush(self.con, consumer, {"audit": [audit_event()], "telemetry": []}, {("t", 0): 7})
        finally:
            archiver.write_parquet = original
        self.assertEqual([], consumer.commits, "at-least-once: never commit before the data is durable")

    def test_one_malformed_event_is_counted_and_does_not_block_the_batch(self):
        consumer = self.FakeConsumer()
        bad = audit_event("BAD", created="not-a-date")
        archiver.flush(self.con, consumer, {"audit": [audit_event("OK"), bad], "telemetry": []}, {("t", 0): 2})
        self.assertEqual(1, self.query("summary")[1]["audit"]["events"])
        self.assertEqual(1, archiver.state["rejected_events"])
        self.assertEqual(1, len(consumer.commits), "poison message must not wedge the partition")

    def test_empty_batch_writes_no_file(self):
        consumer = self.FakeConsumer()
        archiver.flush(self.con, consumer, {"audit": [], "telemetry": []}, {})
        self.assertEqual(0, archiver.state["files_written"])

    def test_files_are_hive_partitioned_by_day(self):
        key = self.write("audit", [audit_event()])
        self.assertRegex(key, r"^audit/dt=\d{4}-\d{2}-\d{2}/part-\d+-[0-9a-f]{6}\.parquet$")
        self.assertTrue(os.path.exists(os.path.join(self.root, key)))


class HttpApiTests(LakeTestCase):
    def setUp(self):
        super().setUp()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), archiver.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        super().tearDown()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=10) as r:
                return r.status, r.read().decode(), r.headers.get("Content-Type")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), e.headers.get("Content-Type")

    def test_health(self):
        status, body, _ = self.get("/health")
        self.assertEqual(200, status)
        self.assertEqual("UP", json.loads(body)["status"])

    def test_metrics_use_prometheus_text_format(self):
        status, body, ctype = self.get("/metrics")
        self.assertEqual(200, status)
        self.assertIn("text/plain", ctype)
        self.assertIn('openagrios_lake_rows_archived_total{table="audit"}', body)
        self.assertIn("# TYPE openagrios_lake_consumer_connected gauge", body)

    def test_analytics_requires_an_org(self):
        status, body, _ = self.get("/analytics/summary")
        self.assertEqual(400, status)
        self.assertEqual("missing_org", json.loads(body)["error"])

    def test_analytics_returns_scoped_results(self):
        self.write("audit", [audit_event("A1", org="ORG_A")])
        status, body, _ = self.get("/analytics/summary?org=ORG_A")
        self.assertEqual(200, status)
        self.assertEqual(1, json.loads(body)["audit"]["events"])

    def test_unknown_paths_and_queries(self):
        self.assertEqual(404, self.get("/nope")[0])
        self.assertEqual(404, self.get("/analytics/not-a-query?org=ORG_A")[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
