/**
 * Shared DB discovery for FLOW_E2E_DB integration tests.
 * Prisma is required lazily so skipped e2e files do not open DB connections during Jest collection.
 */
const WAREHOUSE_TYPE_CODES = ["WAREHOUSE_DC", "WAREHOUSE", "CENTRAL_WAREHOUSE", "DISTRIBUTION_CENTER"] as const;

export type FlowE2eContext = {
  orgId: number;
  normalBranchId: number;
  warehouseFromLocationId: number;
  warehouseBranchId: number;
  requesterUserId: number;
  variantId: number;
  productId: number;
  toLocationId: number;
};

export async function tryLoadFlowE2eContext(): Promise<FlowE2eContext | null> {
  if (process.env.FLOW_E2E_DB !== "1") return null;
  const orgId = Number(process.env.FLOW_ORG_ID);
  if (!Number.isFinite(orgId)) return null;
  const prisma = require("../../src/infrastructure/db/prismaClient").default;

  const whLoc = await prisma.inventoryLocation.findFirst({
    where: {
      warehouseId: { not: null },
      branch: {
        orgId,
        typeLinks: { some: { branchType: { code: { in: [...WAREHOUSE_TYPE_CODES] } } } },
      },
      stockLotBalances: { some: { onHandQty: { gte: 2 } } },
    },
    select: { id: true, branchId: true },
    orderBy: { id: "asc" },
  });
  if (!whLoc) return null;

  const balance = await prisma.stockLotBalance.findFirst({
    where: { locationId: whLoc.id, onHandQty: { gte: 2 } },
    select: { lotId: true },
  });
  if (!balance) return null;

  const lot = await prisma.stockLot.findUnique({
    where: { id: balance.lotId },
    select: { variantId: true },
  });
  if (!lot) return null;

  const variant = await prisma.productVariant.findUnique({
    where: { id: lot.variantId },
    select: { id: true, productId: true },
  });
  if (!variant) return null;

  const normalBranch = await prisma.branch.findFirst({
    where: {
      orgId,
      id: { not: whLoc.branchId },
      NOT: {
        typeLinks: { some: { branchType: { code: { in: [...WAREHOUSE_TYPE_CODES] } } } },
      },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!normalBranch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { orgId, branchId: normalBranch.id, status: "ACTIVE" },
    select: { userId: true },
  });
  if (!member) return null;

  const toLoc = await prisma.inventoryLocation.findFirst({
    where: { branchId: normalBranch.id, branch: { orgId } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!toLoc) return null;

  return {
    orgId,
    normalBranchId: normalBranch.id,
    warehouseFromLocationId: whLoc.id,
    warehouseBranchId: whLoc.branchId,
    requesterUserId: member.userId,
    variantId: variant.id,
    productId: variant.productId,
    toLocationId: toLoc.id,
  };
}
