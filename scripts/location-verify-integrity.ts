import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";

async function main() {
  const prismaAny: any = prisma;
  const [divCount, disCount, upzCount, unionCount, areaCount] = await Promise.all([
    prisma.bdDivision.count(),
    prisma.bdDistrict.count(),
    prisma.bdUpazila.count(),
    prismaAny.bdUnion && typeof prismaAny.bdUnion.count === "function" ? prismaAny.bdUnion.count() : Promise.resolve(0),
    prisma.bdArea.count(),
  ]);

  const expected = { divisions: 8, districts: 64, upazilas: 495, unions: 4540, areas: 4540 };
  console.log("Expected vs actual:", {
    divisions: { expected: expected.divisions, actual: divCount, ok: divCount === expected.divisions },
    districts: { expected: expected.districts, actual: disCount, ok: disCount === expected.districts },
    upazilas: { expected: expected.upazilas, actual: upzCount, ok: upzCount === expected.upazilas },
    unions: { expected: expected.unions, actual: unionCount, ok: unionCount === expected.unions || unionCount === 0 },
    areas: { expected: expected.areas, actual: areaCount, ok: areaCount === expected.areas },
  });

  const orphanDistricts = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM bd_districts d
    LEFT JOIN bd_divisions v ON v.id = d."divisionId"
    WHERE v.id IS NULL
  `;
  const orphanUpazilas = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM bd_upazilas u
    LEFT JOIN bd_districts d ON d.id = u."districtId"
    WHERE d.id IS NULL
  `;
  const orphanAreas = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM bd_areas a
    WHERE a."upazilaId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM bd_upazilas u WHERE u.id = a."upazilaId")
  `;
  const orphanUnions = prismaAny.bdUnion && typeof prismaAny.bdUnion.count === "function"
    ? await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) AS c FROM bd_unions u
        LEFT JOIN bd_upazilas z ON z.id = u."upazilaId"
        WHERE z.id IS NULL
      `
    : [{ c: BigInt(0) }];
  const dupCodes = await prisma.$queryRaw<{ table_name: string; dup_count: bigint }[]>`
    SELECT 'bd_divisions' AS table_name, COUNT(*) - COUNT(DISTINCT code) AS dup_count FROM bd_divisions
    UNION ALL SELECT 'bd_districts', COUNT(*) - COUNT(DISTINCT code) FROM bd_districts
    UNION ALL SELECT 'bd_upazilas', COUNT(*) - COUNT(DISTINCT code) FROM bd_upazilas
    UNION ALL SELECT 'bd_areas', COUNT(*) - COUNT(DISTINCT code) FROM bd_areas
  `;

  console.log("FK orphans:", {
    districtsWithoutDivision: Number(orphanDistricts[0]?.c ?? 0),
    upazilasWithoutDistrict: Number(orphanUpazilas[0]?.c ?? 0),
    unionsWithoutUpazila: Number(orphanUnions[0]?.c ?? 0),
    areasWithBadUpazila: Number(orphanAreas[0]?.c ?? 0),
  });
  console.log("Duplicate codes:", dupCodes.map((r) => ({ table: r.table_name, dups: Number(r.dup_count) })));

  const dhakaDiv = await prisma.bdDivision.findFirst({ where: { code: "DIV-6" } });
  if (dhakaDiv) {
    const dhakaDistricts = await prisma.bdDistrict.count({ where: { divisionId: dhakaDiv.id } });
    const sampleDistrict = await prisma.bdDistrict.findFirst({ where: { divisionId: dhakaDiv.id } });
    const upzCountDhaka = sampleDistrict
      ? await prisma.bdUpazila.count({ where: { districtId: sampleDistrict.id } })
      : 0;
    console.log("Cascade sample (Dhaka division):", {
      divisionId: dhakaDiv.id,
      districtsInDivision: dhakaDistricts,
      sampleDistrict: sampleDistrict?.nameEn,
      upazilasInSampleDistrict: upzCountDhaka,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
