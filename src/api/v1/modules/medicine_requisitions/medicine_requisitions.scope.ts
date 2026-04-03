/**
 * Visibility and access for medicine requisitions — aligned with owner panel
 * (getEffectiveOrgIdsForOwnerPanel / getEffectiveBranchIdsForOwnerPanel) and
 * branch manager access (getManagedBranchesForUser).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const db = require("../../../../infrastructure/db/prismaClient").default;
const { BranchAccessPermissionStatus } = require("@prisma/client");
const { getManagedBranchesForUser } = require("../../services/branchManager.service");
const {
  getEffectiveOrgIdsForOwnerPanel,
  getEffectiveBranchIdsForOwnerPanel,
} = require("../../services/ownerPanelAccess.service");

export type ListScopeResult = {
  branchIds: number[];
  empty: boolean;
  /** Invalid orgId query (not in user's scope) */
  invalidOrg?: boolean;
};

/**
 * Resolves branch IDs visible for list/summary/count queries.
 * Never returns empty branchIds without empty=true (caller must not query unconstrained).
 */
async function resolveMedicineRequisitionListScope(
  userId: number,
  opts: { orgId?: number; branchId?: number }
): Promise<ListScopeResult> {
  const managed = await getManagedBranchesForUser(userId);
  const managedBranchIds = managed.map((b: { branchId: number }) => b.branchId);
  const managedOrgIds = [...new Set(managed.map((b: { orgId: number }) => b.orgId))];

  const effectiveBranchIds = await getEffectiveBranchIdsForOwnerPanel(db, userId);
  const effectiveOrgIds = await getEffectiveOrgIdsForOwnerPanel(db, userId);

  const visibleBranchIds = [...new Set([...effectiveBranchIds, ...managedBranchIds])];

  if (visibleBranchIds.length === 0) {
    return { branchIds: [], empty: true };
  }

  let scoped = visibleBranchIds;

  if (opts.orgId != null && Number.isFinite(opts.orgId)) {
    const oid = Number(opts.orgId);
    const allowedOrg = effectiveOrgIds.includes(oid) || managedOrgIds.includes(oid);
    if (!allowedOrg) {
      return { branchIds: [], empty: true, invalidOrg: true };
    }
    const inOrg = await db.branch.findMany({
      where: { orgId: oid, id: { in: visibleBranchIds } },
      select: { id: true },
    });
    scoped = inOrg.map((b: { id: number }) => b.id);
    if (scoped.length === 0) {
      return { branchIds: [], empty: true };
    }
  }

  if (opts.branchId != null && Number.isFinite(opts.branchId)) {
    const bid = Number(opts.branchId);
    if (!scoped.includes(bid)) {
      return { branchIds: [], empty: true };
    }
    scoped = [bid];
  }

  return { branchIds: scoped, empty: false };
}

/**
 * Read access for a single requisition (detail, export, etc.).
 */
async function canReadMedicineRequisition(
  userId: number,
  row: { branchId: number; orgId: number }
): Promise<boolean> {
  const scope = await resolveMedicineRequisitionListScope(userId, {});
  if (scope.empty) return false;
  return scope.branchIds.includes(row.branchId);
}

/**
 * Branch-level staff actions: submit, receive (branch staff).
 */
async function canActAsBranchStaffOnMedicineRequisition(
  userId: number,
  branchId: number
): Promise<boolean> {
  const managed = await getManagedBranchesForUser(userId);
  if (managed.some((b: { branchId: number }) => b.branchId === branchId)) return true;
  const effectiveBranchIds = await getEffectiveBranchIdsForOwnerPanel(db, userId);
  return effectiveBranchIds.includes(branchId);
}

/**
 * Create requisition on a branch: branch staff, org owner, or effective org/branch access.
 */
async function canCreateMedicineRequisitionOnBranch(
  userId: number,
  branch: { id: number; orgId: number }
): Promise<boolean> {
  const managed = await getManagedBranchesForUser(userId);
  if (managed.some((b: { branchId: number }) => b.branchId === branch.id)) return true;

  const ownedOrg = await db.organization.findFirst({
    where: { ownerUserId: userId, id: branch.orgId },
    select: { id: true },
  });
  if (ownedOrg) return true;

  const effectiveOrgIds = await getEffectiveOrgIdsForOwnerPanel(db, userId);
  if (effectiveOrgIds.includes(branch.orgId)) return true;

  const effectiveBranchIds = await getEffectiveBranchIdsForOwnerPanel(db, userId);
  return effectiveBranchIds.includes(branch.id);
}

/**
 * Update items / cancel: branch staff or org-level access (owner path).
 */
async function canModifyMedicineRequisitionItemsOrCancel(
  userId: number,
  row: { branchId: number; orgId: number }
): Promise<boolean> {
  const managed = await getManagedBranchesForUser(userId);
  if (managed.some((b: { branchId: number }) => b.branchId === row.branchId)) return true;

  const ownedOrg = await db.organization.findFirst({
    where: { ownerUserId: userId, id: row.orgId },
    select: { id: true },
  });
  if (ownedOrg) return true;

  const effectiveOrgIds = await getEffectiveOrgIdsForOwnerPanel(db, userId);
  if (effectiveOrgIds.includes(row.orgId)) return true;

  const effectiveBranchIds = await getEffectiveBranchIdsForOwnerPanel(db, userId);
  return effectiveBranchIds.includes(row.branchId);
}

/**
 * Medicine search at a branch: same as create access, or approved branch access (BAP)
 * so non-manager staff with pharmacy access can still search the catalog.
 */
async function canSearchMedicineAtBranch(
  userId: number,
  branch: { id: number; orgId: number }
): Promise<boolean> {
  if (await canCreateMedicineRequisitionOnBranch(userId, branch)) return true;
  const now = new Date();
  const staffAccess = await db.branchAccessPermission.findFirst({
    where: {
      userId,
      branchId: branch.id,
      status: BranchAccessPermissionStatus.APPROVED,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return !!staffAccess;
}

module.exports = {
  resolveMedicineRequisitionListScope,
  canReadMedicineRequisition,
  canActAsBranchStaffOnMedicineRequisition,
  canCreateMedicineRequisitionOnBranch,
  canModifyMedicineRequisitionItemsOrCancel,
  canSearchMedicineAtBranch,
};
