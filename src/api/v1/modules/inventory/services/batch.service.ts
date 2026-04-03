/**
 * Inventory stock lots (StockLot) — not the production authenticity `Batch` model.
 */
import prisma from "../../../../../infrastructure/db/prismaClient";

export async function getStockLotById(orgId: number, lotId: number) {
  const lot = await prisma.stockLot.findUnique({
    where: { id: lotId },
    include: {
      variant: { select: { id: true, sku: true, title: true } },
    },
  });
  if (!lot || lot.orgId !== orgId) return null;
  return lot;
}

export async function findStockLotsForVariant(orgId: number, variantId: number, opts?: { take?: number }) {
  return prisma.stockLot.findMany({
    where: { orgId, variantId },
    orderBy: [{ expDate: "asc" }],
    take: opts?.take ?? 100,
  });
}
