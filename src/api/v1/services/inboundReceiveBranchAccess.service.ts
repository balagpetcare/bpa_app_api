/**
 * Branch allow-list for inbound receive (dispatches + transfers) at destination branch.
 */
import prisma from "../../../infrastructure/db/prismaClient";
import { getEffectiveBranchIdsForOwnerPanel } from "./ownerPanelAccess.service";

export async function getOrgIdForInboundUser(userId: number): Promise<number | null> {
  const owner = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (owner) return owner.id;
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  return member?.orgId ?? null;
}

/** ACTIVE BranchMember branchIds + owner-panel effective branches */
export async function getAllowedBranchIdsForInboundReceive(userId: number): Promise<number[]> {
  const [branchMemberIds, ownerPanelIds] = await Promise.all([
    prisma.branchMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { branchId: true },
    }),
    getEffectiveBranchIdsForOwnerPanel(prisma, userId),
  ]);
  const set = new Set<number>();
  for (const m of branchMemberIds) if (m.branchId != null) set.add(m.branchId);
  for (const id of ownerPanelIds) set.add(id);
  return Array.from(set);
}

/**
 * Read/print access for dispatch documents (challan, delivery note, worksheets).
 * Allows: org owner / org member for this org; branch members at destination OR source;
 * active WarehouseStaffAssignment on the dispatch source warehouse (same org).
 * Does NOT grant receive-posting — use {@link canUserAccessDispatchReceive} for that.
 */
export async function canUserAccessDispatchReadOrPrint(
  userId: number,
  params: { dispatchId: number; orgId: number; fromLocationId: number; toLocationId: number }
): Promise<boolean> {
  const orgIdUser = await getOrgIdForInboundUser(userId);
  if (orgIdUser != null && params.orgId === orgIdUser) return true;

  const allowedBranches = new Set(await getAllowedBranchIdsForInboundReceive(userId));

  const locs = await prisma.inventoryLocation.findMany({
    where: { id: { in: [params.fromLocationId, params.toLocationId] } },
    select: { id: true, branchId: true, warehouseId: true },
  });
  const from = locs.find((l) => l.id === params.fromLocationId);
  const to = locs.find((l) => l.id === params.toLocationId);

  if (to?.branchId != null && allowedBranches.has(to.branchId)) return true;
  if (from?.branchId != null && allowedBranches.has(from.branchId)) return true;

  if (from?.warehouseId != null) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: from.warehouseId, orgId: params.orgId, isActive: true },
      select: { id: true, branchId: true },
    });
    if (wh?.branchId != null && allowedBranches.has(wh.branchId)) return true;

    const wsa = await prisma.warehouseStaffAssignment.findFirst({
      where: {
        userId,
        isActive: true,
        warehouseId: from.warehouseId,
        warehouse: { orgId: params.orgId },
      },
      select: { id: true },
    });
    if (wsa) return true;
  }

  const delivery = await prisma.deliveryAssignment.findFirst({
    where: {
      dispatchId: params.dispatchId,
      assignedToUserId: userId,
      status: { not: "FAILED" },
      dispatch: { orgId: params.orgId },
    },
    select: { id: true },
  });
  if (delivery) return true;

  return false;
}

/** Receive-session / POST receive: destination branch staff or org-level (owner) for this org only. */
export async function canUserAccessDispatchReceive(
  userId: number,
  params: { orgId: number; toLocationId: number }
): Promise<boolean> {
  const orgIdUser = await getOrgIdForInboundUser(userId);
  if (orgIdUser != null && params.orgId === orgIdUser) return true;

  const allowedBranches = await getAllowedBranchIdsForInboundReceive(userId);
  const to = await prisma.inventoryLocation.findUnique({
    where: { id: params.toLocationId },
    select: { branchId: true },
  });
  return to?.branchId != null && allowedBranches.includes(to.branchId);
}
