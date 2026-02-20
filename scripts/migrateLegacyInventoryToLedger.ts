/**
 * Migration: Legacy Inventory → StockLot + OPENING ledgers
 *
 * For each Inventory row:
 * 1. Ensure branch has an InventoryLocation (create SHOP type if none)
 * 2. Create StockLot (orgId from branch, variantId, lotCode, mfgDate, expDate)
 * 3. Create OPENING ledger entry
 *
 * Run: npx ts-node scripts/migrateLegacyInventoryToLedger.ts
 * Options: --dryRun (validate only, no writes)
 */

const prisma = require("../src/infrastructure/db/prismaClient");
const ledgerService = require("../src/api/v1/modules/inventory/ledger.service");

const DRY_RUN = process.argv.includes("--dryRun");

async function ensureLocationForBranch(branchId: number): Promise<number> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { inventoryLocations: true },
  });
  if (!branch) throw new Error(`Branch ${branchId} not found`);

  let loc = branch.inventoryLocations?.[0];
  if (!loc) {
    if (DRY_RUN) return -1;
    loc = await prisma.inventoryLocation.create({
      data: {
        branchId,
        type: "SHOP",
        name: `${branch.name} (default)`,
        isActive: true,
      },
    });
  }
  return loc.id;
}

function generateLotCode(prefix: string, n: number): string {
  return `${prefix}-${Date.now().toString(36)}-${n}`;
}

async function migrate() {
  console.log(DRY_RUN ? "[DRY RUN] No writes" : "[LIVE] Migrating...");

  const rows = await prisma.inventory.findMany({
    where: { quantity: { gt: 0 } },
    include: { branch: true, product: true, variant: true },
  });

  const report = { total: rows.length, created: 0, errors: [] as { row: number; msg: string }[] };
  const seenLots = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const orgId = row.branch.orgId;
      const variantId = row.variantId ?? row.product?.variants?.[0]?.id;
      if (!variantId) {
        report.errors.push({ row: i + 1, msg: "No variant" });
        continue;
      }

      const locationId = await ensureLocationForBranch(row.branchId);
      if (DRY_RUN && locationId < 0) continue;

      const expDate = row.expiryDate ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const mfgDate = new Date(expDate);
      mfgDate.setFullYear(mfgDate.getFullYear() - 1);
      const lotKey = `${orgId}-${variantId}-${expDate.toISOString().slice(0, 10)}`;
      let lotId = seenLots.get(lotKey);

      if (!lotId) {
        if (DRY_RUN) {
          lotId = 1;
        } else {
          const lotCode = generateLotCode("LOT", i);
          const existing = await prisma.stockLot.findFirst({
            where: { orgId, variantId, expDate },
          });
          const lot = existing ?? (await prisma.stockLot.create({
            data: { orgId, variantId, lotCode, mfgDate, expDate },
          }));
          lotId = lot.id;
          seenLots.set(lotKey, lotId);
        }
      }

      if (!DRY_RUN && lotId && locationId) {
        await ledgerService.recordLedgerEntry({
          locationId,
          variantId,
          lotId,
          type: "OPENING",
          quantityDelta: row.quantity,
          refType: "MIGRATION",
          refId: `inv-${row.id}`,
        });
        report.created++;
      }
    } catch (e: any) {
      report.errors.push({ row: i + 1, msg: e?.message || "Unknown" });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  return report;
}

migrate()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
