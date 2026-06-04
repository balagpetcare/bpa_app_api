import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { runDhakaCitySeed } from "../prisma/seeders/dhaka/runDhakaCitySeed";
import seedCoverageZones from "../prisma/seeders/coverage/seedCoverageZones";

async function main() {
  console.log("📍 Seeding Dhaka metro (BdArea + CoverageZone)...");
  await runDhakaCitySeed(prisma as any);
  await seedCoverageZones(prisma as any);
  const zones = await prisma.coverageZone.count({ where: { zoneType: "METRO" } });
  const mappings = await prisma.coverageZoneArea.count();
  console.log("✅ Dhaka metro seeded", { metroCoverageZones: zones, areaMappings: mappings });
}

main()
  .catch((e) => {
    console.error("❌ seed-dhaka-metro failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
