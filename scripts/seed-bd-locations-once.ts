import "dotenv/config";
import seedBaseBdLocations from "../prisma/seeders/seedBaseBdLocations";

async function main() {
  const { prisma } = require("../src/config/prisma") as { prisma: import("@prisma/client").PrismaClient };
  try {
    await seedBaseBdLocations(prisma);
    const count = await prisma.bdDivision.count();
    console.log(`BD locations seeded (${count} divisions)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
