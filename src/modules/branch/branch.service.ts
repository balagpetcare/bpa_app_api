import { prisma } from "../../lib/prisma";
import type { BranchCapability } from "@prisma/client";
import { logAudit } from "../audit/audit.service";
import type { Request } from "express";

export async function listBranches(orgId: number) {
  return prisma.branch.findMany({
    where: { orgId },
    include: { capabilities: true },
    orderBy: { id: "desc" },
  });
}

export async function createBranch(req: Request, orgId: number, input: {
  name: string;
  code: string;
  address?: string;
  capabilities?: BranchCapability[];
}) {
  const created = await prisma.branch.create({
    data: {
      orgId,
      name: input.name,
      code: input.code,
      address: input.address,
      capabilities: input.capabilities?.length
        ? {
            create: input.capabilities.map((c) => ({ capability: c })),
          }
        : undefined,
    },
    include: { capabilities: true },
  });

  await logAudit({
    req,
    action: "CREATE",
    entityType: "Branch",
    entityId: created.id,
    after: created,
    orgId,
  });

  return created;
}

export async function updateBranch(req: Request, branchId: number, input: {
  name?: string;
  address?: string;
  isActive?: boolean;
  capabilities?: BranchCapability[]; // full replace
}) {
  const before = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { capabilities: true },
  });
  if (!before) throw Object.assign(new Error("Branch not found"), { statusCode: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    if (input.capabilities) {
      await tx.branchCapabilityLink.deleteMany({ where: { branchId } });
      await tx.branchCapabilityLink.createMany({
        data: input.capabilities.map((c) => ({ branchId, capability: c })),
        skipDuplicates: true,
      });
    }

    return tx.branch.update({
      where: { id: branchId },
      data: {
        name: input.name,
        address: input.address,
        isActive: input.isActive,
      },
      include: { capabilities: true },
    });
  });

  await logAudit({
    req,
    action: "UPDATE",
    entityType: "Branch",
    entityId: branchId,
    before,
    after: updated,
    orgId: before.orgId,
  });

  return updated;
}