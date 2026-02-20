/**
 * Backfill: Create one default InventoryLocation (type SHOP, name "{Branch name} - Main")
 * for each Branch that has zero locations. Idempotent (safe to run multiple times).
 *
 * Usage:
 *   npx ts-node scripts/backfill-default-inventory-locations.ts
 * Or:
 *   npm run build && node -r dotenv/config dist/scripts/backfill-default-inventory-locations.js
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[BACKFILL] Finding branches with no inventory locations...");

  const branches = await prisma.branch.findMany({
    select: { id: true, name: true },
  });

  let created = 0;
  let skipped = 0;

  for (const branch of branches) {
    const count = await prisma.inventoryLocation.count({
      where: { branchId: branch.id },
    });
    if (count === 0) {
      await prisma.inventoryLocation.create({
        data: {
          branchId: branch.id,
          type: "SHOP",
          name: branch.name ? `${branch.name} - Main` : "Main",
          code: null,
          isActive: true,
        },
      });
      created += 1;
      console.log(`[BACKFILL] Created default location for branch ${branch.id} (${branch.name}).`);
    } else {
      skipped += 1;
    }
  }

  console.log(`[BACKFILL] Done. Created: ${created}, Skipped (already had locations): ${skipped}.`);
}

main()
  .catch((e) => {
    console.error("[BACKFILL] Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
