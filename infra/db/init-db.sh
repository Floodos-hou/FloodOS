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
    -- psql does not substitute :variables inside dollar-quoted blocks, so build statements
    -- with format(%I/%L) outside DO and run them with \gexec (injection-safe quoting).
    SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_user', :'app_pass')
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
    SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'app_user', :'app_pass')
    WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec

    -- Least-Privilege & RLS Preservation (TRUNCATE is strictly prohibited to enforce Row-Level Security)
    SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
    SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user') \gexec
    SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user') \gexec
    SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'app_user') \gexec
    SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'app_user') \gexec
EOSQL

echo ">>> [OpenAgriOS DB Init] Application role '$APP_USER' successfully synchronized with environment password."
