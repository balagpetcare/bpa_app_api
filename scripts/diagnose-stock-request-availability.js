/**
 * Read-only diagnostic: stock request lines vs stock_balances / stock_lot_balances at a location.
 * Usage (from backend-api): node scripts/diagnose-stock-request-availability.js <stockRequestId> <fromLocationId>
 * Requires DATABASE_URL.
 */
/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

async function main() {
  const requestId = parseInt(process.argv[2], 10);
  const locationId = parseInt(process.argv[3], 10);
  if (!Number.isFinite(requestId) || !Number.isFinite(locationId)) {
    console.error("Usage: node scripts/diagnose-stock-request-availability.js <stockRequestId> <fromLocationId>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const sr = await prisma.stockRequest.findUnique({
      where: { id: requestId },
      include: {
        items: { select: { id: true, variantId: true, requestedQty: true, lineKind: true } },
      },
    });
    if (!sr) {
      console.error("Stock request not found");
      process.exit(2);
    }

    const loc = await prisma.inventoryLocation.findUnique({
      where: { id: locationId },
      include: { branch: { select: { id: true, name: true, orgId: true } } },
    });
    if (!loc) {
      console.error("Location not found");
      process.exit(3);
    }

    console.log(JSON.stringify({ requestId: sr.id, orgId: sr.orgId, fromLocationId: locationId, branchOrgId: loc.branch?.orgId }, null, 2));

    if (loc.branch?.orgId !== sr.orgId) {
      console.warn("WARNING: location branch orgId !== stockRequest.orgId (same-org enforcement should block fulfill).");
    }

    const variants = [...new Set(sr.items.filter((i) => i.lineKind !== "EXTRA").map((i) => i.variantId))];

    for (const vid of variants) {
      const bal = await prisma.stockBalance.findUnique({
        where: { locationId_variantId: { locationId, variantId: vid } },
      });
      const lotsAny = await prisma.stockLotBalance.findMany({
        where: { locationId, onHandQty: { gt: 0 }, lot: { variantId: vid } },
        include: { lot: { select: { id: true, orgId: true, expDate: true, lotCode: true } } },
      });
      const wrongOrg = lotsAny.filter((l) => l.lot.orgId !== sr.orgId);
      const legacy = await prisma.inventory.aggregate({
        where: { branchId: loc.branchId, variantId: vid },
        _sum: { quantity: true },
      });

      console.log(
        "variant",
        vid,
        JSON.stringify(
          {
            stockBalance: bal ? { onHandQty: bal.onHandQty, reservedQty: bal.reservedQty } : null,
            lotBalanceRows: lotsAny.length,
            lotRowsWrongOrg: wrongOrg.length,
            legacyInventoryBranchQty: legacy._sum.quantity ?? 0,
          },
          null,
          2
        )
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
