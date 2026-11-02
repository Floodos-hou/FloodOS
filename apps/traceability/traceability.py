# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""
OpenDXOS Tier-3 domain module: flood-response CASE TRACEABILITY.

A pluggable application on top of the Tier-1 platform. It never touches the core or its database: it only reads
the cold lake (Parquet on S3, fed by the Tier-1 event bus) and answers a public question, "what happened to this
flood case, and can I trust that record?"

Trust model: the core chains every business event with SHA-256 (prev_hash | seq | ... | before | after). The core
also streams the exact hashed bytes into the lake, so THIS service recomputes every hash on its own and checks that
the chain of the whole ledger epoch is unbroken. A reader therefore does not have to trust the core's own
"chain_valid: true" claim.

Public output is redacted: roles and entity ids only, never user identities.
"""
import hashlib
import html
import io
import json
import os
import re
import threading
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import duckdb
import segno

BUCKET = os.environ.get("LAKE_BUCKET", "openagrios-lake")
LAKE_ROOT = os.environ.get("LAKE_ROOT", f"s3://{BUCKET}").rstrip("/")
S3_ENDPOINT = os.environ.get("LAKE_S3_ENDPOINT", "object-storage:9000")
S3_KEY = os.environ.get("LAKE_S3_ACCESS_KEY", "openagrios")
S3_SECRET = os.environ.get("LAKE_S3_SECRET_KEY", "openagrios-dev-only")
PORT = int(os.environ.get("PORT", "8095"))
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "http://localhost:9080").rstrip("/")
DISCLAIMER = os.environ.get("TRACE_DISCLAIMER", "")

GENESIS_HASH = "0" * 64
ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")

ROLE_LABELS = {
    "REPORTER": "Người báo tin", "DISPATCHER": "Điều phối viên", "FIELD_TEAM": "Đội hiện trường",
    "RESOURCE_MANAGER": "Quản lý nguồn lực", "PLATFORM_ADMIN": "Quản trị nền tảng",
}

# action code -> (icon, public label)
ACTION_LABELS = {
    "CREATE_FLOOD_REPORT": ("📝", "Người báo tin gửi tin báo ngập"),
    "VERIFY_FLOOD_REPORT": ("🔎", "Điều phối viên xác minh tin báo và xếp mức ưu tiên"),
    "REJECT_FLOOD_REPORT": ("🚫", "Điều phối viên từ chối tin báo"),
    "CONFIRM_DISPATCH_ORDER": ("🚤", "Điều phối viên xếp đội và phương tiện cho vụ việc"),
    "ORDER_STATUS_UPDATED": ("📍", "Đội hiện trường cập nhật tiến độ xử lý"),
    "REPORT_VEHICLE_INCIDENT_AND_IMPACT_SCAN": ("⚠️", "Phương tiện gặp sự cố, hệ thống rà soát các lệnh bị ảnh hưởng"),
    "APPROVE_REPLAN_REPLACEMENT": ("🆘", "Vụ việc được xếp lại cho phương tiện và đội thay thế"),
    "UPDATE_REPAIR_TICKET": ("🛠️", "Quản lý nguồn lực cập nhật phiếu sửa chữa"),
    "CLOSE_REPAIR_TICKET": ("✅", "Phương tiện hỏng đã được sửa xong"),
    "DISPUTE_RESOLUTION": ("↩️", "Kết quả xử lý bị phản đối, vụ việc quay lại điều phối"),
    "CONFIRM_RESOLUTION_AND_SEAL_LEDGER": ("🌊", "Vụ việc được xác nhận xử lý xong và niêm phong sổ cái"),
}

AUDIT_GLOB = "audit/*/*.parquet"

root = duckdb.connect(":memory:")
stats_lock = threading.Lock()
stats = {"requests": 0, "verified": 0, "partial": 0, "failed": 0, "not_found": 0, "bad_request": 0}


def bump(key):
    with stats_lock:
        stats[key] += 1


# --------------------------------------------------------------------------- verification (pure, no I/O)
def raw_chain(row):
    """The exact byte string the core hashes for one ledger record (ImmutableAuditLedger.appendRecord)."""
    created = row["created_at"]
    ts = created.strftime("%Y-%m-%dT%H:%M:%SZ") if isinstance(created, datetime) else str(created)
    return "|".join([
        str(row["prev_hash"]), str(row["seq_no"]), str(row["event_id"]), str(row["organization_id"]),
        str(row["correlation_id"]), str(row["entity_type"]), str(row["entity_id"]), str(row["action"]),
        str(row["actor_user_id"]), str(row["actor_role"]), ts,
        str(row["before_canonical"]), str(row["after_canonical"]),
    ])


def recompute_hash(row):
    return hashlib.sha256(raw_chain(row).encode("utf-8")).hexdigest()


def epoch_continuity(epoch_rows):
    """Checks that the ledger epoch is one unbroken chain from genesis. Returns (ok, first_problem_or_None)."""
    expected_prev, expected_seq = GENESIS_HASH, 1
    for r in sorted(epoch_rows, key=lambda x: x["seq_no"]):
        if r["seq_no"] != expected_seq:
            return False, f"missing or reordered block at seq {expected_seq}"
        if r["prev_hash"] != expected_prev:
            return False, f"broken link at seq {r['seq_no']}"
        expected_prev, expected_seq = r["record_hash"], expected_seq + 1
    return True, None


def verify(rows, epoch_rows):
    """Independent verification of the records of one case against the whole ledger epoch they belong to."""
    checked = matched = unverifiable = 0
    mismatches = []
    for r in rows:
        checked += 1
        if r.get("before_canonical") is None or r.get("after_canonical") is None:
            unverifiable += 1
        elif recompute_hash(r) == r["record_hash"]:
            matched += 1
        else:
            mismatches.append(r["seq_no"])
    continuous, problem = epoch_continuity(epoch_rows)
    if mismatches or not continuous:
        status = "FAILED"
    elif unverifiable or checked == 0:
        status = "PARTIAL" if checked else "EMPTY"
    else:
        status = "VERIFIED"
    return {
        "status": status,
        "records_checked": checked,
        "records_match": matched,
        "records_unverifiable": unverifiable,
        "mismatched_seq": mismatches,
        "epoch_blocks": len(epoch_rows),
        "epoch_continuous": continuous,
        "epoch_problem": problem,
        "algorithm": "SHA-256 hash chain, recomputed independently by the traceability service from the cold lake",
    }


# --------------------------------------------------------------------------- lake access
def configure_s3(con):
    con.execute("LOAD httpfs")
    con.execute(f"SET s3_endpoint='{S3_ENDPOINT}'")
    con.execute("SET s3_use_ssl=false")
    con.execute("SET s3_url_style='path'")
    con.execute(f"SET s3_access_key_id='{S3_KEY}'")
    con.execute(f"SET s3_secret_access_key='{S3_SECRET}'")
    con.execute("SET s3_region='us-east-1'")


# `SELECT *` (not an explicit list) so a lake that has no file with the canonical columns yet still answers
COLUMNS = "*"
SOURCE = ("read_parquet('{root}/" + AUDIT_GLOB + "', hive_partitioning=true, union_by_name=true)")
DEDUPE = "QUALIFY row_number() OVER (PARTITION BY ledger_epoch, event_id ORDER BY ingested_at) = 1"


OPTIONAL_COLUMNS = ("before_canonical", "after_canonical")


def _rows(cur):
    """Rows as dicts. Columns that no lake file has yet (data written before the canonical text was streamed) read as
    None, which verify() reports as PARTIAL instead of failing the whole request."""
    cols = [d[0] for d in cur.description]
    out = []
    for r in cur.fetchall():
        row = dict(zip(cols, r))
        for c in OPTIONAL_COLUMNS:
            row.setdefault(c, None)
        out.append(row)
    return out


def load_case(corr_id):
    """Returns (case_rows, epoch_rows) for the newest ledger epoch that contains this correlation id, or None."""
    con = root.cursor()
    if LAKE_ROOT.startswith("s3://"):
        configure_s3(con)
    src = SOURCE.format(root=LAKE_ROOT)
    try:
        newest = con.execute(
            f"SELECT ledger_epoch FROM {src} WHERE correlation_id = ? ORDER BY created_at DESC, seq_no DESC LIMIT 1",
            [corr_id]).fetchone()
        if not newest:
            return None
        epoch = newest[0]
        case = _rows(con.execute(
            f"SELECT {COLUMNS} FROM {src} WHERE correlation_id = ? AND ledger_epoch = ? {DEDUPE} ORDER BY seq_no",
            [corr_id, epoch]))
        whole = _rows(con.execute(
            f"SELECT {COLUMNS} FROM {src} WHERE ledger_epoch = ? {DEDUPE} ORDER BY seq_no", [epoch]))
        return case, whole
    except duckdb.IOException as e:
        if "No files found" in str(e) or "no files" in str(e).lower():
            return None  # lake still empty
        raise


# --------------------------------------------------------------------------- public (redacted) view
def humanize(action):
    return action.replace("_", " ").strip().capitalize()


def build_trace(corr_id, case, epoch_rows):
    verification = verify(case, epoch_rows)
    steps = []
    for r in case:
        icon, label = ACTION_LABELS.get(r["action"], ("🔹", humanize(r["action"])))
        if str(r["action"]).startswith("CONFLICT_BLOCKED_"):
            icon, label = "⛔", "Hệ thống chặn một lịch xếp trùng giờ"
        created = r["created_at"]
        steps.append({
            "seq": r["seq_no"],
            "time": created.strftime("%Y-%m-%dT%H:%M:%SZ") if isinstance(created, datetime) else str(created),
            "icon": icon,
            "label": label,
            "entity": f"{r['entity_type']} {r['entity_id']}",
            "role": ROLE_LABELS.get(r["actor_role"], r["actor_role"]),
            "outcome_http": r["gateway_status"],
            "hash": str(r["record_hash"])[:16],
        })
    return {
        "trace_id": corr_id,
        "organization": case[0]["organization_id"] if case else None,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "verification": verification,
        "summary": {
            "steps": len(steps),
            "first_event": steps[0]["time"] if steps else None,
            "last_event": steps[-1]["time"] if steps else None,
        },
        "steps": steps,
        "privacy": "Public view: only roles and entity ids are shown, never personal identities.",
        "disclaimer": DISCLAIMER,
    }


def qr_svg(corr_id, inline=False):
    """QR of the public page. Inline use drops width/height so the SVG scales to its box through its viewBox
    (with fixed pixel sizes the code was clipped by the container)."""
    out = io.BytesIO()
    segno.make(f"{PUBLIC_BASE_URL}/trace/{corr_id}", error="m").save(
        out, kind="svg", scale=6, dark="#14532d", light="#ffffff", border=2, xmldecl=False, svgns=True, omitsize=inline)
    return out.getvalue().decode("utf-8")


STATUS_STYLE = {
    "VERIFIED": ("#166534", "#dcfce7", "✔ ĐÃ XÁC MINH", "Mọi mã băm SHA-256 được tính lại độc lập và khớp; chuỗi sổ cái liền mạch."),
    "PARTIAL": ("#92400e", "#fef3c7", "⚠ XÁC MINH MỘT PHẦN", "Một số bản ghi cũ thiếu dữ liệu gốc nên chỉ kiểm tra được tính liền mạch của chuỗi."),
    "FAILED": ("#991b1b", "#fee2e2", "✖ KHÔNG HỢP LỆ", "Phát hiện bản ghi bị sửa hoặc chuỗi sổ cái bị đứt. KHÔNG nên tin hồ sơ này."),
    "EMPTY": ("#334155", "#e2e8f0", "CHƯA CÓ DỮ LIỆU", "Chưa có bản ghi nào cho mã này."),
}


def render_html(trace):
    e = html.escape
    v = trace["verification"]
    color, bg, badge, explain = STATUS_STYLE.get(v["status"], STATUS_STYLE["EMPTY"])
    items = []
    for i, s in enumerate(trace["steps"]):
        items.append(
            f'<li style="--i:{i}"><span class="dot">{e(s["icon"])}</span><div class="card">'
            f'<div class="t">{e(s["label"])}</div>'
            f'<div class="m">{e(s["time"])} · {e(s["role"])} · {e(s["entity"])}</div>'
            f'<div class="h">SHA-256 {e(s["hash"])}…</div></div></li>')
    disclaimer = f'<p class="disc">{e(trace["disclaimer"])}</p>' if trace["disclaimer"] else ""
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Truy xuất nguồn gốc {e(trace["trace_id"])} · OpenAgriOS</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f1e8;color:#1f2937}}
header{{background:linear-gradient(135deg,#052e16,#166534);color:#fff;padding:28px 20px 70px}}
.wrap{{max-width:860px;margin:0 auto}}h1{{margin:0;font-size:1.5rem}}header p{{margin:.3rem 0 0;color:#bbf7d0}}
.top{{display:flex;gap:20px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:-48px}}
.panel{{background:#fff;border-radius:20px;box-shadow:0 10px 30px #0002;padding:20px;flex:1 1 380px}}
.badge{{display:inline-block;padding:6px 14px;border-radius:999px;font-weight:800;color:{color};background:{bg}}}
.qr{{width:150px;height:150px;flex:0 0 auto}}.qr svg{{width:100%;height:100%}}
.kv{{font-size:.85rem;color:#475569;margin-top:10px;line-height:1.6}}.kv b{{color:#0f172a}}
h2{{margin:28px 0 12px;font-size:1.1rem}}ol{{list-style:none;margin:0;padding:0;position:relative}}
ol:before{{content:"";position:absolute;left:19px;top:6px;bottom:6px;width:3px;background:linear-gradient(#16a34a,#bbf7d0);border-radius:3px}}
li{{position:relative;padding-left:56px;margin-bottom:14px;opacity:0;transform:translateY(8px);animation:in .5s ease forwards;animation-delay:calc(var(--i)*90ms)}}
.dot{{position:absolute;left:0;top:2px;width:40px;height:40px;border-radius:50%;background:#fff;border:3px solid #16a34a;display:grid;place-items:center;font-size:1.1rem}}
.card{{background:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 2px 8px #0001}}.t{{font-weight:700}}
.m{{font-size:.8rem;color:#64748b;margin-top:2px}}.h{{font-family:ui-monospace,Consolas,monospace;font-size:.72rem;color:#166534;margin-top:6px}}
.disc,footer{{font-size:.78rem;color:#64748b}}footer{{margin:28px 0 40px;text-align:center}}
@keyframes in{{to{{opacity:1;transform:none}}}}@media (prefers-reduced-motion:reduce){{li{{animation:none;opacity:1;transform:none}}}}
</style></head><body>
<header><div class="wrap"><h1>🌊 Truy xuất vụ việc ứng phó ngập lụt</h1><p>OpenDXOS · Tầng 3 · Mã vụ việc <b>{e(trace["trace_id"])}</b></p></div></header>
<main class="wrap"><div class="top">
<section class="panel"><span class="badge">{e(badge)}</span><p>{e(explain)}</p>
<div class="kv"><b>{v["records_match"]}/{v["records_checked"]}</b> bản ghi khớp mã băm · chuỗi sổ cái <b>{v["epoch_blocks"]}</b> khối {"liền mạch" if v["epoch_continuous"] else "BỊ ĐỨT"}<br>
Đơn vị: <b>{e(str(trace["organization"] or "—"))}</b> · {trace["summary"]["steps"]} bước · từ {e(str(trace["summary"]["first_event"] or "—"))}</div></section>
<div class="panel qr" aria-label="Mã QR của trang này" style="flex:0 0 190px;display:grid;place-items:center">{qr_svg(trace["trace_id"], inline=True)}</div></div>
<h2>Hành trình của vụ việc</h2><ol>{"".join(items) or "<li style='--i:0'><div class='card'>Chưa có bước nào.</div></li>"}</ol>
{disclaimer}
<footer>Trang công khai chỉ hiển thị vai trò và mã sự kiện, không hiển thị danh tính cá nhân.<br>Chuỗi băm SHA-256 được dịch vụ truy xuất tự tính lại độc lập từ kho dữ liệu lạnh, không dựa vào lời khẳng định của lõi.</footer>
</main></body></html>"""


# --------------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, ctype):
        raw = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        bump("requests")
        if path == "/health":
            return self._json(200, {"status": "UP", **stats})
        if path == "/metrics":
            lines = ["# TYPE openagrios_trace_requests_total counter"]
            for k, val in stats.items():
                lines.append(f'openagrios_trace_{k}_total {val}')
            return self._send(200, "\n".join(lines) + "\n", "text/plain; version=0.0.4")
        m = re.fullmatch(r"/trace/([^/]+?)(\.json|/qr\.svg)?", path)
        if not m:
            return self._json(404, {"error": "not_found"})
        corr_id, suffix = m.group(1), m.group(2)
        if not ID_RE.match(corr_id):
            bump("bad_request")
            return self._json(400, {"error": "invalid_trace_id", "message": "Trace id must be 3-64 chars of A-Z a-z 0-9 _ -"})
        try:
            loaded = load_case(corr_id)
        except Exception as ex:  # lake unreachable etc.: never leak internals
            print(f"[TRACE] lake error: {type(ex).__name__}: {ex}", flush=True)
            return self._json(503, {"error": "lake_unavailable"})
        if not loaded or not loaded[0]:
            bump("not_found")
            if suffix == ".json":
                return self._json(404, {"error": "trace_not_found", "trace_id": corr_id})
            return self._send(404, "<h1>Không tìm thấy vụ việc truy xuất này</h1>", "text/html; charset=utf-8")
        trace = build_trace(corr_id, *loaded)
        bump({"VERIFIED": "verified", "PARTIAL": "partial"}.get(trace["verification"]["status"], "failed"))
        if suffix == ".json":
            return self._json(200, trace)
        if suffix == "/qr.svg":
            return self._send(200, qr_svg(corr_id), "image/svg+xml")
        return self._send(200, render_html(trace), "text/html; charset=utf-8")

    def log_message(self, fmt, *args):
        return


def main():
    print(f"[TRACE] listening on :{PORT}, lake={LAKE_ROOT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
