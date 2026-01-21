import { prisma } from "../../lib/prisma";
import type { Prisma } from "@prisma/client";

// PartnerStatus enum in schema: NOT_APPLIED, PENDING_REVIEW, APPROVED, REJECTED, SUSPENDED
const VALID = new Set(["NOT_APPLIED", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"]);

export async function list(status?: string) {
  const where: Prisma.PartnerApplicationWhereInput = {};
  if (status) {
    const s = String(status).toUpperCase();
    if (VALID.has(s)) where.status = s as any;
  }

  return prisma.partnerApplication.findMany({
    where,
    include: { user: { include: { profile: true, auth: true } } },
    orderBy: { id: "desc" as const },
  });
}

export async function markUnderReview(adminId: number, id: number) {
  // schema doesn't have UNDER_REVIEW; keep as PENDING_REVIEW but stamp reviewer/time
  return prisma.partnerApplication.update({
    where: { id },
    data: { status: "PENDING_REVIEW" as any, reviewedByAdminId: adminId, reviewedAt: new Date() } as any,
  });
}

export async function approve(adminId: number, id: number) {
  return prisma.partnerApplication.update({
    where: { id },
    data: { status: "APPROVED" as any, reviewedByAdminId: adminId, reviewedAt: new Date() } as any,
  });
}

export async function reject(adminId: number, id: number, note?: string) {
  return prisma.partnerApplication.update({
    where: { id },
    data: { status: "REJECTED" as any, reviewNote: note || null, reviewedByAdminId: adminId, reviewedAt: new Date() } as any,
  });
}
