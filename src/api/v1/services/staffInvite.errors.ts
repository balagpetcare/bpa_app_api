/**
 * Structured errors for staff invite flows (HTTP layer maps codes → status + payload).
 */

export type StaffInviteDuplicateMeta = {
  inviteId: number;
  branchId?: number | null;
  warehouseId?: number | null;
  targetType: string;
  expiresAt: string;
  existingRole: string | null;
  existingWarehouseRole: string | null;
  existingInviteAsDoctor: boolean;
  requestedRoleMatches: false;
  nextActions: Array<"RESEND_INVITE" | "REVOKE_INVITE" | "WAIT_FOR_EXPIRY">;
};

export class StaffInviteDuplicatePendingError extends Error {
  readonly code = "INVITE_PENDING_DUPLICATE" as const;
  readonly meta: StaffInviteDuplicateMeta;

  constructor(message: string, meta: StaffInviteDuplicateMeta) {
    super(message);
    this.name = "StaffInviteDuplicatePendingError";
    this.meta = meta;
  }
}

export function isStaffInviteDuplicatePendingError(
  e: unknown
): e is StaffInviteDuplicatePendingError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "INVITE_PENDING_DUPLICATE"
  );
}
