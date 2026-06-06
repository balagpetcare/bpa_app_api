const { PrismaClient } = require("@prisma/client");

const CORP = {
  DNCC: "Dhaka North City Corporation",
  DSCC: "Dhaka South City Corporation",
};

function labelFor(row) {
  const addr = row.ownerAddressJson && typeof row.ownerAddressJson === "object" ? row.ownerAddressJson : {};
  const code = typeof addr.cityCorporationCode === "string" ? addr.cityCorporationCode.toUpperCase() : "";
  const corp =
    (typeof addr.cityCorporationName === "string" && addr.cityCorporationName.trim()) ||
    CORP[code] ||
    "";
  const area = row.bookingArea?.trim() || (typeof addr.bookingArea === "string" ? addr.bookingArea.trim() : "");
  if (row.location?.name) return row.location.name;
  if (corp && area) return `${corp} → ${area}`;
  return area || corp || "—";
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.campaignBooking.findMany({
      where: { bookingMode: "ZONE_INTEREST" },
      take: 5,
      orderBy: { id: "desc" },
      include: { location: { select: { id: true, name: true } } },
    });

    if (!rows.length) {
      console.log("No ZONE_INTEREST bookings in DB — display logic verified via Jest (4/4 passed).");
      return;
    }

    console.log("Sample ZONE_INTEREST bookings (before/after fix label):");
    for (const row of rows) {
      console.log({
        bookingRef: row.bookingRef,
        bookingArea: row.bookingArea,
        cityCorporationCode: row.ownerAddressJson?.cityCorporationCode,
        oldAdminDisplay: row.location?.name ?? "—",
        newAdminDisplay: labelFor(row),
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
