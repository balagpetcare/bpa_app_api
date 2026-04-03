/**
 * Stock request branch access — extends beyond BRANCH_MANAGER-only "managed branches"
 * so warehouse / DC staff with approved branch access + inventory permissions can create requests.
 */
import { BranchAccessPermissionStatus } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { BRANCH_ROLE_PERMISSIONS } from "../../constants/branchRoles";
import { getManagedBranchesForUser } from "../../services/branchManager.service";

const WAREHOUSE_HUB_TYPE_CODES = new Set([
  "WAREHOUSE_DC",
  "WAREHOUSE",
  "CENTRAL_WAREHOUSE",
  "DISTRIBUTION_CENTER",
]);

export function isWarehouseHubBranch(
  typeLinks: Array<{ branchType: { code: string } }> | null | undefined
): boolean {
  return (typeLinks ?? []).some((t) => WAREHOUSE_HUB_TYPE_CODES.has(t.branchType.code));
}

/**
 * Permission matrix for creating stock requests (aligned with staff UI + warehouse roles).
 */
export function permissionsAllowStockRequestCreate(isWarehouseHub: boolean, permissions: string[]): boolean {
  const p = new Set(permissions ?? []);
  if (isWarehouseHub) {
    return (
      p.has("inventory.request.create") ||
      p.has("warehouse.request.create") ||
      p.has("warehouse.operations") ||
      p.has("inventory.update") ||
      p.has("inventory.transfer")
    );
  }
  return (
    p.has("inventory.request.create") ||
    p.has("inventory.update") ||
    p.has("inventory.transfer")
  );
}

async function hasApprovedBranchAccess(userId: number, branchId: number): Promise<boolean> {
  const row = await prisma.branchAccessPermission.findUnique({
    where: { branchId_userId: { branchId, userId } },
    select: { status: true, expiresAt: true },
  });
  if (!row || row.status !== BranchAccessPermissionStatus.APPROVED) return false;
  if (row.expiresAt && new Date(row.expiresAt) <= new Date()) return false;
  return true;
}

export type StockRequestBranchGate = {
  ok: boolean;
  branch: { id: number; orgId: number; isWarehouseHub: boolean } | null;
};

/**
 * True if user may create/edit/submit stock requests for this branch (RBAC + org isolation).
 */
export async function userCanAccessStockRequestBranch(
  userId: number,
  branchId: number,
  permissions: string[]
): Promise<StockRequestBranchGate> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      orgId: true,
      typeLinks: { select: { branchType: { select: { code: true } } } },
    },
  });
  if (!branch) return { ok: false, branch: null };

  const isWarehouseHub = isWarehouseHubBranch(branch.typeLinks);

  const owned = await prisma.organization.findFirst({
    where: { id: branch.orgId, ownerUserId: userId },
    select: { id: true },
  });
  if (owned) {
    return { ok: true, branch: { id: branch.id, orgId: branch.orgId, isWarehouseHub } };
  }

  const managed = await getManagedBranchesForUser(userId);
  if (managed.some((b) => b.branchId === branchId)) {
    return { ok: true, branch: { id: branch.id, orgId: branch.orgId, isWarehouseHub } };
  }

  const member = await prisma.branchMember.findFirst({
    where: { userId, branchId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!member) {
    return { ok: false, branch: { id: branch.id, orgId: branch.orgId, isWarehouseHub } };
  }

  const accessOk = await hasApprovedBranchAccess(userId, branchId);
  if (!accessOk) {
    return { ok: false, branch: { id: branch.id, orgId: branch.orgId, isWarehouseHub } };
  }

  const wsaForBranch = await prisma.warehouseStaffAssignment.findMany({
    where: {
      userId,
      isActive: true,
      warehouse: { branchId, isActive: true },
    },
    select: { role: true },
  });
  const effectivePerms = new Set(permissions ?? []);
  for (const a of wsaForBranch) {
    const extra = BRANCH_ROLE_PERMISSIONS[String(a.role)] || [];
    for (const p of extra) effectivePerms.add(p);
  }

  if (!permissionsAllowStockRequestCreate(isWarehouseHub, Array.from(effectivePerms))) {
    return { ok: false, branch: { id: branch.id, orgId: branch.orgId, isWarehouseHub } };
  }

  return { ok: true, branch: { id: branch.id, orgId: branch.orgId, isWarehouseHub } };
}

/**
 * Branch IDs the user may list stock requests for (managers/owners + active staff with approved access).
 */
export async function getStockRequestListBranchIdsForUser(userId: number): Promise<number[]> {
  const managed = await getManagedBranchesForUser(userId);
  const ids = new Set<number>(managed.map((b) => b.branchId));

  const members = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true },
  });
  const branchIds = [...new Set(members.map((m) => m.branchId))];
  if (branchIds.length === 0) return Array.from(ids);

  const perms = await prisma.branchAccessPermission.findMany({
    where: {
      userId,
      branchId: { in: branchIds },
      status: BranchAccessPermissionStatus.APPROVED,
    },
    select: { branchId: true, expiresAt: true },
  });
  const now = new Date();
  for (const p of perms) {
    if (p.expiresAt && new Date(p.expiresAt) <= now) continue;
    ids.add(p.branchId);
  }

  return Array.from(ids);
}
