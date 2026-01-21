// RBAC tables are not present in current Prisma schema.
// Keep lightweight stubs so TypeScript builds (and routes can exist without crashing typecheck).

import type { Request } from "express";

export async function listRoles(_orgId?: number) {
  return [];
}

export async function createRole(_req?: Request, _orgId?: number, _input?: any) {
  throw Object.assign(new Error("Role model not available in schema"), { statusCode: 501 });
}

export async function updateRole(_req?: Request, _id?: number, _input?: any) {
  throw Object.assign(new Error("Role model not available in schema"), { statusCode: 501 });
}

export async function replaceRolePermissions(_req?: Request, _roleId?: number, _keys?: string[]) {
  throw Object.assign(new Error("RolePermission model not available in schema"), { statusCode: 501 });
}
