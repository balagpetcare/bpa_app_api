import { prisma } from "../../lib/prisma";
import { logAudit } from "../audit/audit.service";
import type { Request } from "express";
import type { AuditEntityType } from "@prisma/client";

export async function listBranches(orgId: number) {
  return prisma.branch.findMany({
    where: { orgId },
    orderBy: { id: "desc" as const },
  });
}

type CreateBranchInput = {
  name: string;
  address?: unknown; // address is stored as addressJson in current schema
  capabilities?: unknown[]; // stored as capabilitiesJson (array/object)
};

export async function createBranch(req: Request, orgId: number, input: CreateBranchInput) {
  const created = await prisma.branch.create({
    data: {
      orgId,
      name: String(input.name),
      // Current Prisma schema in this repo uses JSON columns
      addressJson: (input as any).addressJson ?? input.address ?? null,
      capabilitiesJson: (input as any).capabilitiesJson ?? input.capabilities ?? null,
    } as any,
  });

  await logAudit({
    req,
    action: "CREATE",
    entityType: "BRANCH" as AuditEntityType,
    entityId: created.id,
    after: created,
  });

  return created;
}

type UpdateBranchInput = {
  name?: string;
  address?: unknown;
  capabilities?: unknown[]; // full replace
};

export async function updateBranch(req: Request, branchId: number, input: UpdateBranchInput) {
  const before = await prisma.branch.findUnique({
    where: { id: branchId },
  });
  if (!before) throw Object.assign(new Error("Branch not found"), { statusCode: 404 });

  const updated = await prisma.branch.update({
    where: { id: branchId },
    data: {
      name: input.name ?? undefined,
      addressJson: (input as any).addressJson ?? (input.address !== undefined ? input.address : undefined),
      capabilitiesJson:
        (input as any).capabilitiesJson ?? (input.capabilities !== undefined ? input.capabilities : undefined),
    } as any,
  });

  await logAudit({
    req,
    action: "UPDATE",
    entityType: "BRANCH" as AuditEntityType,
    entityId: branchId,
    before,
    after: updated,
  });

  return updated;
}
