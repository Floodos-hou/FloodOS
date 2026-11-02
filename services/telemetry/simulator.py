# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
"""
OpenAgriOS device SIMULATOR (demo only - there is no physical hardware).

Emulates the GPS/fuel telemetry unit of each harvester. It speaks the real protocol: authenticated
MQTT publishes to openagrios/<org>/machines/<id>/telemetry, which then travel through exactly the same
ingestor -> core -> Kafka -> Parquet path real devices would use. The roster and starting positions are
read from the core (no duplicated seed data). Only WORKING machines move; broken or idle machines stay
still, so simulated telemetry never contradicts the workflow state.
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
REFRESH_S = float(os.environ.get("SIM_FLEET_REFRESH_S", "5"))
# Demo time-lapse: machines move TIMELAPSE x faster than real life so motion is visible on a 14-zoom map.
# 1 = real speed. The reported speed is capped at the core's 80 km/h validation limit.
TIMELAPSE = max(1.0, float(os.environ.get("SIM_TIMELAPSE", "1")))
MAX_REPORTED_SPEED_KMH = 80.0

WORKING_SPEED_KMH = 6.0
FUEL_BURN_PCT_PER_SAMPLE = 0.02
STILL_STATUSES = {"BREAKDOWN", "MAINTENANCE", "UNDER_REPAIR"}


def log(msg):
    print(f"[SIM] {datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def fetch_fleet():
    req = urllib.request.Request(CORE_URL + "/api/v1/internal/fleet", headers={"X-Ingest-Token": INGEST_TOKEN})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())["machines"]


def wait_for_fleet():
    for attempt in range(1, 121):
        try:
            fleet = fetch_fleet()
            if fleet:
                return fleet
        except Exception as e:
            if attempt % 5 == 1:
                log(f"waiting for core fleet roster ({type(e).__name__}: {e})")
        time.sleep(2)
    sys.exit("core never served a fleet roster; failing fast")


def metres_between(lat1, lon1, lat2, lon2):
    dy = (lat2 - lat1) * 111_320.0
    dx = (lon2 - lon1) * 111_320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def advance(m, interval_s, timelapse, turn_deg):
    """Moves one WORKING machine along its (slowly turning) heading. Returns the speed reported in the sample (km/h)."""
    speed = WORKING_SPEED_KMH * timelapse
    m["heading"] = (m["heading"] + turn_deg) % 360
    dist_km = speed * interval_s / 3600.0
    h = math.radians(m["heading"])
    m["lat"] += dist_km * math.cos(h) / 111.32
    m["lon"] += dist_km * math.sin(h) / (111.32 * math.cos(math.radians(m["lat"])))
    m["fuel_pct"] = max(5.0, m["fuel_pct"] - FUEL_BURN_PCT_PER_SAMPLE)
    return min(MAX_REPORTED_SPEED_KMH, speed)


def main():
    if not (INGEST_TOKEN and MQTT_USER and MQTT_PASSWORD):
        sys.exit("INGEST_TOKEN, MQTT_USER and MQTT_PASSWORD are required; failing fast")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="openagrios-device-simulator")
    client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()

    machines = {m["machine_id"]: dict(m, heading=random.uniform(0, 360)) for m in wait_for_fleet()}
    log(f"simulating {len(machines)} machine(s) every {INTERVAL_S}s (time-lapse x{TIMELAPSE:g}): {', '.join(sorted(machines))}")
    last_refresh = time.time()

    while True:
        if time.time() - last_refresh >= REFRESH_S:
            try:
                for row in fetch_fleet():
                    cur = machines.get(row["machine_id"])
                    if cur is None:
                        machines[row["machine_id"]] = dict(row, heading=random.uniform(0, 360))
                        continue
                    cur["status"] = row["status"]
                    # the workflow (e.g. a rescue re-plan) may have moved the machine: follow the core
                    if metres_between(cur["lat"], cur["lon"], row["lat"], row["lon"]) > 50:
                        cur["lat"], cur["lon"] = row["lat"], row["lon"]
                    cur["fuel_pct"] = row["fuel_pct"]
            except Exception as e:
                log(f"fleet refresh failed: {type(e).__name__}: {e}")
            last_refresh = time.time()

        for m in machines.values():
            speed = 0.0
            if m["status"] == "WORKING":
                speed = advance(m, INTERVAL_S, TIMELAPSE, random.uniform(-15, 15))
            payload = {
                "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "lat": round(m["lat"], 6), "lon": round(m["lon"], 6),
                "fuel_pct": round(m["fuel_pct"], 2), "speed_kmh": speed,
            }
            topic = f"openagrios/{m['organization_id']}/machines/{m['machine_id']}/telemetry"
            info = client.publish(topic, json.dumps(payload), qos=1)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                log(f"publish to {topic} failed rc={info.rc}")
        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    main()
