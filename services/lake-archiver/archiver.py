# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""
OpenAgriOS cold-tier lake archiver.

Hot path  : core-api -> Apache Kafka topics (via Kafka REST Proxy) (audit / telemetry events)
Cold path : this service consumes the topics (at-least-once), writes Hive-partitioned
            Parquet files to S3-compatible object storage (SeaweedFS), and answers analytical
            queries over those Parquet files with DuckDB.

Delivery semantics: offsets are committed only after the Parquet file is durably written, so a crash
re-delivers the batch. Queries de-duplicate on (ledger_epoch, event_id), which makes replay harmless.
"""
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import duckdb

EVENT_BUS_URL = os.environ.get("EVENT_BUS_URL", "http://kafka-rest:8082").rstrip("/")
S3_ENDPOINT = os.environ.get("LAKE_S3_ENDPOINT", "object-storage:9000")
BUCKET = os.environ.get("LAKE_BUCKET", "openagrios-lake")
# Root URI of the lake. Defaults to the S3 bucket; tests point it at a local directory.
LAKE_ROOT = os.environ.get("LAKE_ROOT", f"s3://{BUCKET}").rstrip("/")
S3_KEY = os.environ.get("LAKE_S3_ACCESS_KEY", "openagrios")
S3_SECRET = os.environ.get("LAKE_S3_SECRET_KEY", "openagrios-dev-only")
GROUP = os.environ.get("LAKE_CONSUMER_GROUP", "openagrios-lake-archiver")
BATCH_MAX = int(os.environ.get("LAKE_BATCH_MAX", "200"))
FLUSH_SECONDS = float(os.environ.get("LAKE_FLUSH_SECONDS", "5"))
PORT = int(os.environ.get("PORT", "8090"))
# Compaction: merge the many small per-flush files of a day partition into one (the lake is append-only otherwise)
COMPACT_MIN_FILES = int(os.environ.get("LAKE_COMPACT_MIN_FILES", "20"))
COMPACT_MIN_AGE_S = float(os.environ.get("LAKE_COMPACT_MIN_AGE_S", "120"))
COMPACT_EVERY_S = float(os.environ.get("LAKE_COMPACT_EVERY_S", "300"))

TOPIC_AUDIT = "openagrios.audit.v1"
TOPIC_TELEMETRY = "openagrios.telemetry.v1"

KAFKA_V2 = "application/vnd.kafka.v2+json"
KAFKA_JSON = "application/vnd.kafka.json.v2+json"

AUDIT_COLUMNS = [
    ("event_id", "VARCHAR"), ("ledger_epoch", "VARCHAR"), ("seq_no", "INTEGER"),
    ("organization_id", "VARCHAR"), ("correlation_id", "VARCHAR"), ("entity_type", "VARCHAR"),
    ("entity_id", "VARCHAR"), ("action", "VARCHAR"), ("actor_user_id", "VARCHAR"),
    ("actor_role", "VARCHAR"), ("gateway_status", "INTEGER"), ("before_state", "VARCHAR"),
    ("after_state", "VARCHAR"), ("prev_hash", "VARCHAR"), ("record_hash", "VARCHAR"),
    ("created_at", "TIMESTAMP"), ("before_canonical", "VARCHAR"), ("after_canonical", "VARCHAR"),
    ("ingested_at", "TIMESTAMP"),
]
TELEMETRY_COLUMNS = [
    ("machine_id", "VARCHAR"), ("organization_id", "VARCHAR"), ("ts", "TIMESTAMP"),
    ("lat", "DOUBLE"), ("lon", "DOUBLE"), ("speed_kmh", "DOUBLE"), ("fuel_pct", "DOUBLE"),
    ("status", "VARCHAR"), ("source", "VARCHAR"), ("ingested_at", "TIMESTAMP"),
]
TABLES = {
    "audit": (TOPIC_AUDIT, AUDIT_COLUMNS),
    "telemetry": (TOPIC_TELEMETRY, TELEMETRY_COLUMNS),
}

state = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "consumer": "starting",
    "rows_archived": {"audit": 0, "telemetry": 0},
    "files_written": 0,
    "files_compacted": 0,
    "commit_failures": 0,
    "rejected_events": 0,
    "last_flush_at": "",
    "last_error": "",
}
state_lock = threading.Lock()


def log(msg):
    print(f"[LAKE] {datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def set_error(msg):
    with state_lock:
        state["last_error"] = msg
    log(f"ERROR {msg}")


# --------------------------------------------------------------------------- DuckDB / S3
root = duckdb.connect(":memory:")


_ext_lock = threading.Lock()


def configure_s3(con):
    """Per-connection S3 settings. Extension loading is database-wide and NOT thread safe: two threads loading httpfs
    at once fail with "already registered secret type 's3'", so the whole step is serialised."""
    with _ext_lock:
        _configure_s3_locked(con)


def _configure_s3_locked(con):
    con.execute("LOAD httpfs")
    con.execute(f"SET s3_endpoint='{S3_ENDPOINT}'")
    con.execute("SET s3_use_ssl=false")
    con.execute("SET s3_url_style='path'")
    con.execute(f"SET s3_access_key_id='{S3_KEY}'")
    con.execute(f"SET s3_secret_access_key='{S3_SECRET}'")
    con.execute("SET s3_region='us-east-1'")


def ensure_bucket():
    """Idempotently create the lake bucket (S3 PUT bucket is a no-op when it already exists)."""
    url = f"http://{S3_ENDPOINT}/{BUCKET}"
    for attempt in range(1, 61):
        try:
            req = urllib.request.Request(url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                log(f"bucket '{BUCKET}' ready (HTTP {r.status})")
                return
        except urllib.error.HTTPError as e:
            if e.code in (200, 409):  # already exists / owned by you
                log(f"bucket '{BUCKET}' already exists (HTTP {e.code})")
                return
            set_error(f"bucket create HTTP {e.code} (attempt {attempt})")
        except Exception as e:  # object storage still booting
            set_error(f"bucket create failed: {e} (attempt {attempt})")
        time.sleep(2)
    sys.exit("object storage never became ready; failing fast")


# --------------------------------------------------------------------------- event bus (Kafka REST Proxy, Confluent REST v2 API)
def bus(method, path, body=None, accept=KAFKA_V2, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        EVENT_BUS_URL + path, data=data, method=method,
        headers={"Content-Type": KAFKA_V2, "Accept": accept},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


class Consumer:
    def __init__(self):
        self.instance = f"archiver-{uuid.uuid4().hex[:8]}"
        self.ready = False

    def connect(self):
        bus("POST", f"/consumers/{GROUP}", {
            "name": self.instance, "format": "json",
            "auto.offset.reset": "earliest", "auto.commit.enable": "false",
        })
        bus("POST", f"/consumers/{GROUP}/instances/{self.instance}/subscription",
            {"topics": [TOPIC_AUDIT, TOPIC_TELEMETRY]})
        self.ready = True
        with state_lock:
            state["consumer"] = "connected"
        log(f"consumer {self.instance} subscribed to {TOPIC_AUDIT}, {TOPIC_TELEMETRY}")

    def poll(self):
        return bus("GET", f"/consumers/{GROUP}/instances/{self.instance}/records?timeout=1000&max_bytes=1048576",
                   accept=KAFKA_JSON, timeout=15) or []

    def commit(self, offsets):
        parts = [{"topic": t, "partition": p, "offset": o} for (t, p), o in offsets.items()]
        if parts:
            bus("POST", f"/consumers/{GROUP}/instances/{self.instance}/offsets", {"offsets": parts})


# --------------------------------------------------------------------------- Parquet writing
def parse_ts(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)


def audit_row(v, now):
    return (
        v.get("event_id"), v.get("ledger_epoch", ""), v.get("seq_no"), v.get("organization_id"),
        v.get("correlation_id"), v.get("entity_type"), v.get("entity_id"), v.get("action"),
        v.get("actor_user_id"), v.get("actor_role"), v.get("gateway_status"),
        json.dumps(v.get("before_state", {}), sort_keys=True), json.dumps(v.get("after_state", {}), sort_keys=True),
        v.get("prev_hash"), v.get("record_hash"), parse_ts(v.get("created_at")),
        v.get("before_canonical"), v.get("after_canonical"), now,
    )


def telemetry_row(v, now):
    return (
        v.get("machine_id"), v.get("organization_id"), parse_ts(v.get("ts")),
        v.get("lat"), v.get("lon"), v.get("speed_kmh"), v.get("fuel_pct"),
        v.get("status"), v.get("source", "unknown"), now,
    )


ROW_BUILDERS = {"audit": audit_row, "telemetry": telemetry_row}


def write_parquet(con, table, rows):
    _, columns = TABLES[table]
    col_sql = ", ".join(f"{n} {t}" for n, t in columns)
    tmp = f"batch_{table}"
    con.execute(f"CREATE OR REPLACE TEMP TABLE {tmp} ({col_sql})")
    placeholders = ",".join("?" for _ in columns)
    con.executemany(f"INSERT INTO {tmp} VALUES ({placeholders})", rows)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"{table}/dt={day}/part-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}.parquet"
    target = f"{LAKE_ROOT}/{key}"
    if not LAKE_ROOT.startswith("s3://"):
        os.makedirs(os.path.dirname(target), exist_ok=True)
    con.execute(f"COPY {tmp} TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    con.execute(f"DROP TABLE {tmp}")
    return key


def write_pending(con, pending):
    """Write every pending table to Parquet (durable on return). Raises if any write fails: nothing is lost."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for table, values in pending.items():
        if not values:
            continue
        builder = ROW_BUILDERS[table]
        rows, rejected = [], 0
        for v in values:
            try:
                rows.append(builder(v, now))
            except Exception as e:  # malformed event: count it, never block the pipeline
                rejected += 1
                log(f"rejected malformed {table} event: {e}")
        if rows:
            key = write_parquet(con, table, rows)
            with state_lock:
                state["rows_archived"][table] += len(rows)
                state["files_written"] += 1
            log(f"wrote {len(rows)} {table} row(s) -> {LAKE_ROOT}/{key}")
        if rejected:
            with state_lock:
                state["rejected_events"] += rejected
    with state_lock:
        state["last_flush_at"] = datetime.now(timezone.utc).isoformat()


def flush(con, consumer, pending, offsets):
    """Write every pending table to Parquet, then commit offsets (at-least-once)."""
    write_pending(con, pending)
    consumer.commit(offsets)
    with state_lock:
        state["last_error"] = ""


class Pump:
    """One consume -> write -> commit cycle at a time (consume_loop drives it; tests drive it with a fake consumer).

    Invariants: a batch is written exactly once; a failed commit is retried later WITHOUT re-writing the batch
    (the data is already durable and queries de-duplicate anyway); a failed write keeps the batch for the next try.
    """

    def __init__(self, con, consumer):
        self.con = con
        self.consumer = consumer
        self.pending = {t: [] for t in TABLES}
        self.offsets = {}          # consumed but not yet written
        self.unacked = {}          # written to the lake but not yet committed to the broker
        self.last_flush = time.time()
        self.topic_to_table = {topic: table for table, (topic, _) in TABLES.items()}

    def step(self):
        if not self.consumer.ready:
            self.consumer.connect()
        for rec in self.consumer.poll():
            table = self.topic_to_table.get(rec.get("topic"))
            if table and isinstance(rec.get("value"), dict):
                self.pending[table].append(rec["value"])
                key = (rec["topic"], rec["partition"])
                self.offsets[key] = max(rec["offset"], self.offsets.get(key, -1))
        total = sum(len(v) for v in self.pending.values())
        if total and (total >= BATCH_MAX or time.time() - self.last_flush >= FLUSH_SECONDS):
            write_pending(self.con, self.pending)          # raises -> pending kept and retried
            self.pending = {t: [] for t in TABLES}
            for key, off in self.offsets.items():
                self.unacked[key] = max(off, self.unacked.get(key, -1))
            self.offsets = {}
            self.last_flush = time.time()
        elif not total:
            self.last_flush = time.time()
        if self.unacked:
            try:
                self.consumer.commit(self.unacked)
                self.unacked = {}
                with state_lock:
                    state["last_error"] = ""
            except Exception as e:
                with state_lock:
                    state["commit_failures"] += 1
                set_error(f"offset commit failed (will retry, batch NOT re-written): {type(e).__name__}: {e}")


def consume_loop():
    con = root.cursor()
    configure_s3(con)
    pump = Pump(con, Consumer())
    while True:
        try:
            pump.step()
        except urllib.error.HTTPError as e:
            if e.code == 404:  # consumer expired server-side: rejoin; uncommitted records are replayed and de-duplicated
                pump.consumer = Consumer()
                pump.unacked = {}
                with state_lock:
                    state["consumer"] = "rejoining"
            set_error(f"event bus HTTP {e.code}")
            time.sleep(2)
        except Exception as e:
            with state_lock:
                state["consumer"] = "disconnected"
            pump.consumer.ready = False
            set_error(f"consume loop: {type(e).__name__}: {e}")
            time.sleep(3)


# --------------------------------------------------------------------------- compaction of small files
PART_RE = re.compile(r"(?:^|/)part-(\d+)-[0-9a-f]+\.parquet$")


def list_keys(prefix):
    """Object keys (relative to the lake root) under prefix, for either a local directory or the S3 bucket."""
    if not LAKE_ROOT.startswith("s3://"):
        base = os.path.join(LAKE_ROOT, prefix)
        out = []
        for dirpath, _, files in os.walk(base):
            for f in files:
                out.append(os.path.relpath(os.path.join(dirpath, f), LAKE_ROOT).replace(os.sep, "/"))
        return sorted(out)
    keys, marker = [], ""
    while True:
        q = urllib.parse.urlencode({"prefix": prefix, "marker": marker, "max-keys": 1000})
        with urllib.request.urlopen(f"http://{S3_ENDPOINT}/{BUCKET}?{q}", timeout=20) as r:
            body = r.read().decode()
        page = re.findall(r"<Key>([^<]+)</Key>", body)
        keys.extend(page)
        if "<IsTruncated>true</IsTruncated>" not in body or not page:
            return keys
        marker = page[-1]


def delete_key(key):
    if not LAKE_ROOT.startswith("s3://"):
        os.remove(os.path.join(LAKE_ROOT, key))
        return
    req = urllib.request.Request(f"http://{S3_ENDPOINT}/{BUCKET}/{key}", method="DELETE")
    with urllib.request.urlopen(req, timeout=20):
        pass


DEDUPE_KEYS = {"audit": "ledger_epoch, event_id", "telemetry": "organization_id, machine_id, ts"}


def compact_once(con, now=None):
    """Merge old small files of each day partition into one compact file. Returns the number of files removed.

    Safety order: write the merged file, check that it holds exactly the distinct rows of the sources, only then delete
    the sources. Readers de-duplicate, so a query that sees both generations still returns correct results.
    """
    now = now if now is not None else time.time()
    removed = 0
    for table in TABLES:
        by_partition = {}
        for key in list_keys(f"{table}/"):
            m = PART_RE.search(key)
            if m and now - int(m.group(1)) / 1000.0 >= COMPACT_MIN_AGE_S:
                by_partition.setdefault(key.rsplit("/", 1)[0], []).append(key)
        for partition, keys in by_partition.items():
            if len(keys) < COMPACT_MIN_FILES:
                continue
            sources = ", ".join(f"'{LAKE_ROOT}/{k}'" for k in keys)
            dedupe = f"QUALIFY row_number() OVER (PARTITION BY {DEDUPE_KEYS[table]} ORDER BY ingested_at) = 1"
            target = f"{partition}/compact-{int(now * 1000)}-{uuid.uuid4().hex[:6]}.parquet"
            expected = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM read_parquet([{sources}], union_by_name=true) {dedupe})").fetchone()[0]
            if not LAKE_ROOT.startswith("s3://"):
                os.makedirs(os.path.dirname(os.path.join(LAKE_ROOT, target)), exist_ok=True)
            con.execute(f"COPY (SELECT * FROM read_parquet([{sources}], union_by_name=true) {dedupe}) "
                        f"TO '{LAKE_ROOT}/{target}' (FORMAT PARQUET, COMPRESSION ZSTD)")
            written = con.execute(f"SELECT count(*) FROM read_parquet('{LAKE_ROOT}/{target}')").fetchone()[0]
            if written != expected:
                delete_key(target)
                raise RuntimeError(f"compaction check failed for {partition}: wrote {written}, expected {expected}; sources kept")
            for k in keys:
                delete_key(k)
            removed += len(keys)
            with state_lock:
                state["files_compacted"] += len(keys)
            log(f"compacted {len(keys)} {table} file(s) in {partition} -> {target} ({written} row(s))")
    return removed


def supervised(name, fn, retry_s=5.0, max_restarts=None):
    """Runs a worker forever. A worker that dies is reported (never silently) and restarted."""
    restarts = 0
    while True:
        try:
            fn()
        except Exception as e:
            with state_lock:
                state["worker_restarts"] = state.get("worker_restarts", 0) + 1
                if name == "consumer":
                    state["consumer"] = "crashed"
            set_error(f"{name} thread crashed, restarting in {retry_s}s: {type(e).__name__}: {e}")
        restarts += 1
        if max_restarts is not None and restarts >= max_restarts:
            return
        time.sleep(retry_s)


def compaction_loop():
    con = root.cursor()
    configure_s3(con)
    while True:
        time.sleep(COMPACT_EVERY_S)
        try:
            compact_once(con)
        except Exception as e:
            set_error(f"compaction: {type(e).__name__}: {e}")


# --------------------------------------------------------------------------- analytics (DuckDB over Parquet)
def audit_view():
    return (
        f"(SELECT * FROM read_parquet('{LAKE_ROOT}/audit/*/*.parquet', hive_partitioning=true, union_by_name=true) "
        "WHERE organization_id = ? "
        "QUALIFY row_number() OVER (PARTITION BY ledger_epoch, event_id ORDER BY ingested_at) = 1)"
    )


def telemetry_view():
    return (
        f"(SELECT * FROM read_parquet('{LAKE_ROOT}/telemetry/*/*.parquet', hive_partitioning=true) "
        "WHERE organization_id = ? "
        "QUALIFY row_number() OVER (PARTITION BY machine_id, ts ORDER BY ingested_at) = 1)"
    )


def rows_as_dicts(cur):
    cols = [d[0] for d in cur.description]
    out = []
    for r in cur.fetchall():
        out.append({c: (v.isoformat() if isinstance(v, (datetime, date)) else v) for c, v in zip(cols, r)})
    return out


def run_query(name, org):
    status, body = _run_query(name, org)
    if status == 503 and body.get("error") == "lake_io_error":
        status, body = _run_query(name, org)  # a compaction may have replaced a file between listing and reading
    return status, body


def _run_query(name, org):
    con = root.cursor()
    if LAKE_ROOT.startswith("s3://"):
        configure_s3(con)
    result = {"query": name, "organization_id": org, "source": f"parquet://{BUCKET}", "engine": "DuckDB"}
    try:
        if name == "actions-by-day":
            cur = con.execute(
                f"SELECT CAST(created_at AS DATE) AS day, action, count(*) AS events FROM {audit_view()} "
                "GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC", [org])
            result["rows"] = rows_as_dicts(cur)
        elif name == "machine-utilization":
            cur = con.execute(
                f"""WITH t AS (
                        SELECT machine_id, ts, lat, lon, speed_kmh, fuel_pct,
                               lag(lat) OVER w AS plat, lag(lon) OVER w AS plon
                        FROM {telemetry_view()} WINDOW w AS (PARTITION BY machine_id ORDER BY ts))
                    SELECT machine_id,
                           count(*) AS samples,
                           round(avg(speed_kmh), 2) AS avg_speed_kmh,
                           round(min(fuel_pct), 1) AS min_fuel_pct,
                           round(sum(CASE WHEN plat IS NULL THEN 0 ELSE
                               2 * 6371.0088 * asin(sqrt(
                                   pow(sin(radians(lat - plat) / 2), 2) +
                                   cos(radians(plat)) * cos(radians(lat)) * pow(sin(radians(lon - plon) / 2), 2)))
                           END), 3) AS distance_km,
                           max(ts) AS last_seen
                    FROM t GROUP BY machine_id ORDER BY distance_km DESC""", [org])
            result["rows"] = rows_as_dicts(cur)
        elif name == "summary":
            a = con.execute(
                f"SELECT count(*) AS events, count(DISTINCT correlation_id) AS workflows, "
                f"min(created_at) AS first_event, max(created_at) AS last_event FROM {audit_view()}", [org])
            result["audit"] = rows_as_dicts(a)[0]
            try:
                t = con.execute(
                    f"SELECT count(*) AS samples, count(DISTINCT machine_id) AS machines, "
                    f"max(ts) AS last_sample FROM {telemetry_view()}", [org])
                result["telemetry"] = rows_as_dicts(t)[0]
            except duckdb.IOException:
                result["telemetry"] = {"samples": 0, "machines": 0, "last_sample": None}
            result["archiver"] = snapshot()
        else:
            return 404, {"error": "unknown_query", "message": name}
        result["lake_empty"] = False
        return 200, result
    except duckdb.IOException as e:
        if "No files found" in str(e) or "no files" in str(e).lower():
            result["lake_empty"] = True
            result["rows"] = []
            return 200, result
        set_error(f"query {name}: {e}")
        return 503, {"error": "lake_io_error", "message": str(e)}
    except Exception as e:
        set_error(f"query {name}: {type(e).__name__}: {e}")
        return 500, {"error": "query_failed", "message": str(e)}


def snapshot():
    with state_lock:
        return json.loads(json.dumps(state))


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        raw = json.dumps(body, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/health":
            snap = snapshot()
            self._send(200, {"status": "UP", **snap})
            return
        if url.path == "/metrics":  # Prometheus text exposition
            snap = snapshot()
            lines = [
                "# TYPE openagrios_lake_rows_archived_total counter",
                f'openagrios_lake_rows_archived_total{{table="audit"}} {snap["rows_archived"]["audit"]}',
                f'openagrios_lake_rows_archived_total{{table="telemetry"}} {snap["rows_archived"]["telemetry"]}',
                "# TYPE openagrios_lake_files_written_total counter",
                f"openagrios_lake_files_written_total {snap['files_written']}",
                "# TYPE openagrios_lake_rejected_events_total counter",
                f"openagrios_lake_rejected_events_total {snap['rejected_events']}",
                "# TYPE openagrios_lake_files_compacted_total counter",
                f"openagrios_lake_files_compacted_total {snap['files_compacted']}",
                "# TYPE openagrios_lake_commit_failures_total counter",
                f"openagrios_lake_commit_failures_total {snap['commit_failures']}",
                "# TYPE openagrios_lake_consumer_connected gauge",
                f"openagrios_lake_consumer_connected {1 if snap['consumer'] == 'connected' else 0}",
            ]
            raw = ("\n".join(lines) + "\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if url.path.startswith("/analytics/"):
            org = urllib.parse.parse_qs(url.query).get("org", [""])[0]
            if not org:
                self._send(400, {"error": "missing_org", "message": "org query parameter is required"})
                return
            status, body = run_query(url.path[len("/analytics/"):], org)
            self._send(status, body)
            return
        self._send(404, {"error": "not_found"})

    def log_message(self, fmt, *args):
        return  # request logging is handled by the gateway


def main():
    ensure_bucket()
    threading.Thread(target=supervised, args=("consumer", consume_loop), name="consumer", daemon=True).start()
    threading.Thread(target=supervised, args=("compactor", compaction_loop), name="compactor", daemon=True).start()
    log(f"analytics API listening on :{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
