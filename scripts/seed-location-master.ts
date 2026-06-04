import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import seedBaseBdLocations from "../prisma/seeders/seedBaseBdLocations";

async function main() {
  console.log("📍 Seeding centralized Bangladesh location master...");
  await seedBaseBdLocations(prisma as any);

  const prismaAny: any = prisma;
  const [divisions, districts, upazilas, unions, areas] = await Promise.all([
    prisma.bdDivision.count(),
    prisma.bdDistrict.count(),
    prisma.bdUpazila.count(),
    prismaAny.bdUnion && typeof prismaAny.bdUnion.count === "function" ? prismaAny.bdUnion.count() : Promise.resolve(0),
    prisma.bdArea.count(),
  ]);

  console.log("✅ Bangladesh location master seeded", {
    divisions,
    districts,
    upazilas,
    unions,
    areas,
  });
}

main()
  .catch((e) => {
    console.error("❌ seed-location-master failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
