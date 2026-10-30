#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
#
# OpenAgriOS PostgreSQL Initialization Entrypoint
# Dynamically synchronizes application role credentials from environment variables safely.
set -e

APP_USER="${POSTGRES_APP_USER:-openagrios_app}"
APP_PASS="${POSTGRES_APP_PASSWORD:-openagrios_app_dev_only}"

echo ">>> [OpenAgriOS DB Init] Configuring application role '$APP_USER'..."

psql -v ON_ERROR_STOP=1 \
     -v app_user="$APP_USER" \
     -v app_pass="$APP_PASS" \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') THEN
            EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_user', :'app_pass');
        ELSE
            EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', :'app_user', :'app_pass');
        END IF;
    END \$\$;

    -- Least-Privilege & RLS Preservation (TRUNCATE is strictly prohibited to enforce Row-Level Security)
    GRANT USAGE ON SCHEMA public TO "$APP_USER";
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "$APP_USER";
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "$APP_USER";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "$APP_USER";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "$APP_USER";
EOSQL

echo ">>> [OpenAgriOS DB Init] Application role '$APP_USER' successfully synchronized with environment password."
