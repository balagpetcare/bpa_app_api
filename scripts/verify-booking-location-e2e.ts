/**
 * End-to-end booking location verification:
 * initCheckout (DSCC + zone) → DB row → admin list mapper → label output.
 *
 * Usage: npx ts-node --transpile-only scripts/verify-booking-location-e2e.ts
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import {
  initCheckout,
  confirmFreeCheckout,
} from "../src/api/v1/modules/campaign/checkout.service";
import {
  mapBookingRecordToListRow,
} from "../src/api/v1/modules/campaign/booking.service";
import {
  resolveBookingLocationDisplay,
  formatBookingLocationLabel,
  formatBookingLocationShortLabel,
} from "../src/api/v1/modules/campaign/bookingLocationDisplay.util";

async function findDsccRampuraZone() {
  const corp = await prisma.bdArea.findFirst({
    where: { code: "CC-DSCC", type: "CITY_CORPORATION" },
    select: { id: true },
  });
  if (!corp) return null;
  return prisma.bdArea.findFirst({
    where: {
      parentId: corp.id,
      type: "ZONE",
      OR: [
        { nameEn: { contains: "Rampura", mode: "insensitive" } },
        { nameEn: { contains: "Banasree", mode: "insensitive" } },
      ],
    },
    select: { id: true, nameEn: true, code: true },
  });
}

async function auditExistingRows(limit = 5) {
  const rows = await prisma.campaignBooking.findMany({
    where: { bookingMode: "ZONE_INTEREST" },
    take: limit,
    orderBy: { id: "desc" },
    include: { location: { select: { id: true, name: true } } },
  });

  return rows.map((row) => {
    const listRow = mapBookingRecordToListRow(row);
    const display = resolveBookingLocationDisplay(row);
    return {
      bookingRef: row.bookingRef,
      db: {
        locationId: row.locationId,
        bdAreaId: row.bdAreaId,
        bookingArea: row.bookingArea,
        coverageZoneName: row.coverageZoneName,
        cityCorporationCode: (row.ownerAddressJson as Record<string, unknown>)
          ?.cityCorporationCode,
      },
      oldAdminDisplay: row.location?.name ?? "—",
      apiListRow: {
        cityCorporation: (listRow as { cityCorporation?: string }).cityCorporation,
        area: (listRow as { area?: string }).area,
        locationLabel: (listRow as { locationLabel?: string }).locationLabel,
        location: listRow.location,
      },
      display,
      shortLabel: formatBookingLocationShortLabel(display),
      longLabel: formatBookingLocationLabel(display),
    };
  });
}

async function main() {
  console.log("=== Phase 2: Existing ZONE_INTEREST rows ===");
  const existing = await auditExistingRows();
  if (existing.length) {
    console.log(JSON.stringify(existing, null, 2));
  } else {
    console.log("No existing ZONE_INTEREST bookings.");
  }

  const sampleBooking = await prisma.campaignBooking.findFirst({
    where: { bookingMode: "ZONE_INTEREST" },
    orderBy: { id: "desc" },
    select: { campaignId: true },
  });

  const campaign = sampleBooking
    ? await prisma.campaign.findUnique({
        where: { id: sampleBooking.campaignId },
        select: { id: true, slug: true, pricingType: true, status: true },
      })
    : await prisma.campaign.findFirst({
        orderBy: { id: "desc" },
        select: { id: true, slug: true, pricingType: true, status: true },
      });
  if (!campaign?.slug) {
    console.log(JSON.stringify({ ok: false, error: "No campaign" }));
    process.exit(1);
  }

  const zone = await findDsccRampuraZone();
  if (!zone) {
    console.log(JSON.stringify({ ok: false, error: "DSCC Rampura/Banasree zone not seeded" }));
    process.exit(1);
  }

  const phone = `018${String(Date.now()).slice(-8)}`;
  console.log("\n=== Phase 1/6: Fresh booking (DSCC +", zone.nameEn, ") ===");
  console.log("Frontend payload:", {
    campaignSlug: campaign.slug,
    cityCorporationCode: "DSCC",
    bdAreaId: zone.id,
    bookingArea: zone.nameEn,
    catCount: 1,
    phone,
  });

  let init;
  try {
    init = await initCheckout({
      campaignSlug: campaign.slug,
      phone,
      cityCorporationCode: "DSCC",
      bdAreaId: zone.id,
      bookingArea: zone.nameEn,
      catCount: 1,
      paymentMethod: "BKASH",
    });
  } catch (err) {
    console.log(JSON.stringify({ ok: false, step: "initCheckout", error: String(err) }));
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("initCheckout result:", {
    checkoutId: init.checkoutId,
    requiresPayment: init.requiresPayment,
  });

  let bookingRef: string | undefined;
  if (!init.requiresPayment) {
    const confirmed = await confirmFreeCheckout(init.checkoutId);
    bookingRef = confirmed.bookingRef;
  } else {
    const pending = await prisma.campaignBooking.findFirst({
      where: { checkoutSessionId: init.checkoutId },
      select: { bookingRef: true },
    });
    bookingRef = pending?.bookingRef;
  }

  if (!bookingRef) {
    console.log(JSON.stringify({ ok: false, error: "No booking ref after init" }));
    await prisma.$disconnect();
    process.exit(1);
  }

  const dbRow = await prisma.campaignBooking.findUnique({
    where: { bookingRef },
    include: { location: { select: { id: true, name: true } }, slot: true, pets: true },
  });

  console.log("\n=== Database row ===");
  console.log(
    JSON.stringify(
      {
        bookingRef: dbRow?.bookingRef,
        bookingMode: dbRow?.bookingMode,
        locationId: dbRow?.locationId,
        bdAreaId: dbRow?.bdAreaId,
        bookingArea: dbRow?.bookingArea,
        coverageZoneName: dbRow?.coverageZoneName,
        ownerAddressJson: dbRow?.ownerAddressJson,
      },
      null,
      2
    )
  );

  const listRow = mapBookingRecordToListRow(dbRow!);
  console.log("\n=== Admin list API row (mapped) ===");
  console.log(JSON.stringify(listRow, null, 2));

  const hasLocation =
    Boolean((listRow as { locationLabel?: string }).locationLabel) ||
    Boolean(listRow.location?.area) ||
    Boolean(listRow.bookingArea);

  console.log("\n=== Result ===");
  console.log(
    JSON.stringify(
      {
        ok: hasLocation,
        bookingRef,
        locationLabel: (listRow as { locationLabel?: string }).locationLabel,
        cityCorporation: (listRow as { cityCorporation?: string }).cityCorporation,
        area: (listRow as { area?: string }).area,
        adminWouldShow: (listRow as { locationLabel?: string }).locationLabel || "—",
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
  process.exit(hasLocation ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
