/**
 * Validate booking list filters against DB.
 * Usage: npx ts-node --transpile-only scripts/verify-booking-filters.ts
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { queryCampaignBookings } from "../src/api/v1/modules/campaign/bookingListFilters.service";
import { buildBookingsExport } from "../src/api/v1/modules/campaign/export.service";

async function main() {
  const booking = await prisma.campaignBooking.findFirst({
    where: { bookingMode: "ZONE_INTEREST", bookingArea: { not: null } },
    orderBy: { id: "desc" },
  });
  if (!booking) {
    console.log(JSON.stringify({ ok: false, error: "No zone booking to test" }));
    process.exit(1);
  }

  const addr = booking.ownerAddressJson as Record<string, unknown> | null;
  const corp =
    typeof addr?.cityCorporationCode === "string" ? addr.cityCorporationCode : "DSCC";

  const filtered = await queryCampaignBookings({
    campaignId: booking.campaignId,
    cityCorporation: corp,
    area: booking.bookingArea ?? undefined,
    page: 1,
    pageSize: 20,
  });

  const exportResult = await buildBookingsExport(booking.campaignId, "csv", {
    campaignId: booking.campaignId,
    cityCorporation: corp,
    area: booking.bookingArea ?? undefined,
  });

  console.log(
    JSON.stringify(
      {
        ok: filtered.total > 0 && exportResult.rowCount > 0,
        sampleRef: booking.bookingRef,
        filters: { cityCorporation: corp, area: booking.bookingArea },
        filteredBookings: filtered.total,
        filteredPets: filtered.summary?.filteredPets,
        exportRows: exportResult.rowCount,
        summary: filtered.summary,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
  process.exit(filtered.total > 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
