/**
 * Typed payloads for BranchAccessPermission upsert on staff invite acceptance.
 * Keeps create/update aligned with prisma/schema BranchAccessPermission (no stray keys).
 */
import type { Prisma } from "@prisma/client";

export type BranchAccessInviteAcceptParams = {
  branchId: number;
  userId: number;
  invitedByUserId: number;
  /** When omitted, `role` is not set on create/update (e.g. unmapped warehouse role for BAP). */
  memberRole?: Prisma.BranchAccessPermissionUncheckedCreateInput["role"] | null;
};

function roleSlice(
  memberRole: BranchAccessInviteAcceptParams["memberRole"]
): Pick<Prisma.BranchAccessPermissionUncheckedCreateInput, "role"> | Record<string, never> {
  if (memberRole === undefined || memberRole === null) return {};
  return { role: memberRole };
}

/**
 * APPROVED access from invite: sets invitedByUserId, approvedByUserId, approvedAt, optional role.
 */
export function branchAccessPermissionUpsertDataForInviteAccept(
  params: BranchAccessInviteAcceptParams
): {
  create: Prisma.BranchAccessPermissionUncheckedCreateInput;
  update: Prisma.BranchAccessPermissionUncheckedUpdateInput;
} {
  const { branchId, userId, invitedByUserId } = params;
  const now = new Date();
  const rf = roleSlice(params.memberRole);

  return {
    create: {
      branchId,
      userId,
      status: "APPROVED",
      invitedByUserId,
      approvedByUserId: invitedByUserId,
      approvedAt: now,
      ...rf,
    },
    update: {
      status: "APPROVED",
      invitedByUserId,
      approvedByUserId: invitedByUserId,
      approvedAt: now,
      ...rf,
    },
  };
}
