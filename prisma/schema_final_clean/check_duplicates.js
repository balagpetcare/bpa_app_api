const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const dupUpazilaCodes = await prisma.bdUpazila.groupBy({
    by: ["code"],
    _count: { code: true },
    having: {
      code: { _count: { gt: 1 } }
    }
  });

  console.log("Duplicate Upazila codes:", dupUpazilaCodes);

  const dupAreaCodes = await prisma.bdArea.groupBy({
    by: ["code"],
    _count: { code: true },
    having: {
      code: { _count: { gt: 1 } }
    }
  });

  console.log("Duplicate Area codes:", dupAreaCodes);

  await prisma.$disconnect();
}

run().catch(console.error);
