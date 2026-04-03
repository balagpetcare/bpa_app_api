const prisma = require("../../../../infrastructure/db/prismaClient").default;

export async function approveDecisionPackage(params: {
  orgId: number;
  packageId: number;
  actorUserId: number;
  clientRequestId?: string;
  comment?: string;
}) {
  const pkg = await prisma.decisionPackage.findFirst({
    where: { id: params.packageId, orgId: params.orgId },
  });
  if (!pkg) return { ok: false, code: "NOT_FOUND", message: "Package not found" };
  if (pkg.status === "APPROVED") {
    return { ok: true, idempotent: true, status: "APPROVED", message: "Already approved" };
  }
  if (pkg.status !== "PROPOSED" && pkg.status !== "PENDING_APPROVAL") {
    return { ok: false, code: "INVALID_STATE", message: `Cannot approve from status ${pkg.status}` };
  }

  if (params.clientRequestId) {
    const existing = await prisma.decisionApprovalEvent.findFirst({
      where: {
        decisionPackageId: params.packageId,
        clientRequestId: params.clientRequestId,
        eventType: "APPROVED",
      },
    });
    if (existing) {
      return { ok: true, idempotent: true, status: "APPROVED", message: "Duplicate clientRequestId — ignored" };
    }
  }

  await prisma.$transaction([
    prisma.decisionApprovalEvent.create({
      data: {
        decisionPackageId: params.packageId,
        eventType: "APPROVED",
        actorUserId: params.actorUserId,
        clientRequestId: params.clientRequestId ?? null,
        comment: params.comment ?? null,
        payloadJson: {
          note: "Approval does not execute stock moves. Use stock-requests / PO APIs with human review.",
        },
      },
    }),
    prisma.decisionPackage.update({
      where: { id: params.packageId },
      data: {
        status: "APPROVED",
        approvedByUserId: params.actorUserId,
      },
    }),
    prisma.decisionPackageItem.updateMany({
      where: { decisionPackageId: params.packageId, state: "OPEN" },
      data: { state: "APPROVED" },
    }),
  ]);

  return { ok: true, idempotent: false, status: "APPROVED" };
}

export async function rejectDecisionPackage(params: {
  orgId: number;
  packageId: number;
  actorUserId: number;
  comment?: string;
  clientRequestId?: string;
}) {
  const pkg = await prisma.decisionPackage.findFirst({
    where: { id: params.packageId, orgId: params.orgId },
  });
  if (!pkg) return { ok: false, code: "NOT_FOUND" as const, message: "Package not found" };
  if (pkg.status === "REJECTED") return { ok: true, idempotent: true, message: "Already rejected" };

  await prisma.$transaction([
    prisma.decisionApprovalEvent.create({
      data: {
        decisionPackageId: params.packageId,
        eventType: "REJECTED",
        actorUserId: params.actorUserId,
        comment: params.comment ?? null,
        clientRequestId: params.clientRequestId ?? null,
      },
    }),
    prisma.decisionPackage.update({
      where: { id: params.packageId },
      data: { status: "REJECTED" },
    }),
    prisma.decisionPackageItem.updateMany({
      where: { decisionPackageId: params.packageId },
      data: { state: "REJECTED" },
    }),
  ]);

  return { ok: true };
}

export async function overrideDecisionPackage(params: {
  orgId: number;
  packageId: number;
  actorUserId: number;
  overrideJson: Record<string, unknown>;
  comment?: string;
}) {
  const pkg = await prisma.decisionPackage.findFirst({
    where: { id: params.packageId, orgId: params.orgId },
  });
  if (!pkg) return { ok: false, code: "NOT_FOUND", message: "Package not found" };

  await prisma.decisionApprovalEvent.create({
    data: {
      decisionPackageId: params.packageId,
      eventType: "OVERRIDE",
      actorUserId: params.actorUserId,
      comment: params.comment ?? null,
      payloadJson: params.overrideJson,
    },
  });

  await prisma.decisionPackage.update({
    where: { id: params.packageId },
    data: { status: "PENDING_APPROVAL" },
  });

  return { ok: true };
}
