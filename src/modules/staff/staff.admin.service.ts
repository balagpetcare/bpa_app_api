// Staff/RBAC tables are not present in current Prisma schema.
// Provide stubs that satisfy controllers and TypeScript.

import type { Request } from "express";

export async function listStaff(_orgId?: number) {
  return [];
}

export async function createStaff(_req?: Request, _orgId?: number, _input?: any) {
  throw Object.assign(new Error("StaffProfile model not available in schema"), { statusCode: 501 });
}

export async function assignRole(_req?: Request, _staffId?: number, _roleId?: number) {
  throw Object.assign(new Error("StaffRole model not available in schema"), { statusCode: 501 });
}

export async function assignBranch(_req?: Request, _staffId?: number, _branchId?: number, _position?: any) {
  throw Object.assign(new Error("StaffBranchAssignment model not available in schema"), { statusCode: 501 });
}
