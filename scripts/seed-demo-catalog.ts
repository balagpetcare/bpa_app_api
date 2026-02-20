/**
 * Run only the demo master product catalog seeder (~200 products).
 * Usage: npx ts-node -r ts-node/register scripts/seed-demo-catalog.ts
 * Requires: DB running, and seedProductsMasterData + seedPetBrands + seedPetCategories already run.
 */
import { PrismaClient } from "@prisma/client";
import seedDemoMasterProductCatalog from "../prisma/seeders/seedDemoMasterProductCatalog";

const prisma = new PrismaClient();

async function main() {
  await seedDemoMasterProductCatalog(prisma);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
