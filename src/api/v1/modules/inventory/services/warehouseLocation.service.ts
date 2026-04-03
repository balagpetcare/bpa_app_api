import prisma from "../../../../../infrastructure/db/prismaClient";

export async function listWarehousesForOrg(orgId: number) {
  return prisma.warehouse.findMany({
    where: { orgId, isActive: true },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      orgId: true,
      branchId: true,
      name: true,
      code: true,
      type: true,
      isActive: true,
      qcInboundEnabled: true,
      createdAt: true,
    },
  });
}

export async function assertWarehouseBelongsToOrg(warehouseId: number, orgId: number): Promise<void> {
  const w = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, orgId: true },
  });
  if (!w || w.orgId !== orgId) {
    const err = new Error("Warehouse not found or access denied");
    (err as any).code = "FORBIDDEN_ORG";
    throw err;
  }
}

export async function listInventoryLocationsForOrg(
  orgId: number,
  filters?: { warehouseId?: number; branchId?: number }
) {
  const where: Record<string, unknown> = {
    isActive: true,
    branch: { orgId },
  };
  if (filters?.warehouseId != null) {
    where.warehouseId = filters.warehouseId;
  }
  if (filters?.branchId != null) {
    where.branchId = filters.branchId;
  }
  return prisma.inventoryLocation.findMany({
    where: where as any,
    orderBy: [{ name: "asc" }],
    include: {
      branch: { select: { id: true, name: true, orgId: true } },
      warehouse: { select: { id: true, name: true, code: true } },
      zone: { select: { id: true, code: true, name: true } },
      bin: { select: { id: true, code: true, name: true } },
    },
  });
}

export async function listAggregatedStockForWarehouse(params: {
  orgId: number;
  warehouseId: number;
  variantId?: number;
  page?: number;
  limit?: number;
}) {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 50, 200);
  const skip = (page - 1) * limit;

  const locs = await prisma.inventoryLocation.findMany({
    where: {
      warehouseId: params.warehouseId,
      isActive: true,
      branch: { orgId: params.orgId },
    },
    select: { id: true },
  });
  const locationIds = locs.map((l) => l.id);
  if (!locationIds.length) {
    return { items: [] as any[], pagination: { page, limit, total: 0, totalPages: 0 } };
  }

  const whereBal: Record<string, unknown> = {
    locationId: { in: locationIds },
  };
  if (params.variantId != null) {
    whereBal.variantId = params.variantId;
  }

  const [balances, total] = await Promise.all([
    prisma.stockBalance.findMany({
      where: whereBal as any,
      skip,
      take: limit,
      orderBy: [{ variantId: "asc" }],
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
            product: { select: { id: true, name: true } },
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            code: true,
            warehouseId: true,
          },
        },
      },
    }),
    prisma.stockBalance.count({ where: whereBal as any }),
  ]);

  const items = balances.map((b) => ({
    locationId: b.locationId,
    variantId: b.variantId,
    onHandQty: b.onHandQty,
    reservedQty: b.reservedQty,
    availableQty: Math.max(0, b.onHandQty - b.reservedQty),
    variant: b.variant,
    location: b.location,
  }));

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  };
}
