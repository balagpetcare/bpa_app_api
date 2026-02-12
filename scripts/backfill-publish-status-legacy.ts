/**
 * One-time backfill: set publishStatus = 'PUBLISHED' for products that have
 * approvalStatus = 'PUBLISHED' and publishStatus is null (legacy).
 * Run: npx ts-node -r ts-node/register scripts/backfill-publish-status-legacy.ts
 * Optional: DRY_RUN=1 to only count.
 */
import prisma from "../src/infrastructure/db/prismaClient";

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

async function main() {
  const toUpdate = await prisma.product.findMany({
    where: {
      approvalStatus: "PUBLISHED",
      publishStatus: null,
    },
    select: { id: true },
  });
  console.log(`Found ${toUpdate.length} legacy published products with null publishStatus`);
  if (DRY_RUN) {
    console.log("DRY_RUN: no changes made");
    return;
  }
  if (toUpdate.length === 0) return;
  const result = await prisma.product.updateMany({
    where: { id: { in: toUpdate.map((p) => p.id) } },
    data: { publishStatus: "PUBLISHED" },
  });
  console.log(`Updated ${result.count} products to publishStatus=PUBLISHED`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
