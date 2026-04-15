// Seed script for creating initial admin user
// Runs on first container start via docker-entrypoint.sh
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_USER_EMAIL || 'admin@cpcm.com';
  const password = process.env.SEED_USER_PASSWORD || 'admin123';
  const name = process.env.SEED_USER_NAME || 'Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('User ' + email + ' already exists, skipping seed.');
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, password: hashedPassword, name },
  });
  console.log('Created admin user: ' + email);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
