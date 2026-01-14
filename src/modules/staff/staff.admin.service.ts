import { prisma } from "../../lib/prisma";
import type { Request } from "express";
import { logAudit } from "../audit/audit.service";

export async function listStaff(orgId: number) {
  return prisma.staffProfile.findMany({
    where: { orgId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      branches: { include: { branch: true } },
    },
    orderBy: { id: "desc" },
  });
}

export async function createStaff(req: Request, orgId: number, input: {
  userId: number;
  fullName?: string;
  phone?: string;
  title?: string;
}) {
  const created = await prisma.staffProfile.create({
    data: { ...input, orgId },
  });

  await logAudit({
    req,
    action: "CREATE",
    entityType: "StaffProfile",
    entityId: created.id,
    after: created,
    orgId,
  });

  return created;
}

export async function assignRole(req: Request, staffId: number, roleId: number) {
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
  if (!staff) throw Object.assign(new Error("Staff not found"), { statusCode: 404 });

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw Object.assign(new Error("Role not found"), { statusCode: 404 });

  if (role.orgId !== staff.orgId) {
    throw Object.assign(new Error("Role does not belong to staff org"), { statusCode: 400 });
  }

  const before = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    include: { roles: { include: { role: true } } },
  });

  const link = await prisma.staffRole.upsert({
    where: { staffId_roleId: { staffId, roleId } },
    update: {},
    create: { staffId, roleId },
  });

  const after = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    include: { roles: { include: { role: true } } },
  });

  await logAudit({
    req,
    action: "UPDATE",
    entityType: "StaffRole",
    entityId: link.id,
    before,
    after,
    orgId: staff.orgId,
    metadata: { staffId, roleId },
  });

  return link;
}

export async function assignBranch(req: Request, staffId: number, branchId: number, position?: string) {
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
  if (!staff) throw Object.assign(new Error("Staff not found"), { statusCode: 404 });

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw Object.assign(new Error("Branch not found"), { statusCode: 404 });

  if (branch.orgId !== staff.orgId) {
    throw Object.assign(new Error("Branch does not belong to staff org"), { statusCode: 400 });
  }

  const before = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    include: { branches: { include: { branch: true } } },
  });

  const link = await prisma.staffBranchAssignment.upsert({
    where: { staffId_branchId: { staffId, branchId } },
    update: { position },
    create: { staffId, branchId, position },
  });

  const after = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    include: { branches: { include: { branch: true } } },
  });

  await logAudit({
    req,
    action: "UPDATE",
    entityType: "StaffBranchAssignment",
    entityId: link.id,
    before,
    after,
    orgId: staff.orgId,
    metadata: { staffId, branchId, position },
  });

  return link;
}