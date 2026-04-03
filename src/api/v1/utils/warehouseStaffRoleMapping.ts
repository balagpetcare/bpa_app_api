/**
 * Maps BranchMember / StaffInvite MemberRole values to Prisma WarehouseStaffRole
 * for rows that exist in both enums.
 */
const MEMBER_TO_WSA: Record<string, "WAREHOUSE_MANAGER" | "RECEIVING_STAFF" | "DISPATCH_STAFF"> = {
  WAREHOUSE_MANAGER: "WAREHOUSE_MANAGER",
  RECEIVING_STAFF: "RECEIVING_STAFF",
  DISPATCH_STAFF: "DISPATCH_STAFF",
};

export function memberRoleToWarehouseStaffRole(
  memberRole: string | null | undefined
): "WAREHOUSE_MANAGER" | "RECEIVING_STAFF" | "DISPATCH_STAFF" | null {
  if (!memberRole) return null;
  const key = String(memberRole).toUpperCase().trim();
  return MEMBER_TO_WSA[key] ?? null;
}
