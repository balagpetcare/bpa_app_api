import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { runCoverageZoneSeed } from "../prisma/seeders";
import { runDhakaCitySeed } from "../prisma/seeders/dhaka/runDhakaCitySeed";

async function main() {
  const ccDncc = await prisma.bdArea.findUnique({ where: { code: "CC-DNCC" } });
  if (!ccDncc) {
    console.log("📍 Dhaka BdArea hierarchy missing — running seed:dhaka-city first...");
    await runDhakaCitySeed(prisma as any);
  }

  console.log("📍 Seeding BPA coverage zones...");
  await runCoverageZoneSeed(prisma as any);
  const [zones, mappings, metadata] = await Promise.all([
    prisma.coverageZone.count(),
    prisma.coverageZoneArea.count(),
    prisma.coverageZoneMetadata.count(),
  ]);
  console.log("✅ Coverage zones seeded", { zones, mappings, metadata });
}

main()
  .catch((e) => {
    console.error("❌ seed-coverage-zones failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
