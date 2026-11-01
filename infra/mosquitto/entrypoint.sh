#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
#
# Idempotent boot script: regenerates credentials + least-privilege ACL, then starts Mosquitto.
#   device   : may only PUBLISH  openagrios/<org>/machines/<id>/telemetry
#   ingestor : may only SUBSCRIBE to that same topic family
set -eu

: "${MQTT_DEVICE_USER:?MQTT_DEVICE_USER is required}"
: "${MQTT_DEVICE_PASSWORD:?MQTT_DEVICE_PASSWORD is required}"
: "${MQTT_INGESTOR_USER:?MQTT_INGESTOR_USER is required}"
: "${MQTT_INGESTOR_PASSWORD:?MQTT_INGESTOR_PASSWORD is required}"

CONF=/mosquitto/config
mkdir -p "$CONF" /mosquitto/data
cp /mosquitto/src/mosquitto.conf "$CONF/mosquitto.conf"

: > "$CONF/passwd"
mosquitto_passwd -b "$CONF/passwd" "$MQTT_DEVICE_USER" "$MQTT_DEVICE_PASSWORD"
mosquitto_passwd -b "$CONF/passwd" "$MQTT_INGESTOR_USER" "$MQTT_INGESTOR_PASSWORD"

cat > "$CONF/acl" <<ACL
user $MQTT_DEVICE_USER
topic write openagrios/+/machines/+/telemetry

user $MQTT_INGESTOR_USER
topic read openagrios/+/machines/+/telemetry
ACL

chown -R mosquitto:mosquitto "$CONF" /mosquitto/data 2>/dev/null || true
chmod 0700 "$CONF/passwd" "$CONF/acl"
exec mosquitto -c "$CONF/mosquitto.conf"
