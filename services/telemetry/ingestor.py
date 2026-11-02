# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""
OpenDXOS OT telemetry ingestor.

MQTT (Mosquitto) -> validate -> Core API internal endpoint -> digital twin + Kafka telemetry topic.

Devices publish to
    openagrios/<organization_id>/vehicles/<vehicle_id>/telemetry   {lat, lon, fuel_pct, [speed_kmh], source, [ts]}
    openagrios/<organization_id>/gauges/<station_id>/telemetry     {level_cm, source, [ts]}
Every message must say where it comes from ("source": SIMULATOR or DEVICE); a message without a known source is
rejected, so a simulated value can never be stored as an observation.
This service is the only MQTT subscriber (least-privilege ACL) and the only caller of the core's
internal endpoint, authenticated with a shared secret. Messages are rejected, never silently
dropped: every outcome is counted and exposed on /metrics (Prometheus text format) and /health.
"""
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import paho.mqtt.client as mqtt

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER", "")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
CORE_URL = os.environ.get("CORE_URL", "http://core-api:8000").rstrip("/")
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
PORT = int(os.environ.get("PORT", "8091"))

SUBSCRIPTIONS = ("openagrios/+/vehicles/+/telemetry", "openagrios/+/gauges/+/telemetry")
TOPIC_RE = re.compile(r"^openagrios/([A-Za-z0-9_-]+)/(vehicles|gauges)/([A-Za-z0-9_-]+)/telemetry$")
KIND_BY_SEGMENT = {"vehicles": "vehicle", "gauges": "gauge"}
ALLOWED_SOURCES = ("SIMULATOR", "DEVICE")
MAX_PAYLOAD_BYTES = 2048

stats_lock = threading.Lock()
stats = {
    "received": 0,
    "forwarded": 0,
    "rejected_invalid": 0,       # failed local validation
    "rejected_by_core": 0,       # core answered 4xx (unknown asset, tenant mismatch, range)
    "forward_failed": 0,         # core unreachable / 5xx
    "mqtt_connected": 0,
    "last_message_at": "",
    "last_error": "",
}


def log(msg):
    print(f"[INGEST] {datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def bump(key, error=None):
    with stats_lock:
        stats[key] += 1
        if error:
            stats["last_error"] = error
    if error:
        log(f"{key}: {error}")


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate(topic, raw):
    """Return (payload, None) or (None, reason)."""
    m = TOPIC_RE.match(topic)
    if not m:
        return None, f"topic '{topic}' does not match openagrios/<org>/<vehicles|gauges>/<id>/telemetry"
    org, segment, asset_id = m.groups()
    kind = KIND_BY_SEGMENT[segment]
    if len(raw) > MAX_PAYLOAD_BYTES:
        return None, f"payload too large ({len(raw)} bytes)"
    try:
        data = json.loads(raw)
    except ValueError:
        return None, "payload is not valid JSON"
    if not isinstance(data, dict):
        return None, "payload must be a JSON object"
    for key, expected in (("organization_id", org), ("asset_id", asset_id)):
        if key in data and data[key] != expected:
            return None, f"{key} in payload ({data[key]!r}) does not match topic ({expected!r})"
    source = data.get("source")
    if source not in ALLOWED_SOURCES:
        return None, f"'source' must be one of {ALLOWED_SOURCES} (got {source!r})"
    ts = data.get("ts") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None, "'ts' must be ISO-8601"
    payload = {"asset_kind": kind, "asset_id": asset_id, "organization_id": org, "ts": ts, "source": source}
    if kind == "vehicle":
        for key in ("lat", "lon", "fuel_pct"):
            if not is_number(data.get(key)):
                return None, f"'{key}' must be a finite number"
        if "speed_kmh" in data and not is_number(data["speed_kmh"]):
            return None, "'speed_kmh' must be a finite number"
        payload.update({"lat": data["lat"], "lon": data["lon"], "fuel_pct": data["fuel_pct"],
                        "speed_kmh": data.get("speed_kmh", 0.0)})
    else:
        if not is_number(data.get("level_cm")):
            return None, "'level_cm' must be a finite number"
        payload["level_cm"] = data["level_cm"]
    return payload, None


def forward(payload):
    req = urllib.request.Request(
        CORE_URL + "/api/v1/internal/telemetry", method="POST",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Ingest-Token": INGEST_TOKEN},
    )
    try:
        with urllib.request.urlopen(req, timeout=5):
            bump("forwarded")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:200]
        if 400 <= e.code < 500:
            bump("rejected_by_core", f"core HTTP {e.code} for {payload['asset_id']}: {detail}")
        else:
            bump("forward_failed", f"core HTTP {e.code}: {detail}")
    except Exception as e:
        bump("forward_failed", f"{type(e).__name__}: {e}")


def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code.is_failure:
        bump("forward_failed", f"MQTT connect refused: {reason_code}")
        return
    for topic in SUBSCRIPTIONS:
        client.subscribe(topic, qos=1)
    with stats_lock:
        stats["mqtt_connected"] = 1
    log(f"connected to {MQTT_HOST}:{MQTT_PORT}, subscribed to {", ".join(SUBSCRIPTIONS)}")


def on_disconnect(client, userdata, flags, reason_code, properties):
    with stats_lock:
        stats["mqtt_connected"] = 0
    log(f"disconnected from broker: {reason_code}")


def on_message(client, userdata, msg):
    with stats_lock:
        stats["received"] += 1
        stats["last_message_at"] = datetime.now(timezone.utc).isoformat()
    payload, reason = validate(msg.topic, msg.payload)
    if reason:
        bump("rejected_invalid", f"{msg.topic}: {reason}")
        return
    forward(payload)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, ctype="application/json; charset=utf-8"):
        raw = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        with stats_lock:
            snap = dict(stats)
        if self.path == "/health":
            self._send(200 if snap["mqtt_connected"] else 503,
                       {"status": "UP" if snap["mqtt_connected"] else "DEGRADED", **snap})
        elif self.path == "/metrics":
            lines = []
            for name in ("received", "forwarded", "rejected_invalid", "rejected_by_core", "forward_failed"):
                lines += [f"# TYPE openagrios_telemetry_{name}_total counter",
                          f"openagrios_telemetry_{name}_total {snap[name]}"]
            lines += ["# TYPE openagrios_telemetry_mqtt_connected gauge",
                      f"openagrios_telemetry_mqtt_connected {snap['mqtt_connected']}"]
            self._send(200, "\n".join(lines) + "\n", "text/plain; version=0.0.4")
        else:
            self._send(404, {"error": "not_found"})

    def log_message(self, fmt, *args):
        return


def main():
    if not INGEST_TOKEN:
        sys.exit("INGEST_TOKEN is required (must equal the core's OPENAGRIOS_INGEST_TOKEN); failing fast")
    if not MQTT_USER or not MQTT_PASSWORD:
        sys.exit("MQTT_USER and MQTT_PASSWORD are required; failing fast")
    threading.Thread(target=lambda: ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever(),
                     daemon=True).start()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="openagrios-telemetry-ingestor")
    client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.on_connect, client.on_disconnect, client.on_message = on_connect, on_disconnect, on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    log(f"connecting to MQTT {MQTT_HOST}:{MQTT_PORT}; forwarding to {CORE_URL}")
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_forever(retry_first_connection=True)


if __name__ == "__main__":
    main()
