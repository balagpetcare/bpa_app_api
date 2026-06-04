import "dotenv/config";
import fs from "fs";
import path from "path";
import prisma from "../src/infrastructure/db/prismaClient";

function toNum(v: unknown) {
  return Number(v || 0);
}

async function main() {
  const [zones, mappings, duplicateZones, duplicateMappings, orphanMappings, missingMetroAreas] =
    await Promise.all([
      prisma.coverageZone.count(),
      prisma.coverageZoneArea.count(),
      prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) - COUNT(DISTINCT slug) AS c FROM coverage_zones
      `,
      prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) - COUNT(DISTINCT ("coverageZoneId", "bdAreaId")) AS c
        FROM coverage_zone_areas WHERE "bdAreaId" IS NOT NULL
      `,
      prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) AS c
        FROM coverage_zone_areas cza
        LEFT JOIN bd_areas a ON a.id = cza."bdAreaId"
        WHERE cza."bdAreaId" IS NOT NULL AND a.id IS NULL
      `,
      prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) AS c FROM coverage_zones z
        WHERE z.slug LIKE 'dhaka-metro%'
          AND z.slug != 'dhaka-metro'
          AND NOT EXISTS (
            SELECT 1 FROM coverage_zone_areas cza WHERE cza."coverageZoneId" = z.id
          )
      `,
    ]);

  const metroZones = await prisma.coverageZone.findMany({
    where: { slug: { startsWith: "dhaka-metro" } },
    include: { _count: { select: { areas: true } } },
    orderBy: { sortOrder: "asc" },
  });

  const dhakaMapped = await prisma.coverageZoneArea.count({
    where: {
      bdArea: {
        OR: [
          { code: { startsWith: "AREA-DNCC-" } },
          { code: { startsWith: "AREA-DSCC-" } },
        ],
      },
    },
  });

  const report = {
    generatedAt: new Date().toISOString(),
    counts: { zones, mappings, dhakaNeighbourhoodMappings: dhakaMapped },
    integrity: {
      duplicateZoneSlugs: toNum(duplicateZones[0]?.c),
      duplicateZoneAreaPairs: toNum(duplicateMappings[0]?.c),
      orphanBdAreaReferences: toNum(orphanMappings[0]?.c),
      metroZonesWithoutMappings: toNum(missingMetroAreas[0]?.c),
    },
    metroZones: metroZones.map((z) => ({
      slug: z.slug,
      name: z.name,
      areaMappings: z._count.areas,
    })),
    passed:
      toNum(duplicateZones[0]?.c) === 0 &&
      toNum(duplicateMappings[0]?.c) === 0 &&
      toNum(orphanMappings[0]?.c) === 0 &&
      toNum(missingMetroAreas[0]?.c) === 0,
  };

  const outDir = path.join(process.cwd(), "docs", "coverage-zones");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "verification-report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log(report.passed ? "✅ Coverage zone verification passed." : "⚠️ Coverage zone verification has warnings.");
  console.log(report);
  console.log(`Report saved: ${outFile}`);

  if (!report.passed) process.exit(1);
}

main()
  .catch((e) => {
    console.error("❌ verify-coverage-zones failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
