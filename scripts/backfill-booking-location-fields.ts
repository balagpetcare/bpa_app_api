/**
 * Backfill missing bookingArea / address JSON location fields on historical ZONE_INTEREST rows.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/backfill-booking-location-fields.ts
 *   npx ts-node --transpile-only scripts/backfill-booking-location-fields.ts --dry-run
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { resolveCityCorporationName } from "../src/api/v1/modules/campaign/bookingLocationDisplay.util";

const DRY_RUN = process.argv.includes("--dry-run");

type AddressJson = Record<string, unknown>;

function asAddress(value: unknown): AddressJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AddressJson;
}

async function resolveAreaName(bdAreaId: number | null | undefined): Promise<string | null> {
  if (!bdAreaId || bdAreaId <= 0) return null;
  const area = await prisma.bdArea.findUnique({
    where: { id: bdAreaId },
    select: { nameEn: true, nameBn: true, type: true, parentId: true },
  });
  if (!area) return null;
  if (area.type === "ZONE") return area.nameEn || area.nameBn || null;

  if (area.parentId) {
    const parent = await prisma.bdArea.findUnique({
      where: { id: area.parentId },
      select: { nameEn: true, nameBn: true, type: true },
    });
    if (parent?.type === "ZONE") return parent.nameEn || parent.nameBn || null;
  }

  return area.nameEn || area.nameBn || null;
}

async function main() {
  const candidates = await prisma.campaignBooking.findMany({
    where: {
      OR: [
        { bookingMode: "ZONE_INTEREST" },
        { locationId: null, bookingArea: { not: null } },
        { locationId: null, coverageZoneName: { not: null } },
      ],
    },
    select: {
      id: true,
      bookingRef: true,
      bookingArea: true,
      bdAreaId: true,
      coverageZoneName: true,
      ownerAddressJson: true,
    },
    orderBy: { id: "asc" },
  });

  let updated = 0;
  let skipped = 0;

  for (const row of candidates) {
    const addr = asAddress(row.ownerAddressJson);
    const code =
      typeof addr.cityCorporationCode === "string"
        ? addr.cityCorporationCode.trim().toUpperCase()
        : "";
    const addrArea =
      typeof addr.bookingArea === "string" && addr.bookingArea.trim()
        ? addr.bookingArea.trim()
        : null;

    let bookingArea = row.bookingArea?.trim() || addrArea || null;
    if (!bookingArea) {
      bookingArea = (await resolveAreaName(row.bdAreaId)) || row.coverageZoneName?.trim() || null;
    }

    const corpName =
      (typeof addr.cityCorporationName === "string" && addr.cityCorporationName.trim()) ||
      resolveCityCorporationName(code) ||
      null;

    const nextAddress: AddressJson = { ...addr };
    let addressChanged = false;
    if (code && !nextAddress.cityCorporationName && corpName) {
      nextAddress.cityCorporationName = corpName;
      addressChanged = true;
    }
    if (bookingArea && !nextAddress.bookingArea) {
      nextAddress.bookingArea = bookingArea;
      addressChanged = true;
    }

    const bookingAreaChanged = bookingArea && bookingArea !== (row.bookingArea?.trim() || null);
    if (!bookingAreaChanged && !addressChanged) {
      skipped++;
      continue;
    }

    console.log({
      action: DRY_RUN ? "would_update" : "update",
      bookingRef: row.bookingRef,
      bookingArea: { from: row.bookingArea, to: bookingArea },
      cityCorporationCode: code || null,
      cityCorporationName: corpName,
    });

    if (!DRY_RUN) {
      await prisma.campaignBooking.update({
        where: { id: row.id },
        data: {
          ...(bookingAreaChanged ? { bookingArea } : {}),
          ...(addressChanged ? { ownerAddressJson: nextAddress } : {}),
        },
      });
    }
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        scanned: candidates.length,
        updated,
        skipped,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
