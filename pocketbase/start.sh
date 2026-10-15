#!/bin/sh
set -eu
exec /pb/pocketbase serve --http="0.0.0.0:${PORT:-8090}" --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks
