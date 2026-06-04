import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";

const TABLES = [
  "bd_divisions",
  "bd_districts",
  "bd_upazilas",
  "bd_unions",
  "bd_areas",
  "location_coverage_assignments",
  "city_corporations",
  "areas",
  "countries",
  "states",
  "location_cities",
  "location_sub_districts",
] as const;

async function main() {
  for (const tbl of TABLES) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ c: number }[]>(
        `SELECT COUNT(*)::int AS c FROM "${tbl}"`
      );
      console.log(`${tbl}\t${rows[0]?.c ?? 0}`);
    } catch (e: any) {
      console.log(`${tbl}\tMISSING`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
