# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""Regression tests for the archiver's consume -> write -> commit protocol and for lake compaction.

Found on the real stack: the commit used the wrong JSON key for Karapace (HTTP 500 every time), so the same batch was
re-written on every cycle and the whole topic was replayed after each restart.
"""
import os
import sys
import time
import unittest
import unittest.mock
import urllib.error
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import archiver  # noqa: E402
from test_archiver import LakeTestCase, audit_event, telemetry_event  # noqa: E402


class ScriptedConsumer:
    """Stands in for the REST consumer: returns scripted batches and can be told to fail commits."""

    def __init__(self, batches):
        self.batches = list(batches)
        self.ready = True
        self.commits = []
        self.commit_failures_left = 0

    def connect(self):
        self.ready = True

    def poll(self):
        return self.batches.pop(0) if self.batches else []

    def commit(self, offsets):
        if self.commit_failures_left > 0:
            self.commit_failures_left -= 1
            raise urllib.error.HTTPError("http://x", 500, "offsets missing", {}, None)
        self.commits.append(dict(offsets))


def rec(offset, event, topic="openagrios.audit.v1"):
    return {"topic": topic, "partition": 0, "offset": offset, "value": event}


class CommitProtocolTests(LakeTestCase):
    def test_commit_uses_the_offsets_key_of_the_confluent_rest_v2_api(self):
        sent = []
        with unittest.mock.patch.object(archiver, "bus", lambda method, path, body=None, **kw: sent.append((method, path, body))):
            c = archiver.Consumer()
            c.instance = "i1"
            c.commit({("openagrios.audit.v1", 0): 41})
        method, path, body = sent[0]
        self.assertEqual("POST", method)
        self.assertTrue(path.endswith("/instances/i1/offsets"))
        self.assertEqual({"offsets": [{"topic": "openagrios.audit.v1", "partition": 0, "offset": 41}]}, body)

    def test_commit_with_nothing_to_acknowledge_sends_no_request(self):
        sent = []
        with unittest.mock.patch.object(archiver, "bus", lambda *a, **k: sent.append(a)):
            archiver.Consumer().commit({})
        self.assertEqual([], sent)


class PumpTests(LakeTestCase):
    def setUp(self):
        super().setUp()
        self._flush = archiver.FLUSH_SECONDS
        archiver.FLUSH_SECONDS = 0  # flush on every step
        with archiver.state_lock:
            archiver.state["rows_archived"] = {"audit": 0, "telemetry": 0}
            archiver.state["commit_failures"] = 0

    def tearDown(self):
        archiver.FLUSH_SECONDS = self._flush
        super().tearDown()

    def events(self):
        return self.query("summary")[1]["audit"]["events"]

    def test_a_failing_commit_never_causes_the_written_batch_to_be_written_again(self):
        consumer = ScriptedConsumer([[rec(1, audit_event("E1")), rec(2, audit_event("E2", seq=2))], [], [], []])
        consumer.commit_failures_left = 2
        pump = archiver.Pump(self.con, consumer)
        for _ in range(4):
            pump.step()
        self.assertEqual(2, archiver.state["rows_archived"]["audit"], "each row is written exactly once")
        self.assertEqual(1, len(archiver.list_keys("audit/")), "one file, not one per retry")
        self.assertEqual(2, archiver.state["commit_failures"])
        self.assertEqual([{("openagrios.audit.v1", 0): 2}], consumer.commits, "committed once the broker accepts it")

    def test_new_records_keep_flowing_while_commits_are_failing(self):
        consumer = ScriptedConsumer([[rec(1, audit_event("E1"))], [rec(2, audit_event("E2", seq=2))],
                                     [rec(3, audit_event("E3", seq=3))], []])
        consumer.commit_failures_left = 2
        pump = archiver.Pump(self.con, consumer)
        for _ in range(4):
            pump.step()
        self.assertEqual(3, self.events())
        self.assertEqual(3, archiver.state["rows_archived"]["audit"])
        self.assertEqual({("openagrios.audit.v1", 0): 3}, consumer.commits[-1], "the newest offset covers the earlier ones")

    def test_a_failed_write_keeps_the_batch_for_the_next_attempt_and_commits_nothing(self):
        consumer = ScriptedConsumer([[rec(1, audit_event("E1"))], [], []])
        pump = archiver.Pump(self.con, consumer)
        original = archiver.write_parquet
        calls = {"n": 0}

        def flaky(*a, **k):
            calls["n"] += 1
            if calls["n"] == 1:
                raise IOError("object storage down")
            return original(*a, **k)

        with unittest.mock.patch.object(archiver, "write_parquet", flaky):
            with self.assertRaises(IOError):
                pump.step()
            self.assertEqual([], consumer.commits)
            pump.step()
        self.assertEqual(1, self.events(), "the batch survived the failure and was written once")
        self.assertEqual([{("openagrios.audit.v1", 0): 1}], consumer.commits)

    def test_both_topics_are_routed_to_their_own_tables_and_foreign_records_are_ignored(self):
        consumer = ScriptedConsumer([[rec(1, audit_event("E1")), rec(2, telemetry_event(), topic="openagrios.telemetry.v1"),
                                      {"topic": "other.topic", "partition": 0, "offset": 3, "value": {"x": 1}},
                                      rec(4, "not-an-object")], []])
        pump = archiver.Pump(self.con, consumer)
        pump.step()
        pump.step()
        self.assertEqual(1, archiver.state["rows_archived"]["audit"])
        self.assertEqual(1, archiver.state["rows_archived"]["telemetry"])


class WorkerSafetyTests(unittest.TestCase):
    def test_a_crashing_worker_is_restarted_and_reported_never_left_dead(self):
        calls = {"n": 0}

        def worker():
            calls["n"] += 1
            raise RuntimeError("boom")

        before = archiver.state.get("worker_restarts", 0)
        archiver.supervised("consumer", worker, retry_s=0, max_restarts=3)
        self.assertEqual(3, calls["n"])
        self.assertEqual(before + 3, archiver.state["worker_restarts"])
        self.assertEqual("crashed", archiver.state["consumer"])
        self.assertIn("boom", archiver.state["last_error"])

    def test_s3_setup_runs_under_the_extension_lock(self):
        seen = []

        class Recorder:
            def execute(self, sql, *a):
                seen.append(archiver._ext_lock.locked())

        archiver.configure_s3(Recorder())
        self.assertTrue(seen and all(seen), "LOAD httpfs and the SET statements must all run while holding the lock")
        self.assertFalse(archiver._ext_lock.locked(), "the lock is released afterwards")


class FailingCursor:
    """Delegates to a real DuckDB cursor but sabotages selected statements."""

    def __init__(self, con, fail_copy=False, zero_count=False):
        self.con, self.fail_copy, self.zero_count = con, fail_copy, zero_count

    def execute(self, sql, *args):
        text = sql.lstrip()
        if self.fail_copy and text.startswith("COPY"):
            raise IOError("simulated write failure")
        if self.zero_count and "FROM read_parquet('" in text and "compact-" in text:
            class Zero:
                def fetchone(self_inner):
                    return (0,)
            return Zero()
        return self.con.execute(sql, *args)


class DedupeAndCompactionTests(LakeTestCase):
    def aged_files(self, table, batches, age_s=3600):
        """One file per batch, named as if written `age_s` ago (compaction only touches settled files)."""
        builder = archiver.ROW_BUILDERS[table]
        now = datetime(2026, 11, 20, 12, 0, 0)
        for i, events in enumerate(batches):
            key = archiver.write_parquet(self.con, table, [builder(e, now) for e in events])
            ms = int((time.time() - age_s) * 1000) + i
            aged = key.rsplit("/", 1)[0] + f"/part-{ms}-{i:06x}.parquet"
            os.replace(os.path.join(self.root, key), os.path.join(self.root, aged))

    def count(self, table):
        return len(archiver.list_keys(f"{table}/"))

    def test_replayed_telemetry_is_not_counted_twice(self):
        ev1 = telemetry_event("M01", ts="2026-11-20T10:00:00Z", lat=10.0)
        ev2 = telemetry_event("M01", ts="2026-11-20T10:00:02Z", lat=10.001)
        self.write("telemetry", [ev1, ev2])
        self.write("telemetry", [ev1, ev2])  # redelivery after an uncommitted restart
        _, body = self.query("machine-utilization")
        self.assertEqual(2, body["rows"][0]["samples"])
        self.assertAlmostEqual(0.111, body["rows"][0]["distance_km"], places=2)

    def test_compaction_merges_old_small_files_without_changing_any_answer(self):
        self.aged_files("audit", [[audit_event(f"E{i}", seq=i + 1)] for i in range(25)] + [[audit_event("E3", seq=4)]])
        before = self.query("summary")[1]["audit"]["events"]
        self.assertEqual(26, self.count("audit"))
        self.assertEqual(26, archiver.compact_once(self.con))
        keys = archiver.list_keys("audit/")
        self.assertEqual(1, len(keys))
        self.assertIn("/compact-", keys[0])
        self.assertEqual(before, self.query("summary")[1]["audit"]["events"], "identical answers after compaction")
        self.assertEqual(25, before, "the replayed event was de-duplicated")

    def test_compaction_is_idempotent(self):
        self.aged_files("audit", [[audit_event(f"E{i}", seq=i + 1)] for i in range(25)])
        archiver.compact_once(self.con)
        self.assertEqual(0, archiver.compact_once(self.con))
        self.assertEqual(1, self.count("audit"))

    def test_compaction_leaves_recent_files_alone(self):
        self.aged_files("telemetry", [[telemetry_event(ts=f"2026-11-20T10:00:{i:02d}Z")] for i in range(25)], age_s=5)
        self.assertEqual(0, archiver.compact_once(self.con))
        self.assertEqual(25, self.count("telemetry"))

    def test_compaction_waits_until_there_are_enough_files(self):
        n = archiver.COMPACT_MIN_FILES - 1
        self.aged_files("telemetry", [[telemetry_event(ts=f"2026-11-20T10:00:{i:02d}Z")] for i in range(n)])
        self.assertEqual(0, archiver.compact_once(self.con))
        self.assertEqual(n, self.count("telemetry"))

    def test_compacted_telemetry_keeps_distance_and_sample_counts(self):
        self.aged_files("telemetry", [[telemetry_event("M01", ts=f"2026-11-20T10:00:{i:02d}Z", lat=10.0 + i * 0.0001)] for i in range(25)])
        before = self.query("machine-utilization")[1]["rows"]
        archiver.compact_once(self.con)
        after = self.query("machine-utilization")[1]["rows"]
        self.assertEqual(before, after)
        self.assertEqual(25, after[0]["samples"])

    def test_a_failed_merge_write_keeps_every_source_file_and_leaves_no_partial_output(self):
        self.aged_files("audit", [[audit_event(f"E{i}", seq=i + 1)] for i in range(25)])
        with self.assertRaises(IOError):
            archiver.compact_once(FailingCursor(self.con, fail_copy=True))
        self.assertEqual(25, self.count("audit"))
        self.assertEqual(25, self.query("summary")[1]["audit"]["events"])

    def test_a_row_count_mismatch_aborts_compaction_before_anything_is_deleted(self):
        self.aged_files("audit", [[audit_event(f"E{i}", seq=i + 1)] for i in range(25)])
        with self.assertRaises(RuntimeError):
            archiver.compact_once(FailingCursor(self.con, zero_count=True))
        keys = archiver.list_keys("audit/")
        self.assertEqual(25, len(keys), "all sources kept")
        self.assertFalse([k for k in keys if "/compact-" in k], "the unverified output was removed")
        self.assertEqual(25, self.query("summary")[1]["audit"]["events"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
