#!/bin/sh
set -e

echo "=== CPCM Analytics Dashboard ==="
echo "DATABASE_URL: $DATABASE_URL"

# Run Prisma DB push to create/update tables
echo "Running Prisma DB push..."
node ./node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss
echo "Prisma DB push completed."

# Seed initial admin user if DB is fresh
echo "Seeding database..."
node prisma/seed.js
echo "Seed script completed."

echo "Starting server..."
exec "$@"
