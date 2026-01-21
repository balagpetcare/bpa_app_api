import { PrismaClient } from "@prisma/client";
import seedBaseBdLocations from "./seeders/seedBaseBdLocations";
import { runDhakaCitySeed } from "./seeders";
import seedFundraisingPayoutCatalog from "./seeders/seedFundraisingPayoutCatalog";
import seedBranchTypes from "./seeders/seedBranchTypes";
import seedOrganizationTypes from "./seeders/seedOrganizationTypes";
import seedSuperAdminWhitelist from "./seeders/seedSuperAdminWhitelist";
import seedMembershipBackfill from "./seeders/seedMembershipBackfill";

const prisma = new PrismaClient();

async function main() {
  // 1) Base Bangladesh: divisions, districts, upazilas, legacy areas
  await seedBaseBdLocations(prisma);

  // 2) Dhaka City (DNCC + DSCC) courier-style hierarchy:
  //    City Corporation -> Zone (recognizable locality buckets) -> Area (neighbourhoods)
  await runDhakaCitySeed(prisma);

  // 3) Default payout methods (bKash/Nagad/Rocket/Bank)
  await seedFundraisingPayoutCatalog(prisma);
  // 4) Branch types master (clinic/shop/hub/warehouse/etc)
  await seedBranchTypes(prisma);

  // 5) Organization types master (used by dropdowns)
  await seedOrganizationTypes(prisma);

  // 6) Super Admin whitelist (Admin web access gate)
  await seedSuperAdminWhitelist(prisma);

  // 7) Backfill org/branch memberships for existing org owners
  await seedMembershipBackfill(prisma);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
