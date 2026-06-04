import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { runDhakaCitySeed } from "../prisma/seeders/dhaka/runDhakaCitySeed";

async function main() {
  console.log("📍 Seeding Dhaka city BdArea hierarchy (DNCC + DSCC)...");
  await runDhakaCitySeed(prisma as any);
  const dncc = await prisma.bdArea.count({ where: { code: { startsWith: "AREA-DNCC-" } } });
  const dscc = await prisma.bdArea.count({ where: { code: { startsWith: "AREA-DSCC-" } } });
  console.log("✅ Dhaka city seeded", { dnccAreas: dncc, dsccAreas: dscc });
}

main()
  .catch((e) => {
    console.error("❌ seed-dhaka-city failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
