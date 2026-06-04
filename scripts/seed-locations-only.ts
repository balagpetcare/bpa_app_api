/**
 * Location-only seed: BD hierarchy + global location tables.
 * Uses existing seed sources in prisma/seed-data and prisma/seeders/location.
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import seedBaseBdLocations from "../prisma/seeders/seedBaseBdLocations";
import { runGlobalLocationSeed } from "../prisma/seeders/location";
import { runDhakaCitySeed } from "../prisma/seeders";

async function main() {
  console.log("📍 Seeding BD base locations (divisions → districts → upazilas → areas)...");
  await seedBaseBdLocations(prisma);

  console.log("📍 Seeding Dhaka city corporations / areas...");
  await runDhakaCitySeed(prisma);

  console.log("📍 Seeding global location tables (countries, states, cities, sub-districts)...");
  await runGlobalLocationSeed(prisma);

  console.log("✅ Location seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Location seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
