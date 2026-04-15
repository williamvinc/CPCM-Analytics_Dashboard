#!/bin/sh
set -e

echo "=== CPCM Analytics Dashboard ==="

# Run Prisma DB push to create/update tables
echo "Running Prisma DB push..."
node ./node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>&1 || echo "Warning: Prisma push had issues"

# Seed initial admin user if DB is fresh
echo "Seeding database..."
node prisma/seed.js 2>&1 || echo "Seed completed (or user already exists)"

echo "Starting server..."
exec "$@"
