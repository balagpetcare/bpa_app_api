/**
 * Shared rules: which lots are excluded from FEFO / sale FEFO (QC hold, recall freeze).
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export async function getFrozenRecallLotIds(orgId: number, lotIds: number[]): Promise<Set<number>> {
  if (!lotIds.length) return new Set();
  const rows = await prisma.batchRecall.findMany({
    where: {
      orgId,
      status: "ACTIVE",
      allocationReleasedAt: null,
      lotId: { in: lotIds },
    },
    select: { lotId: true },
  });
  return new Set(rows.map((r) => r.lotId));
}

export async function getFrozenRecallLotIdsWithTx(tx: any, orgId: number, lotIds: number[]): Promise<Set<number>> {
  if (!lotIds.length) return new Set();
  const rows = await tx.batchRecall.findMany({
    where: {
      orgId,
      status: "ACTIVE",
      allocationReleasedAt: null,
      lotId: { in: lotIds },
    },
    select: { lotId: true },
  });
  return new Set(rows.map((r: { lotId: number }) => r.lotId));
}

/** Sum expectedQty of PENDING inspections per lot at a receive location. */
export async function getPendingQcHoldByLot(orgId: number, locationId: number): Promise<Map<number, number>> {
  const rows = await prisma.qcInspection.groupBy({
    by: ["lotId"],
    where: { orgId, locationId, status: "PENDING" },
    _sum: { expectedQty: true },
  });
  const m = new Map<number, number>();
  for (const r of rows) {
    const sum = r._sum.expectedQty ?? 0;
    if (sum > 0) m.set(r.lotId, sum);
  }
  return m;
}

export async function getPendingQcHoldByLotWithTx(
  tx: any,
  orgId: number,
  locationId: number
): Promise<Map<number, number>> {
  const rows = await tx.qcInspection.groupBy({
    by: ["lotId"],
    where: { orgId, locationId, status: "PENDING" },
    _sum: { expectedQty: true },
  });
  const m = new Map<number, number>();
  for (const r of rows) {
    const sum = r._sum.expectedQty ?? 0;
    if (sum > 0) m.set(r.lotId, sum);
  }
  return m;
}

export async function resolveOrgIdForLocation(locationId: number): Promise<number | null> {
  const loc = await prisma.inventoryLocation.findUnique({
    where: { id: locationId },
    select: { branch: { select: { orgId: true } } },
  });
  return loc?.branch?.orgId ?? null;
}

export async function resolveOrgIdForLocationWithTx(tx: any, locationId: number): Promise<number | null> {
  const loc = await tx.inventoryLocation.findUnique({
    where: { id: locationId },
    select: { branch: { select: { orgId: true } } },
  });
  return loc?.branch?.orgId ?? null;
}
