import { PrismaClient } from "@prisma/client";
import seedBaseBdLocations from "./seeders/seedBaseBdLocations";
import { runDhakaCitySeed } from "./seeders";
import seedFundraisingPayoutCatalog from "./seeders/seedFundraisingPayoutCatalog";
import seedBranchTypes from "./seeders/seedBranchTypes";
import seedOrganizationTypes from "./seeders/seedOrganizationTypes";
import seedSuperAdminWhitelist from "./seeders/seedSuperAdminWhitelist";
import seedRolesPermissions from "./seeders/seedRolesPermissions";
import seedMembershipBackfill from "./seeders/seedMembershipBackfill";
import seedProductsMasterData from "./seeders/seedProductsMasterData";
import seedPetBrands from "./seeders/seedPetBrands";
import seedPetCategories from "./seeders/seedPetCategories";
import seedProductSubcategories from "./seeders/seedProductSubcategories";
import seedMasterProductCatalog from "./seeders/seedMasterProductCatalog";
import seedDemoMasterProductCatalog from "./seeders/seedDemoMasterProductCatalog";
import seedCountries from "./seeders/seedCountries";
import { runGlobalLocationSeed } from "./seeders/location";
import seedCountryPolicies from "./seeders/seedCountryPolicies";
import seedGlobalCountryRoles from "./seeders/seedGlobalCountryRoles";
import seedOrganizationCountries from "./seeders/seedOrganizationCountries";

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

  // 6) System roles + permissions (RBAC foundation)
  await seedRolesPermissions(prisma);

  // 7) Super Admin whitelist (Admin web access gate)
  await seedSuperAdminWhitelist(prisma);

  // 8) Backfill org/branch memberships for existing org owners
  await seedMembershipBackfill(prisma);

  // 9) Products master data (categories, units, flavors)
  await seedProductsMasterData(prisma);

  // 10) Pet-related categories and subcategories
  await seedPetCategories(prisma);

  // 11) Additional product subcategories (ensures all categories have comprehensive subcategories)
  await seedProductSubcategories(prisma);

  // 12) Pet-related brands (companies)
  await seedPetBrands(prisma);

  // 13) Master Product Catalog (global product catalog for shop owners)
  await seedMasterProductCatalog(prisma);

  // 13.1) Demo Master Product Catalog (~200 demo products)
  await seedDemoMasterProductCatalog(prisma);

  // 14) Global-Ready Phase 1: Countries (BD, IN, US) + BD ACTIVE policy
  await seedCountries(prisma);
  // 14.0) Global location system: BD, IN, LK, MY, SG (countries, states, cities, sub-districts)
  await runGlobalLocationSeed(prisma);
  await seedCountryPolicies(prisma);

  // 14.1) Phase 1: Backfill org country to BD
  await seedOrganizationCountries(prisma);

  // 15) Phase 4: Global + Country roles and permissions
  await seedGlobalCountryRoles(prisma);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
