#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 FloodOS Contributors
#
# Builds public/basemap/hanoi.pmtiles: an OpenStreetMap-based vector basemap for the Hanoi pilot area, served by the
# web app itself so the map works with no Internet and no third-party tile server.
#
# Data: OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright), via the Protomaps daily build.
# Tool: go-pmtiles (BSD-3-Clause), https://github.com/protomaps/go-pmtiles/releases
#
# Usage:   PMTILES_BIN=/path/to/pmtiles ./tools/fetch-basemap.sh [YYYYMMDD]
# Needs:   network access to build.protomaps.com (download is a few tens of MB, one time).
set -euo pipefail

PMTILES_BIN="${PMTILES_BIN:-pmtiles}"
# west,south,east,north: the pilot area (inner Hanoi plus the Red River / Hồ Tây / Hoàng Mai flood belt). z15 holds the full building
# footprints that the 3D view extrudes (z14 only has the larger ones); keep the box tight, size grows about 4x per zoom level.
BBOX="${BBOX:-105.72,20.93,105.95,21.12}"
MAXZOOM="${MAXZOOM:-15}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/basemap/hanoi.pmtiles"

build_date="${1:-}"
if [ -z "$build_date" ]; then
  # newest daily build that exists (today, else going back up to 10 days)
  for i in $(seq 0 10); do
    d="$(date -u -d "-$i day" +%Y%m%d)"
    if curl -fsI -o /dev/null "https://build.protomaps.com/$d.pmtiles"; then build_date="$d"; break; fi
  done
fi
[ -n "$build_date" ] || { echo "no Protomaps build found in the last 10 days" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
echo "extracting $BBOX (z0-$MAXZOOM) from build $build_date -> $OUT"
"$PMTILES_BIN" extract "https://build.protomaps.com/$build_date.pmtiles" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM"
ls -l "$OUT"
