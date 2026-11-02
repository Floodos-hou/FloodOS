# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""Unit tests for the Tier-3 traceability module, against real DuckDB + Parquet files in a temp directory."""
import copy
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
import traceability as tr  # noqa: E402

COLS = [
    ("ledger_epoch", "VARCHAR"), ("seq_no", "INTEGER"), ("event_id", "VARCHAR"), ("organization_id", "VARCHAR"),
    ("correlation_id", "VARCHAR"), ("entity_type", "VARCHAR"), ("entity_id", "VARCHAR"), ("action", "VARCHAR"),
    ("actor_user_id", "VARCHAR"), ("actor_role", "VARCHAR"), ("gateway_status", "INTEGER"), ("prev_hash", "VARCHAR"),
    ("record_hash", "VARCHAR"), ("created_at", "TIMESTAMP"), ("before_canonical", "VARCHAR"),
    ("after_canonical", "VARCHAR"), ("ingested_at", "TIMESTAMP"),
]


def make_chain(epoch, specs, start_seq=1, prev=tr.GENESIS_HASH):
    """specs: list of (corr, action, role). Returns rows whose hashes are valid for the core's formula."""
    rows = []
    for i, (corr, action, role) in enumerate(specs):
        seq = start_seq + i
        row = {
            "ledger_epoch": epoch, "seq_no": seq, "event_id": f"EVT-2026-{seq:04d}", "organization_id": "HTX_CANTHO_01",
            "correlation_id": corr, "entity_type": "ServiceRequest", "entity_id": "REQ-03", "action": action,
            "actor_user_id": "usr_secret_person", "actor_role": role, "gateway_status": 200, "prev_hash": prev,
            "created_at": datetime(2026, 11, 20, 9, 15, seq % 60), "before_canonical": '{"s":"a"}',
            "after_canonical": '{"s":"b"}', "ingested_at": datetime(2026, 11, 20, 12, 0, 0),
        }
        row["record_hash"] = tr.recompute_hash(row)
        prev = row["record_hash"]
        rows.append(row)
    return rows


class LakeCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="trace-test-")
        self._old = tr.LAKE_ROOT
        tr.LAKE_ROOT = self.root
        self.files = 0

    def tearDown(self):
        tr.LAKE_ROOT = self._old
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rows):
        self.files += 1
        d = os.path.join(self.root, "audit", f"dt=2026-11-20")
        os.makedirs(d, exist_ok=True)
        con = tr.root.cursor()
        con.execute("CREATE OR REPLACE TEMP TABLE t (" + ", ".join(f"{n} {t}" for n, t in COLS) + ")")
        con.executemany("INSERT INTO t VALUES (" + ",".join("?" for _ in COLS) + ")", [[r[n] for n, _ in COLS] for r in rows])
        con.execute(f"COPY t TO '{d}/part-{self.files}.parquet' (FORMAT PARQUET)")
        con.execute("DROP TABLE t")


class FormulaTests(unittest.TestCase):
    def test_golden_vector_shared_with_the_java_core(self):
        # SecurityTests.java asserts the same raw string and digest: the two implementations cannot drift apart
        row = {"prev_hash": "0" * 64, "seq_no": 1, "event_id": "EVT-2026-0001", "organization_id": "HTX_CANTHO_01",
               "correlation_id": "CORR-GOLDEN-F03", "entity_type": "ServiceRequest", "entity_id": "REQ-03",
               "action": "CREATE_SERVICE_REQUEST", "actor_user_id": "usr_farmer_ba", "actor_role": "FARMER",
               "created_at": datetime(2026, 11, 20, 9, 15, 0), "before_canonical": '{"status":"NEW"}',
               "after_canonical": '{"a":1,"b":"x"}'}
        self.assertEqual("c1f69f41b8d35d0e68a8e616f9ab5bd4b903fb9f1b2630607724a84c2d0337c4", tr.recompute_hash(row))

    def test_any_changed_field_changes_the_hash(self):
        rows = make_chain("E", [("C", "CREATE_SERVICE_REQUEST", "FARMER")])
        base = rows[0]
        for field, value in [("after_canonical", '{"s":"x"}'), ("actor_role", "COORDINATOR"), ("seq_no", 9),
                             ("created_at", datetime(2026, 11, 20, 9, 15, 59)), ("entity_id", "REQ-04"),
                             ("prev_hash", "1" * 64), ("action", "OTHER")]:
            changed = dict(base, **{field: value})
            self.assertNotEqual(base["record_hash"], tr.recompute_hash(changed), field)


class VerificationTests(unittest.TestCase):
    def chain(self):
        return make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER"), ("C1", "DISPATCH_MACHINE_ASSIGNMENT", "COORDINATOR"),
                                 ("C2", "CREATE_SERVICE_REQUEST", "FARMER"), ("C1", "CONFIRM_ACCEPTANCE_AND_SEAL_LEDGER", "FARMER")])

    def lot(self, chain, corr="C1"):
        return [r for r in chain if r["correlation_id"] == corr]

    def test_intact_chain_is_verified(self):
        c = self.chain()
        v = tr.verify(self.lot(c), c)
        self.assertEqual("VERIFIED", v["status"])
        self.assertEqual((3, 3), (v["records_checked"], v["records_match"]))
        self.assertTrue(v["epoch_continuous"])
        self.assertEqual(4, v["epoch_blocks"])

    def test_edited_payload_is_detected(self):
        c = self.chain()
        c[1] = dict(c[1], after_canonical='{"s":"FORGED"}')
        v = tr.verify(self.lot(c), c)
        self.assertEqual("FAILED", v["status"])
        self.assertEqual([2], v["mismatched_seq"])

    def test_edit_of_another_lots_record_breaks_the_epoch_check_for_this_lot_too(self):
        c = self.chain()
        c[2] = dict(c[2], record_hash="f" * 64)            # C2's record: not part of lot C1, but the chain after it breaks
        v = tr.verify(self.lot(c), c)
        self.assertEqual("FAILED", v["status"])
        self.assertFalse(v["epoch_continuous"])

    def test_deleted_block_is_detected(self):
        c = self.chain()
        del c[2]
        v = tr.verify(self.lot(c), c)
        self.assertEqual("FAILED", v["status"])
        self.assertIn("seq 3", v["epoch_problem"])

    def test_reordered_chain_is_detected(self):
        c = self.chain()
        c[1], c[2] = dict(c[2]), dict(c[1])
        c[1]["seq_no"], c[2]["seq_no"] = 2, 3
        self.assertEqual("FAILED", tr.verify(self.lot(c), c)["status"])

    def test_chain_must_start_at_genesis(self):
        c = make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER")], start_seq=1, prev="a" * 64)
        self.assertFalse(tr.verify(c, c)["epoch_continuous"])

    def test_legacy_rows_without_canonical_text_are_partial_not_verified(self):
        c = self.chain()
        legacy = [dict(r, before_canonical=None, after_canonical=None) for r in c]
        v = tr.verify(self.lot(legacy), legacy)
        self.assertEqual("PARTIAL", v["status"])
        self.assertEqual(3, v["records_unverifiable"])

    def test_no_records_is_never_reported_as_verified(self):
        self.assertEqual("EMPTY", tr.verify([], [])["status"])


class LakeTests(LakeCase):
    def test_unknown_lot_returns_none(self):
        self.write(make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER")]))
        self.assertIsNone(tr.load_lot("CORR-NOPE"))

    def test_empty_lake_returns_none_instead_of_crashing(self):
        self.assertIsNone(tr.load_lot("C1"))

    def test_only_the_requested_lot_and_epoch_are_returned(self):
        self.write(make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER"), ("C2", "CREATE_SERVICE_REQUEST", "FARMER"),
                                     ("C1", "DISPATCH_MACHINE_ASSIGNMENT", "COORDINATOR")]))
        lot, whole = tr.load_lot("C1")
        self.assertEqual([1, 3], [r["seq_no"] for r in lot])
        self.assertEqual(3, len(whole))

    def test_newest_epoch_wins_when_a_correlation_id_repeats_after_a_reset(self):
        old = make_chain("E-OLD", [("C1", "CREATE_SERVICE_REQUEST", "FARMER")])
        new = make_chain("E-NEW", [("C1", "CREATE_SERVICE_REQUEST", "FARMER"), ("C1", "DISPATCH_MACHINE_ASSIGNMENT", "COORDINATOR")])
        for r in new:
            r["created_at"] = datetime(2026, 11, 21, 8, 0, r["seq_no"])
        self.write(old + new)
        lot, whole = tr.load_lot("C1")
        self.assertEqual({"E-NEW"}, {r["ledger_epoch"] for r in lot})
        self.assertEqual(2, len(lot))
        self.assertEqual(2, len(whole))

    def test_replayed_events_are_deduplicated(self):
        rows = make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER")])
        self.write(rows)
        self.write(rows)
        lot, whole = tr.load_lot("C1")
        self.assertEqual(1, len(lot))
        self.assertEqual("VERIFIED", tr.verify(lot, whole)["status"])

    def test_full_pipeline_detects_tampering_stored_in_the_lake(self):
        rows = make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER"), ("C1", "DISPATCH_MACHINE_ASSIGNMENT", "COORDINATOR")])
        rows[0]["after_canonical"] = '{"s":"FORGED"}'
        self.write(rows)
        lot, whole = tr.load_lot("C1")
        self.assertEqual("FAILED", tr.verify(lot, whole)["status"])


class LegacyLakeTests(LakeCase):
    def test_a_lake_written_before_the_canonical_columns_existed_is_partial_not_an_error(self):
        legacy_cols = [c for c in COLS if c[0] not in ("before_canonical", "after_canonical")]
        rows = make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER"), ("C1", "DISPATCH_MACHINE_ASSIGNMENT", "COORDINATOR")])
        d = os.path.join(self.root, "audit", "dt=2026-11-20")
        os.makedirs(d, exist_ok=True)
        con = tr.root.cursor()
        con.execute("CREATE OR REPLACE TEMP TABLE legacy (" + ", ".join(f"{n} {t}" for n, t in legacy_cols) + ")")
        con.executemany("INSERT INTO legacy VALUES (" + ",".join("?" for _ in legacy_cols) + ")",
                        [[r[n] for n, _ in legacy_cols] for r in rows])
        con.execute(f"COPY legacy TO '{d}/part-1.parquet' (FORMAT PARQUET)")
        lot, whole = tr.load_lot("C1")
        trace = tr.build_trace("C1", lot, whole)
        self.assertEqual("PARTIAL", trace["verification"]["status"])
        self.assertEqual(2, trace["verification"]["records_unverifiable"])
        self.assertTrue(trace["verification"]["epoch_continuous"], "linkage can still be checked from prev/record hashes")


class RenderingTests(LakeCase):
    def trace(self, specs=None, corr="C1"):
        self.write(make_chain("E1", specs or [("C1", "CREATE_SERVICE_REQUEST", "FARMER"), ("C1", "REPORT_MACHINE_INCIDENT", "OPERATOR"),
                                              ("C1", "CONFIRM_ACCEPTANCE_AND_SEAL_LEDGER", "FARMER")]))
        return tr.build_trace(corr, *tr.load_lot(corr))

    def test_public_json_never_exposes_personal_identities(self):
        t = self.trace()
        blob = json.dumps(t, ensure_ascii=False)
        self.assertNotIn("usr_secret_person", blob)
        self.assertNotIn("actor_user_id", blob)
        self.assertEqual("Nông hộ", t["steps"][0]["role"])
        self.assertEqual("Thợ lái máy", t["steps"][1]["role"])

    def test_html_does_not_expose_identities_either(self):
        self.assertNotIn("usr_secret_person", tr.render_html(self.trace()))

    def test_steps_are_labelled_in_plain_vietnamese_with_short_hashes(self):
        t = self.trace()
        self.assertEqual("Nông hộ gửi yêu cầu thu hoạch", t["steps"][0]["label"])
        self.assertEqual("Máy gặt gặp sự cố giữa vụ", t["steps"][1]["label"])
        self.assertEqual(16, len(t["steps"][0]["hash"]))
        self.assertEqual("VERIFIED", t["verification"]["status"])

    def test_unknown_actions_get_a_readable_fallback_label(self):
        t = self.trace([("C1", "SOME_NEW_ACTION", "FARMER")])
        self.assertEqual("Some new action", t["steps"][0]["label"])

    def test_blocked_conflicts_are_explained(self):
        t = self.trace([("C1", "CONFLICT_BLOCKED_MACHINE_TIME_OVERLAP", "COORDINATOR")])
        self.assertIn("chặn", t["steps"][0]["label"])

    def test_hostile_strings_are_escaped_in_html(self):
        rows = make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER")])
        rows[0]["entity_id"] = '<script>alert("x")</script>'
        rows[0]["record_hash"] = tr.recompute_hash(rows[0])
        self.write(rows)
        page = tr.render_html(tr.build_trace("C1", *tr.load_lot("C1")))
        self.assertNotIn("<script>alert", page)
        self.assertIn("&lt;script&gt;", page)

    def test_failed_verification_is_shown_loudly(self):
        rows = make_chain("E1", [("C1", "CREATE_SERVICE_REQUEST", "FARMER")])
        rows[0]["after_canonical"] = '{"s":"FORGED"}'
        self.write(rows)
        page = tr.render_html(tr.build_trace("C1", *tr.load_lot("C1")))
        self.assertIn("KHÔNG HỢP LỆ", page)
        self.assertNotIn("ĐÃ XÁC MINH", page)

    def test_qr_encodes_the_public_trace_url(self):
        svg = tr.qr_svg("C1")
        self.assertTrue(svg.lstrip().startswith("<svg"))
        self.assertGreater(len(svg), 500)

    def test_inline_qr_scales_through_its_viewbox_instead_of_fixed_pixels(self):
        inline = tr.qr_svg("C1", inline=True)
        self.assertIn("viewBox", inline)
        self.assertNotIn("width=", inline.split(">", 1)[0], "no fixed width on the root element")
        self.assertIn("width=", tr.qr_svg("C1").split(">", 1)[0], "the standalone image keeps an intrinsic size")

    def test_page_text_is_fully_vietnamese(self):
        page = tr.render_html(self.trace())
        self.assertNotIn("recomputed independently", page)

    def test_disclaimer_is_rendered_when_configured(self):
        old = tr.DISCLAIMER
        tr.DISCLAIMER = "Dữ liệu minh họa"
        try:
            self.assertIn("Dữ liệu minh họa", tr.render_html(self.trace()))
        finally:
            tr.DISCLAIMER = old


class HttpTests(LakeCase):
    def setUp(self):
        super().setUp()
        self.write(make_chain("E1", [("CORR-1", "CREATE_SERVICE_REQUEST", "FARMER"), ("CORR-1", "COMPLETE_REPAIR_TICKET", "REPAIR_TEAM")]))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), tr.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        super().tearDown()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=10) as r:
                return r.status, r.read().decode(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), e.headers

    def test_json_endpoint(self):
        status, body, headers = self.get("/trace/CORR-1.json")
        self.assertEqual(200, status)
        self.assertEqual("VERIFIED", json.loads(body)["verification"]["status"])
        self.assertEqual("no-store", headers["Cache-Control"])
        self.assertEqual("nosniff", headers["X-Content-Type-Options"])

    def test_html_page_and_qr(self):
        status, body, headers = self.get("/trace/CORR-1")
        self.assertEqual(200, status)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn("<svg", body)
        status, svg, headers = self.get("/trace/CORR-1/qr.svg")
        self.assertEqual(200, status)
        self.assertEqual("image/svg+xml", headers["Content-Type"])

    def test_unknown_lot_is_404(self):
        self.assertEqual(404, self.get("/trace/CORR-NOPE.json")[0])
        self.assertEqual(404, self.get("/trace/CORR-NOPE")[0])

    def test_malformed_ids_are_rejected_before_touching_the_lake(self):
        for bad in ["/trace/a.json", "/trace/%27%20OR%201%3D1.json", "/trace/" + "x" * 65 + ".json", "/trace/..%2Fsecret.json"]:
            status, body, _ = self.get(bad)
            self.assertIn(status, (400, 404), bad)
        self.assertEqual(400, self.get("/trace/a.json")[0])

    def test_health_and_metrics(self):
        self.assertEqual("UP", json.loads(self.get("/health")[1])["status"])
        self.get("/trace/CORR-1.json")
        _, text, _ = self.get("/metrics")
        self.assertIn("openagrios_trace_verified_total", text)

    def test_unknown_paths(self):
        self.assertEqual(404, self.get("/admin")[0])
        self.assertEqual(404, self.get("/trace/CORR-1/other")[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
