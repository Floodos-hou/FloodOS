# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""
OpenDXOS device SIMULATOR (demo only: there is no physical hardware and no official gauge).

Emulates two kinds of field devices and says so on every message ("source": "SIMULATOR"):
  * the GPS/fuel unit of each rescue vehicle  -> openagrios/<org>/vehicles/<id>/telemetry
  * a water-level gauge per monitored zone    -> openagrios/<org>/gauges/<id>/telemetry
It speaks the real protocol (authenticated MQTT), so the samples travel through exactly the same
ingestor -> core -> Kafka -> Parquet path real devices would use. The roster and starting values are read
from the core (no duplicated seed data).

Honesty rules baked into the behaviour:
  * a vehicle moves in a STRAIGHT LINE toward its order's zone while it is MOVING or WORKING; this is not a route;
  * BREAKDOWN, MAINTENANCE and IDLE vehicles stay still, so telemetry never contradicts the workflow state;
  * gauge levels are a bounded random walk, not a forecast and not an observation.
"""
import json
import math
import os
import random
import sys
import time
import urllib.request
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER", "")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
CORE_URL = os.environ.get("CORE_URL", "http://core-api:8000").rstrip("/")
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
INTERVAL_S = float(os.environ.get("SIM_INTERVAL_S", "2"))
REFRESH_S = float(os.environ.get("SIM_ASSET_REFRESH_S", "5"))
# Demo time-lapse: vehicles move TIMELAPSE x faster than real life so motion is visible on a map.
# 1 = real speed. The reported speed is capped at the core's 80 km/h validation limit.
TIMELAPSE = max(1.0, float(os.environ.get("SIM_TIMELAPSE", "1")))
MAX_REPORTED_SPEED_KMH = 80.0

TRAVEL_SPEED_KMH = 12.0
ARRIVAL_RADIUS_M = 30.0
FUEL_BURN_PCT_PER_SAMPLE = 0.02
MOVING_STATUSES = {"MOVING", "WORKING"}
SOURCE = "SIMULATOR"


def log(msg):
    print(f"[SIM] {datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def fetch_assets():
    req = urllib.request.Request(CORE_URL + "/api/v1/internal/assets", headers={"X-Ingest-Token": INGEST_TOKEN})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())["assets"]


def wait_for_assets():
    for attempt in range(1, 121):
        try:
            assets = fetch_assets()
            if assets:
                return assets
        except Exception as e:
            if attempt % 5 == 1:
                log(f"waiting for core asset roster ({type(e).__name__}: {e})")
        time.sleep(2)
    sys.exit("core never served an asset roster; failing fast")


def metres_between(lat1, lon1, lat2, lon2):
    dy = (lat2 - lat1) * 111_320.0
    dx = (lon2 - lon1) * 111_320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def advance_vehicle(v, interval_s, timelapse):
    """Moves a MOVING/WORKING vehicle in a straight line toward its target. Returns the speed reported (km/h)."""
    if v.get("target_lat") is None:
        return 0.0
    remaining_m = metres_between(v["lat"], v["lon"], v["target_lat"], v["target_lon"])
    if remaining_m <= ARRIVAL_RADIUS_M:
        return 0.0
    speed = TRAVEL_SPEED_KMH * timelapse
    step_m = min(remaining_m, speed * 1000.0 * interval_s / 3600.0)
    frac = step_m / remaining_m
    v["lat"] += (v["target_lat"] - v["lat"]) * frac
    v["lon"] += (v["target_lon"] - v["lon"]) * frac
    v["fuel_pct"] = max(5.0, v["fuel_pct"] - FUEL_BURN_PCT_PER_SAMPLE)
    return min(MAX_REPORTED_SPEED_KMH, speed)


def advance_gauge(g, timelapse):
    """Bounded random walk with a mild pull toward the warning level so the demo shows the thresholds."""
    pull = (g["warn_level_cm"] * 0.9 - g["level_cm"]) * 0.002
    step = pull + random.uniform(-0.6, 0.8) * timelapse
    g["level_cm"] = min(g["critical_level_cm"] * 1.3, max(0.0, g["level_cm"] + step))


def main():
    if not (INGEST_TOKEN and MQTT_USER and MQTT_PASSWORD):
        sys.exit("INGEST_TOKEN, MQTT_USER and MQTT_PASSWORD are required; failing fast")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="opendxos-device-simulator")
    client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()

    assets = {(a["asset_kind"], a["asset_id"]): dict(a) for a in wait_for_assets()}
    log(f"simulating {len(assets)} asset(s) every {INTERVAL_S}s (time-lapse x{TIMELAPSE:g}), source={SOURCE}")
    last_refresh = time.time()

    while True:
        if time.time() - last_refresh >= REFRESH_S:
            try:
                for row in fetch_assets():
                    key = (row["asset_kind"], row["asset_id"])
                    cur = assets.get(key)
                    if cur is None:
                        assets[key] = dict(row)
                        continue
                    if row["asset_kind"] == "vehicle":
                        cur["status"] = row["status"]
                        cur["target_lat"], cur["target_lon"] = row.get("target_lat"), row.get("target_lon")
                        # the workflow (e.g. a re-plan) may have moved the vehicle: follow the core
                        if metres_between(cur["lat"], cur["lon"], row["lat"], row["lon"]) > 50:
                            cur["lat"], cur["lon"] = row["lat"], row["lon"]
                        cur["fuel_pct"] = row["fuel_pct"]
                    else:
                        cur["warn_level_cm"], cur["critical_level_cm"] = row["warn_level_cm"], row["critical_level_cm"]
            except Exception as e:
                log(f"asset refresh failed: {type(e).__name__}: {e}")
            last_refresh = time.time()

        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for (kind, asset_id), a in assets.items():
            if kind == "vehicle":
                speed = advance_vehicle(a, INTERVAL_S, TIMELAPSE) if a["status"] in MOVING_STATUSES else 0.0
                payload = {"ts": ts, "source": SOURCE, "lat": round(a["lat"], 6), "lon": round(a["lon"], 6),
                           "fuel_pct": round(a["fuel_pct"], 2), "speed_kmh": speed}
                topic = f"openagrios/{a['organization_id']}/vehicles/{asset_id}/telemetry"
            else:
                if a.get("level_cm") is None:
                    a["level_cm"] = 0.0
                advance_gauge(a, TIMELAPSE)
                payload = {"ts": ts, "source": SOURCE, "level_cm": round(a["level_cm"], 1)}
                topic = f"openagrios/{a['organization_id']}/gauges/{asset_id}/telemetry"
            info = client.publish(topic, json.dumps(payload), qos=1)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                log(f"publish to {topic} failed rc={info.rc}")
        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    main()
