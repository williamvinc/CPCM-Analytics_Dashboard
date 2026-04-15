// Initialize database tables using raw SQL via Prisma Client
// This replaces `prisma db push` so we don't need the Prisma CLI at runtime
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Ensuring database tables exist...');

  // Create User table if not exists (matches schema.prisma)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT,
      "email" TEXT,
      "password" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create unique index on email
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
  `);

  console.log('Database tables ready.');
}

main()
  .catch((e) => {
    console.error('DB init error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
