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
    ("created_at", "TIMESTAMP"), ("ingested_at", "TIMESTAMP"),
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


def configure_s3(con):
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
            bus("POST", f"/consumers/{GROUP}/instances/{self.instance}/offsets", {"partitions": parts})


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
        v.get("prev_hash"), v.get("record_hash"), parse_ts(v.get("created_at")), now,
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


def flush(con, consumer, pending, offsets):
    """Write every pending table to Parquet, then commit offsets (at-least-once)."""
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
    consumer.commit(offsets)
    with state_lock:
        state["last_flush_at"] = datetime.now(timezone.utc).isoformat()
        state["last_error"] = ""


def consume_loop():
    con = root.cursor()
    configure_s3(con)
    consumer = Consumer()
    pending = {t: [] for t in TABLES}
    offsets = {}
    last_flush = time.time()
    topic_to_table = {topic: table for table, (topic, _) in TABLES.items()}
    while True:
        try:
            if not consumer.ready:
                consumer.connect()
            for rec in consumer.poll():
                table = topic_to_table.get(rec.get("topic"))
                if table and isinstance(rec.get("value"), dict):
                    pending[table].append(rec["value"])
                    offsets[(rec["topic"], rec["partition"])] = rec["offset"]
            total = sum(len(v) for v in pending.values())
            if total and (total >= BATCH_MAX or time.time() - last_flush >= FLUSH_SECONDS):
                flush(con, consumer, pending, offsets)
                pending = {t: [] for t in TABLES}
                offsets = {}
                last_flush = time.time()
            elif not total:
                last_flush = time.time()
        except urllib.error.HTTPError as e:
            if e.code == 404:  # consumer expired server-side: rejoin and replay uncommitted records
                consumer = Consumer()
                with state_lock:
                    state["consumer"] = "rejoining"
            set_error(f"event bus HTTP {e.code}")
            time.sleep(2)
        except Exception as e:
            with state_lock:
                state["consumer"] = "disconnected"
            consumer.ready = False
            set_error(f"consume loop: {type(e).__name__}: {e}")
            time.sleep(3)


# --------------------------------------------------------------------------- analytics (DuckDB over Parquet)
def audit_view():
    return (
        f"(SELECT * FROM read_parquet('{LAKE_ROOT}/audit/*/*.parquet', hive_partitioning=true) "
        "WHERE organization_id = ? "
        "QUALIFY row_number() OVER (PARTITION BY ledger_epoch, event_id ORDER BY ingested_at) = 1)"
    )


def telemetry_view():
    return (
        f"(SELECT * FROM read_parquet('{LAKE_ROOT}/telemetry/*/*.parquet', hive_partitioning=true) "
        "WHERE organization_id = ?)"
    )


def rows_as_dicts(cur):
    cols = [d[0] for d in cur.description]
    out = []
    for r in cur.fetchall():
        out.append({c: (v.isoformat() if isinstance(v, (datetime, date)) else v) for c, v in zip(cols, r)})
    return out


def run_query(name, org):
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
    threading.Thread(target=consume_loop, name="consumer", daemon=True).start()
    log(f"analytics API listening on :{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
