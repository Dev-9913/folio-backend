#!/bin/sh
set -e

echo "▶ Running Prisma migrations…"
npx prisma migrate deploy

echo "▶ Starting Folio backend…"
exec node src/server.js
