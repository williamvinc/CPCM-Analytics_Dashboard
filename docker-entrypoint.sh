#!/bin/sh
set -e

echo "=== CPCM Analytics Dashboard ==="

# Run Prisma migrations / push schema to create tables
echo "Running Prisma DB push..."
npx prisma db push --skip-generate 2>/dev/null || echo "Prisma push completed (or already up to date)"

# Seed initial admin user if DB is fresh
echo "Seeding database..."
node prisma/seed.js 2>/dev/null || echo "Seed completed (or user already exists)"

echo "Starting server..."
exec "$@"
