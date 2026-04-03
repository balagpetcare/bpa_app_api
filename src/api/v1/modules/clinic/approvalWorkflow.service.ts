/**
 * Approval Workflow Service (CCMLPA) — medicine override/exception approvals.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import type { MedicineApprovalRequestType, MedicineApprovalStatus } from "@prisma/client";

export type CreateApprovalInput = {
  orgId: number;
  branchId: number;
  requestType: MedicineApprovalRequestType;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  reason?: string | null;
  evidenceUrls?: string[] | null;
  requestedByUserId: number;
};

export async function createApprovalRequest(data: CreateApprovalInput): Promise<any> {
  return prisma.medicineApprovalRequest.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      requestType: data.requestType,
      relatedEntityType: data.relatedEntityType ?? null,
      relatedEntityId: data.relatedEntityId ?? null,
      reason: data.reason ?? null,
      evidenceUrls: data.evidenceUrls ?? null,
      requestedByUserId: data.requestedByUserId,
      status: "PENDING",
    },
    include: { requestedBy: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
}

export async function processApproval(
  requestId: number,
  action: "APPROVE" | "REJECT" | "ESCALATE",
  userId: number,
  comments?: string | null
): Promise<any> {
  const req = await prisma.medicineApprovalRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== "PENDING") throw new Error("Request not found or not pending");
  const newStatus: MedicineApprovalStatus =
    action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "ESCALATED";
  await prisma.$transaction([
    prisma.medicineApprovalAction.create({
      data: {
        approvalRequestId: requestId,
        actionByUserId: userId,
        action: action as any,
        comments: comments ?? null,
      },
    }),
    prisma.medicineApprovalRequest.update({
      where: { id: requestId },
      data: { status: newStatus },
    }),
  ]);
  return prisma.medicineApprovalRequest.findUnique({
    where: { id: requestId },
    include: { actions: true, requestedBy: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
}

export async function getPendingApprovals(branchId: number): Promise<any[]> {
  return prisma.medicineApprovalRequest.findMany({
    where: { branchId, status: "PENDING" },
    include: { requestedBy: { select: { id: true, profile: { select: { displayName: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}
