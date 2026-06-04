/**
 * Branch-scoped order access for list/detail/cancel flows.
 * Prevents ambiguous BranchMember.findFirst({ userId }) from picking the wrong branch.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");

async function userCanAccessBranch(userId: number, branchId: number): Promise<boolean> {
  const member = await prisma.branchMember.findFirst({
    where: { userId, branchId, status: "ACTIVE" },
    select: { id: true },
  });
  if (member) return true;

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) return false;

  const asOwner = await prisma.organization.findFirst({
    where: { id: branch.orgId, ownerUserId: userId },
    select: { id: true },
  });
  if (asOwner) return true;

  const orgMember = await prisma.orgMember.findFirst({
    where: { userId, orgId: branch.orgId, status: "ACTIVE" },
    select: { id: true },
  });
  return Boolean(orgMember);
}

/**
 * Resolve branch filter for GET /orders.
 * - If `branchId` query is present: must be accessible.
 * - If absent: only allowed when user has exactly one ACTIVE branch membership (convenience).
 * - Otherwise 400 with message.
 */
async function resolveBranchIdForOrderList(
  userId: number,
  queryBranchId: unknown
): Promise<{ ok: true; branchId: number } | { ok: false; status: number; message: string }> {
  const raw = queryBranchId != null && queryBranchId !== "" ? parseInt(String(queryBranchId), 10) : NaN;
  if (Number.isFinite(raw)) {
    const ok = await userCanAccessBranch(userId, raw);
    if (!ok) {
      return { ok: false, status: 403, message: "You don't have access to this branch" };
    }
    return { ok: true, branchId: raw };
  }

  const memberships = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true },
    orderBy: { branchId: "asc" },
  });
  if (memberships.length === 1) {
    return { ok: true, branchId: memberships[0].branchId };
  }
  if (memberships.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "branchId query parameter is required (no active branch membership found)",
    };
  }
  return {
    ok: false,
    status: 400,
    message: "branchId query parameter is required when you belong to multiple branches",
  };
}

/**
 * Load order id and ensure caller may access that order's branch.
 */
async function assertOrderBranchAccess(userId: number, orderId: number): Promise<{ branchId: number }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId },
    select: { branchId: true },
  });
  if (!order) {
    throw Object.assign(new Error("Order not found"), { status: 404 });
  }
  const ok = await userCanAccessBranch(userId, order.branchId);
  if (!ok) {
    throw Object.assign(new Error("You don't have access to this order"), { status: 403 });
  }
  return { branchId: order.branchId };
}

module.exports = {
  userCanAccessBranch,
  resolveBranchIdForOrderList,
  assertOrderBranchAccess,
};

export {};
