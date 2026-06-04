import "dotenv/config";
import fs from "fs";
import path from "path";
import prisma from "../src/infrastructure/db/prismaClient";

function toNum(v: any) {
  return Number(v || 0);
}

async function main() {
  const prismaAny: any = prisma;
  const [divisions, districts, upazilas, unions, areas] = await Promise.all([
    prisma.bdDivision.count(),
    prisma.bdDistrict.count(),
    prisma.bdUpazila.count(),
    prismaAny.bdUnion && typeof prismaAny.bdUnion.count === "function" ? prismaAny.bdUnion.count() : Promise.resolve(0),
    prisma.bdArea.count(),
  ]);

  const orphanDistricts = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c
    FROM bd_districts d
    LEFT JOIN bd_divisions v ON v.id = d."divisionId"
    WHERE v.id IS NULL
  `;
  const orphanUpazilas = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c
    FROM bd_upazilas u
    LEFT JOIN bd_districts d ON d.id = u."districtId"
    WHERE d.id IS NULL
  `;

  let orphanUnions = 0;
  let orphanAreasByUnion = 0;
  if (prismaAny.bdUnion && typeof prismaAny.bdUnion.count === "function") {
    const rowsUnions = await prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c
      FROM bd_unions u
      LEFT JOIN bd_upazilas z ON z.id = u."upazilaId"
      WHERE z.id IS NULL
    `;
    orphanUnions = toNum(rowsUnions[0]?.c);

    const rowsAreas = await prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c
      FROM bd_areas a
      WHERE a."unionId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM bd_unions u WHERE u.id = a."unionId")
    `;
    orphanAreasByUnion = toNum(rowsAreas[0]?.c);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    counts: { divisions, districts, upazilas, unions, areas },
    integrity: {
      orphanDistricts: toNum(orphanDistricts[0]?.c),
      orphanUpazilas: toNum(orphanUpazilas[0]?.c),
      orphanUnions,
      orphanAreasByUnion,
    },
  };

  const outDir = path.join(process.cwd(), "docs", "location-system-migration");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "verification-report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log("✅ Location master verification complete.");
  console.log(report);
  console.log(`Report saved: ${outFile}`);
}

main()
  .catch((e) => {
    console.error("❌ verify-location-master failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
