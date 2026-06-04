import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import seedClinicalVaccineItems from "../prisma/seeders/seedClinicalVaccineItems";

async function main() {
  const orgIdRaw = process.env.ORG_ID?.trim();
  const orgId = orgIdRaw ? Number(orgIdRaw) : NaN;

  if (!orgIdRaw || !Number.isFinite(orgId) || orgId <= 0) {
    throw new Error("ORG_ID is required. Example: ORG_ID=1 npm run seed:clinic-vaccine-items");
  }

  const results = await seedClinicalVaccineItems(prisma, { orgId });
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error("Seed clinic vaccine items failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
