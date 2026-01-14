import { PrismaClient } from "@prisma/client";
import seedBaseBdLocations from "./seeders/seedBaseBdLocations";
import { runDhakaCitySeed } from "./seeders";
import seedFundraisingPayoutCatalog from "./seeders/seedFundraisingPayoutCatalog";

const prisma = new PrismaClient();

async function main() {
  // 1) Base Bangladesh: divisions, districts, upazilas, legacy areas
  await seedBaseBdLocations(prisma);

  // 2) Dhaka City (DNCC + DSCC) courier-style hierarchy:
  //    City Corporation -> Zone (recognizable locality buckets) -> Area (neighbourhoods)
  await runDhakaCitySeed(prisma);

  // 3) Default payout methods (bKash/Nagad/Rocket/Bank)
  await seedFundraisingPayoutCatalog(prisma);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
