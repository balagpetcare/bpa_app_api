import { prisma } from "../../lib/prisma";

/**
 * Create a staff profile for an existing userId under an organization.
 * Assign roles and branch access via separate functions (below).
 */
export async function createStaffProfile(input: {
  userId: number;
  orgId: number;
  fullName?: string;
  phone?: string;
  title?: string;
}) {
  return prisma.staffProfile.create({ data: input });
}

export async function assignRoleToStaff(staffId: number, roleId: number) {
  return prisma.staffRole.upsert({
    where: { staffId_roleId: { staffId, roleId } },
    update: {},
    create: { staffId, roleId },
  });
}

export async function assignBranchToStaff(staffId: number, branchId: number, position?: string) {
  return prisma.staffBranchAssignment.upsert({
    where: { staffId_branchId: { staffId, branchId } },
    update: { position },
    create: { staffId, branchId, position },
  });
}

export async function getStaffWithAccess(staffId: number) {
  return prisma.staffProfile.findUnique({
    where: { id: staffId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      branches: { include: { branch: true } },
    },
  });
}