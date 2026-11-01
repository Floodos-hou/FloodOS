#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
#
# Runs every fast, dependency-free unit suite (no running stack required):
#   1. Java  : tests/unit/*  (JSON, scheduling, geodesy, tenancy, audit chain, JWT/PKCE, adapters, HTTP layer)
#   2. Python: services/lake-archiver/tests (real DuckDB + Parquet) and services/telemetry/tests
# Python suites run in a throw-away python:3.12-slim container (same runtime as production images) unless
# SKIP_PYTHON=1. Exit code is non-zero if any suite fails.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0

echo "=== [1/2] Java unit tests ==="
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
find core apps tests -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 -d "$OUT/classes" @"$OUT/sources.txt"
java -Dfile.encoding=UTF-8 -cp "$OUT/classes" org.openagrios.tests.unit.UnitTestRunner || status=1

if [ "${SKIP_PYTHON:-0}" = "1" ]; then
    echo "=== [2/2] Python unit tests skipped (SKIP_PYTHON=1) ==="
    exit "$status"
fi

echo "=== [2/2] Python unit tests (container) ==="
# MSYS_NO_PATHCONV keeps Git-Bash on Windows from rewriting the container paths.
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/services:/svc:ro" -w /svc python:3.12-slim sh -c '
    pip install --quiet --no-cache-dir --disable-pip-version-check -r lake-archiver/requirements.txt -r telemetry/requirements.txt || exit 2
    rc=0
    (cd /svc/lake-archiver && python -B -m unittest discover -s tests -v 2>&1) || rc=1
    (cd /svc/telemetry && python -B -m unittest discover -s tests -v 2>&1) || rc=1
    exit $rc
' || status=1

exit "$status"
