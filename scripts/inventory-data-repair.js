/**
 * Inventory maintenance: find orphan StockLots (no balances, no ledger, no GRN line refs).
 * Does not delete by default. Run with --apply to delete those safe orphans.
 *
 *   node scripts/inventory-data-repair.js
 *   node scripts/inventory-data-repair.js --apply
 *
 * Balance recomputation from ledger is not performed here; use a dedicated reconciliation job if drift is detected.
 */

const prisma = require("../src/infrastructure/db/prismaClient");

async function main() {
  const apply = process.argv.includes("--apply");

  const lots = await prisma.stockLot.findMany({
    select: { id: true, orgId: true, variantId: true, lotCode: true },
  });

  const orphans = [];
  for (const lot of lots) {
    const [balCount, ledCount, grnLineCount, transferItemCount, dispatchItemCount] = await Promise.all([
      prisma.stockLotBalance.count({ where: { lotId: lot.id } }),
      prisma.stockLedger.count({ where: { lotId: lot.id } }),
      prisma.grnLine.count({ where: { lotId: lot.id } }),
      prisma.stockTransferItem.count({ where: { lotId: lot.id } }),
      prisma.stockDispatchItem.count({ where: { lotId: lot.id } }),
    ]);
    const refs = balCount + ledCount + grnLineCount + transferItemCount + dispatchItemCount;
    if (refs === 0) {
      orphans.push(lot);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        scannedLots: lots.length,
        orphanCount: orphans.length,
        sample: orphans.slice(0, 100),
      },
      null,
      2
    )
  );

  if (apply && orphans.length) {
    const ids = orphans.map((o) => o.id);
    const deleted = await prisma.stockLot.deleteMany({ where: { id: { in: ids } } });
    // eslint-disable-next-line no-console
    console.log("Deleted orphan lots:", deleted.count);
  } else if (apply) {
    // eslint-disable-next-line no-console
    console.log("Nothing to delete.");
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
