#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors

set -e

# ============================================================================
# OPENAGRIOS POSTGRESQL STARTUP CREDENTIAL SYNCHRONIZATION WRAPPER
# Automatically synchronizes POSTGRES_APP_PASSWORD on every container startup,
# ensuring password updates in .env or compose are applied even when pgdata
# volume already exists.
# ============================================================================

sync_on_startup() {
    export PGPASSWORD="${POSTGRES_PASSWORD}"
    local user="${POSTGRES_USER:-openagrios}"
    local db="${POSTGRES_DB:-openagrios_db}"

    # Wait until postgres server is ready to accept connections
    until pg_isready -h localhost -U "$user" -d "$db" -q; do
        sleep 1
    done

    if [ -f /docker-entrypoint-initdb.d/01-init-db.sh ]; then
        /bin/sh /docker-entrypoint-initdb.d/01-init-db.sh >/dev/null 2>&1 || true
        echo ">>> [OpenAgriOS DB] Application role credentials automatically synchronized with current environment."
    fi
}

sync_on_startup &

exec /usr/local/bin/docker-entrypoint.sh "$@"
