#!/bin/sh
set -e

echo "=== MooBoard Dashboard ==="
echo "DATABASE_URL: $DATABASE_URL"

# Create tables using Prisma Client raw SQL (no CLI needed)
echo "Initializing database..."
node prisma/init-db.js

# Seed initial admin user if DB is fresh
echo "Seeding database..."
node prisma/seed.js

echo "Starting server..."
exec "$@"
