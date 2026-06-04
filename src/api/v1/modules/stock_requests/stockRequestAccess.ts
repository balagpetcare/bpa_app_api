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

/** Stock requests that can appear on the warehouse requisition queue (subset of Prisma statuses). */
const WAREHOUSE_FULFILLMENT_VIEW_STATUSES = new Set([
  "SUBMITTED",
  "OWNER_REVIEW",
  "APPROVED",
  "PARTIALLY_DISPATCHED",
  "FULFILLED_PARTIAL",
]);

/**
 * Warehouse / outbound staff may view a stock request that belongs to another branch when:
 * - they have warehouse or outbound permissions,
 * - they are assigned to a warehouse in the same org as the request, and
 * - the request is in an active fulfillment state and either matches requisition "approval" rows or
 *   has pick/dispatch activity from that warehouse's locations (same idea as warehouse operations queue).
 */
export async function canUserViewStockRequestViaWarehouseFulfillment(
  userId: number,
  stockRequestId: number,
  permissions: string[]
): Promise<boolean> {
  const p = new Set(permissions ?? []);
  if (
    !p.has("warehouse.view") &&
    !p.has("warehouse.operations") &&
    !p.has("warehouse.manage") &&
    !p.has("warehouse.pick.execute") &&
    !p.has("warehouse.pick") &&
    !p.has("outbound.read")
  ) {
    return false;
  }

  const assignments = await prisma.warehouseStaffAssignment.findMany({
    where: { userId, isActive: true, warehouse: { isActive: true } },
    select: {
      warehouse: {
        select: {
          orgId: true,
          locations: { where: { isActive: true }, select: { id: true } },
        },
      },
    },
  });
  const orgIds = new Set(assignments.map((a) => a.warehouse.orgId));
  const locIds = new Set<number>();
  for (const a of assignments) {
    for (const loc of a.warehouse.locations) {
      locIds.add(loc.id);
    }
  }
  if (!orgIds.size) return false;

  const sr = await prisma.stockRequest.findUnique({
    where: { id: stockRequestId },
    select: {
      orgId: true,
      status: true,
      requestIntent: true,
      dispatches: { select: { fromLocationId: true } },
      allocationPlans: {
        where: { parentPlanId: null },
        orderBy: { id: "desc" },
        take: 1,
        select: {
          fromLocationId: true,
          pickLists: { select: { fromLocationId: true } },
        },
      },
    },
  });
  if (!sr || !orgIds.has(sr.orgId)) return false;
  const st = String(sr.status || "").toUpperCase();
  if (!WAREHOUSE_FULFILLMENT_VIEW_STATUSES.has(st)) return false;

  if (st === "SUBMITTED" || st === "OWNER_REVIEW") {
    return true;
  }

  if (!locIds.size) {
    return st === "APPROVED" && String(sr.requestIntent || "") === "INTERNAL_TRANSFER" && sr.allocationPlans.length === 0;
  }
  for (const d of sr.dispatches) {
    if (locIds.has(d.fromLocationId)) return true;
  }
  for (const plan of sr.allocationPlans) {
    if (plan.fromLocationId != null && locIds.has(plan.fromLocationId)) return true;
    for (const pl of plan.pickLists) {
      if (locIds.has(pl.fromLocationId)) return true;
    }
  }
  if (st === "APPROVED" && String(sr.requestIntent || "") === "INTERNAL_TRANSFER" && sr.allocationPlans.length === 0) {
    return true;
  }
  return false;
}
