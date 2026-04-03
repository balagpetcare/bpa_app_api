import { Request, Response } from "express";
import prisma from "../../../../infrastructure/db/prismaClient";

async function assertOrg(userId: number, orgId: number) {
  const owner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId }, select: { id: true } });
  if (owner) return;
  const m = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" } });
  if (!m) throw new Error("Forbidden");
}

/**
 * GET /inventory/quarantine-stock?orgId=
 * Lot balances in QUARANTINE, DAMAGE_AREA, or RETURN_AREA (blocked from normal FEFO allocation).
 */
export async function listQuarantineStock(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseInt(String((req.query as any).orgId), 10);
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    await assertOrg(userId, orgId);

    const locs = await prisma.inventoryLocation.findMany({
      where: {
        branch: { orgId },
        type: { in: ["QUARANTINE", "DAMAGE_AREA", "RETURN_AREA"] },
        isActive: true,
      },
      select: { id: true, name: true, type: true, branchId: true },
    });
    const locIds = locs.map((l) => l.id);
    if (!locIds.length) {
      return res.json({ success: true, data: { locations: [], lines: [] } });
    }

    const balances = await prisma.stockLotBalance.findMany({
      where: {
        locationId: { in: locIds },
        onHandQty: { gt: 0 },
        lot: { orgId },
      },
      include: {
        lot: {
          select: {
            id: true,
            lotCode: true,
            expDate: true,
            variant: { select: { id: true, sku: true, title: true, product: { select: { name: true } } } },
          },
        },
        location: { select: { id: true, name: true, type: true, branchId: true } },
      },
      orderBy: [{ locationId: "asc" }, { lotId: "asc" }],
      take: 500,
    });

    const recallRows = await prisma.batchRecall.findMany({
      where: { orgId, status: { in: ["ACTIVE", "QUARANTINED"] } },
      select: { lotId: true, id: true, status: true, severity: true },
    });
    const recallByLot = new Map(recallRows.map((r) => [r.lotId, r]));

    const lines = balances.map((b) => ({
      locationId: b.locationId,
      locationName: b.location.name,
      locationType: b.location.type,
      branchId: b.location.branchId,
      lotId: b.lotId,
      lotCode: b.lot.lotCode,
      expDate: b.lot.expDate,
      variantId: b.lot.variant.id,
      sku: b.lot.variant.sku,
      title: b.lot.variant.title,
      productName: b.lot.variant.product?.name,
      onHandQty: b.onHandQty,
      reservedQty: b.reservedQty,
      recall: recallByLot.get(b.lotId) ?? null,
    }));

    return res.json({
      success: true,
      data: { locations: locs, lines },
    });
  } catch (e: any) {
    return res.status(e.message === "Forbidden" ? 403 : 400).json({ success: false, message: e.message });
  }
}
