#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors
#
# OpenAgriOS PostgreSQL Initialization Entrypoint
# Dynamically synchronizes application role credentials from environment variables.
set -e

APP_USER="${POSTGRES_APP_USER:-openagrios_app}"
APP_PASS="${POSTGRES_APP_PASSWORD:-openagrios_app_dev_only}"

echo ">>> [OpenAgriOS DB Init] Configuring application role '$APP_USER'..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$APP_USER') THEN
            CREATE ROLE "$APP_USER" WITH LOGIN PASSWORD '$APP_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        ELSE
            ALTER ROLE "$APP_USER" WITH PASSWORD '$APP_PASS';
        END IF;
    END \$\$;

    GRANT ALL ON SCHEMA public TO "$APP_USER";
    GRANT ALL ON ALL TABLES IN SCHEMA public TO "$APP_USER";
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "$APP_USER";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "$APP_USER";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "$APP_USER";
EOSQL

echo ">>> [OpenAgriOS DB Init] Application role '$APP_USER' successfully synchronized with environment password."
