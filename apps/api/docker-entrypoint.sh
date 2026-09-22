#!/bin/sh
# Applies migrations and loads the card set before the server accepts traffic.
# Both steps are idempotent, so a restart is always safe.
set -e

echo "[entrypoint] applying migrations"
npx prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] seeding reference data (idempotent)"
node dist/seed/index.js

echo "[entrypoint] starting api"
exec "$@"
