/*
  Optional seed runner.
  If you already have prisma/seed.js, merge the seedLocationsDhaka(prisma) call into your existing runner.
*/

const { PrismaClient } = require('@prisma/client');
const { seedLocationsDhaka } = require('./seeders/seedLocationsDhaka');

const prisma = new PrismaClient();

async function main() {
  await seedLocationsDhaka(prisma);
  console.log('✅ Seed complete (DNCC/DSCC + Areas)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
