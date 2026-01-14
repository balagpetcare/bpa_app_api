import { prisma } from "../../lib/prisma";
import type { Request } from "express";
import { logAudit } from "../audit/audit.service";

export async function listRoles(orgId: number) {
  return prisma.role.findMany({
    where: { orgId },
    include: { permissions: { include: { permission: true } } },
    orderBy: { id: "desc" },
  });
}

export async function createRole(req: Request, orgId: number, input: { key: string; name: string }) {
  const created = await prisma.role.create({
    data: { orgId, key: input.key, name: input.name },
  });

  await logAudit({
    req,
    action: "CREATE",
    entityType: "Role",
    entityId: created.id,
    after: created,
    orgId,
  });

  return created;
}

export async function updateRole(req: Request, roleId: number, input: { name?: string; key?: string }) {
  const before = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!before) throw Object.assign(new Error("Role not found"), { statusCode: 404 });

  const updated = await prisma.role.update({
    where: { id: roleId },
    data: { name: input.name, key: input.key },
  });

  await logAudit({
    req,
    action: "UPDATE",
    entityType: "Role",
    entityId: roleId,
    before,
    after: updated,
    orgId: before.orgId,
  });

  return updated;
}

/**
 * Replace role permissions by permission keys.
 * Body: { keys: string[] }
 */
export async function replaceRolePermissions(req: Request, roleId: number, keys: string[]) {
  const before = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!before) throw Object.assign(new Error("Role not found"), { statusCode: 404 });

  const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (perms.length) {
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
    return tx.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
  });

  await logAudit({
    req,
    action: "UPDATE",
    entityType: "RolePermissions",
    entityId: roleId,
    before,
    after: updated,
    orgId: before.orgId,
    metadata: { keys },
  });

  return updated;
}