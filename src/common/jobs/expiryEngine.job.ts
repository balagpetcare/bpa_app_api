/**
 * Expiry Engine Job
 *
 * Runs daily to:
 * 1. Generate warnings for lots expiring in 30 days
 * 2. Generate critical alerts for lots expiring in 7 days
 * 3. Auto-create EXPIRED ledger entries for expired lots (remaining qty becomes unsellable)
 *
 * Usage:
 * - Run via cron job or in-process scheduler
 * - Can be called manually for testing
 */

const prisma = require("../../infrastructure/db/prismaClient");
const ledgerService = require("../../api/v1/modules/inventory/ledger.service");

const WARNING_DAYS = 30;
const CRITICAL_DAYS = 7;

/**
 * Main job: process expired lots and write off remaining stock
 */
export async function runExpiryEngineJob() {
  console.log("[JOB] Starting expiryEngine job...");
  const startTime = Date.now();

  try {
    const now = new Date();

    // Find all lot balances where lot is expired and onHandQty > 0
    const expiredLotBalances = await prisma.stockLotBalance.findMany({
      where: {
        onHandQty: { gt: 0 },
        lot: {
          expDate: { lt: now },
        },
      },
      include: {
        lot: { select: { id: true, variantId: true, lotCode: true, expDate: true } },
      },
    });

    let writeOffCount = 0;

    for (const lb of expiredLotBalances) {
      try {
        await ledgerService.recordLedgerEntry({
          locationId: lb.locationId,
          variantId: lb.lot.variantId,
          lotId: lb.lotId,
          type: "EXPIRED",
          quantityDelta: -lb.onHandQty,
          refType: "EXPIRY_JOB",
          refId: `lot-${lb.lotId}`,
        });
        writeOffCount += 1;
        console.log(`[JOB] Wrote off ${lb.onHandQty} from expired lot ${lb.lot.lotCode}`);
      } catch (err: any) {
        console.error(`[JOB] Failed to write off lot ${lb.lotId}:`, err?.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[JOB] Completed in ${duration}ms. Write-offs: ${writeOffCount}`);

    return {
      success: true,
      writeOffCount,
      processedLots: expiredLotBalances.length,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[JOB] Error in expiryEngine job:", error);
    return {
      success: false,
      error: String(error),
      duration,
    };
  }
}

/**
 * Get expiring warnings (for alerts/UI - read-only)
 */
export async function getExpiryWarnings() {
  const now = new Date();
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + WARNING_DAYS);
  const criticalDate = new Date();
  criticalDate.setDate(criticalDate.getDate() + CRITICAL_DAYS);

  const lotBalances = await prisma.stockLotBalance.findMany({
    where: {
      onHandQty: { gt: 0 },
      lot: {
        expDate: { gte: now, lte: warningDate },
      },
    },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          expDate: true,
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
      },
      location: {
        select: { id: true, name: true },
        include: { branch: { select: { id: true, name: true } } },
      },
    },
    orderBy: { lot: { expDate: "asc" } },
  });

  const warning = lotBalances.filter(
    (lb) => lb.lot.expDate && new Date(lb.lot.expDate) > criticalDate
  );
  const critical = lotBalances.filter(
    (lb) => lb.lot.expDate && new Date(lb.lot.expDate) <= criticalDate
  );

  return {
    warning: warning.map((lb) => ({
      lotId: lb.lotId,
      lot: lb.lot,
      onHandQty: lb.onHandQty,
      location: lb.location,
      daysToExpiry: Math.ceil(
        (new Date(lb.lot.expDate!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      ),
    })),
    critical: critical.map((lb) => ({
      lotId: lb.lotId,
      lot: lb.lot,
      onHandQty: lb.onHandQty,
      location: lb.location,
      daysToExpiry: Math.ceil(
        (new Date(lb.lot.expDate!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      ),
    })),
  };
}

// If run directly (for testing)
if (require.main === module) {
  runExpiryEngineJob()
    .then((result) => {
      console.log("[JOB] Result:", result);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("[JOB] Fatal error:", error);
      process.exit(1);
    });
}
