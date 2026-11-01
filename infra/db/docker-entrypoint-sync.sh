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

    # 1. Synchronize application role credentials dynamically
    if [ -f /docker-entrypoint-initdb.d/01-init-db.sh ]; then
        if output=$(/bin/sh /docker-entrypoint-initdb.d/01-init-db.sh 2>&1); then
            echo ">>> [OpenAgriOS DB] Application role credentials automatically synchronized with current environment."
        else
            echo "!!! [OpenAgriOS DB ERROR] Failed to synchronize application role credentials:" >&2
            echo "$output" >&2
        fi
    fi

    # 2. Synchronize database schema and RLS policies idempotently
    if [ -f /docker-entrypoint-initdb.d/02-schema.sql ]; then
        if output=$(psql -v ON_ERROR_STOP=1 -h localhost -U "$user" -d "$db" -f /docker-entrypoint-initdb.d/02-schema.sql 2>&1); then
            echo ">>> [OpenAgriOS DB] Database schema and RLS policies successfully synchronized."
        else
            echo "!!! [OpenAgriOS DB ERROR] Failed to synchronize database schema and policies:" >&2
            echo "$output" >&2
        fi
    fi
}

sync_on_startup &

# If no arguments provided to entrypoint, default to running the postgres server
if [ $# -eq 0 ]; then
    set -- postgres
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
