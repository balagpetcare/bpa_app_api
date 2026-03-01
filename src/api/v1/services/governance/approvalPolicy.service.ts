/**
 * Producer Governance: minimal approval policy engine.
 * - Org must not be suspended.
 * - KYC (org status VERIFIED) required for submit (product/batch).
 * - Approve: only owner or platform admin; policy can require platform approval later.
 * - Phase 1: request-changes (SUBMITTED/UNDER_REVIEW -> CHANGES_REQUESTED), archive (REJECTED/INACTIVE -> ARCHIVED).
 */

import type { PrismaClient } from "@prisma/client";

/** Allowed product status transitions for admin actions. */
export const ALLOWED_PRODUCT_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ["UNDER_REVIEW", "REJECTED", "CHANGES_REQUESTED"],
  UNDER_REVIEW: ["ACTIVE", "REJECTED", "CHANGES_REQUESTED"],
  CHANGES_REQUESTED: ["SUBMITTED"],
  REJECTED: ["SUBMITTED", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: ["INACTIVE"],
};

export function isAllowedProductTransition(from: string, to: string): boolean {
  const allowed = ALLOWED_PRODUCT_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export async function checkOrgNotSuspended(prisma: PrismaClient, producerOrgId: number): Promise<void> {
  const org = await prisma.producerOrg.findUnique({
    where: { id: producerOrgId },
    select: { status: true },
  });
  if (!org) {
    const err = new Error("Producer organization not found") as Error & { code?: string; statusCode?: number };
    err.code = "ORG_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  if (org.status === "SUSPENDED") {
    const err = new Error("Producer organization is suspended") as Error & { code?: string; statusCode?: number };
    err.code = "ORG_SUSPENDED";
    err.statusCode = 403;
    throw err;
  }
}

export async function checkCanSubmit(
  prisma: PrismaClient,
  producerOrgId: number,
  entityType: "PRODUCT" | "BATCH",
  entityId: number,
  _userId: number
): Promise<void> {
  await checkOrgNotSuspended(prisma, producerOrgId);
  const org = await prisma.producerOrg.findUnique({
    where: { id: producerOrgId },
    select: { status: true },
  });
  if (org?.status !== "VERIFIED" && org?.status !== "PENDING") {
    const err = new Error("Producer organization must be verified to submit for approval") as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = "KYC_REQUIRED";
    err.statusCode = 403;
    throw err;
  }
  if (entityType === "BATCH") {
    const batch = await prisma.authBatch.findFirst({
      where: { id: entityId, authProduct: { producerOrgId } },
      include: { authProduct: { select: { status: true } } },
    });
    if (!batch) {
      const err = new Error("Batch not found") as Error & { code?: string; statusCode?: number };
      err.code = "BATCH_NOT_FOUND";
      err.statusCode = 404;
      throw err;
    }
    const productStatus = batch.authProduct?.status;
    if (productStatus !== "APPROVED" && productStatus !== "ACTIVE") {
      const err = new Error("Product must be APPROVED or ACTIVE before submitting a batch") as Error & {
        code?: string;
        statusCode?: number;
      };
      err.code = "PRODUCT_NOT_APPROVED";
      err.statusCode = 400;
      throw err;
    }
  }
}

export async function checkCanApprove(
  prisma: PrismaClient,
  producerOrgId: number,
  _entityType: "PRODUCT" | "BATCH",
  _entityId: number,
  _reviewedByUserId: number
): Promise<void> {
  await checkOrgNotSuspended(prisma, producerOrgId);
}

/** Request changes: only when approval is SUBMITTED (product SUBMITTED) or APPROVED + product UNDER_REVIEW. */
export async function checkCanRequestChanges(
  prisma: PrismaClient,
  approvalId: number,
  _reviewedByUserId: number
): Promise<{ approval: { id: number; entityType: string; entityId: number; producerOrgId: number; status: string }; product: { id: number; status: string } | null }> {
  const approval = await prisma.producerApproval.findFirst({ where: { id: approvalId } });
  if (!approval) {
    const err = new Error("Approval not found") as Error & { code?: string; statusCode?: number };
    err.code = "NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  await checkOrgNotSuspended(prisma, approval.producerOrgId);
  if (approval.entityType !== "PRODUCT") {
    const err = new Error("Request changes is only supported for product approvals") as Error & { code?: string; statusCode?: number };
    err.code = "ENTITY_TYPE";
    err.statusCode = 400;
    throw err;
  }
  const product = await prisma.authProduct.findFirst({
    where: { id: approval.entityId, producerOrgId: approval.producerOrgId },
    select: { id: true, status: true },
  });
  if (!product) {
    const err = new Error("Product not found") as Error & { code?: string; statusCode?: number };
    err.code = "PRODUCT_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  const canRequest =
    (approval.status === "SUBMITTED" && product.status === "SUBMITTED") ||
    (approval.status === "APPROVED" && product.status === "UNDER_REVIEW");
  if (!canRequest) {
    const err = new Error(
      "Request changes only allowed when product is SUBMITTED or UNDER_REVIEW"
    ) as Error & { code?: string; statusCode?: number };
    err.code = "INVALID_STATE";
    err.statusCode = 400;
    throw err;
  }
  return { approval: approval as any, product };
}

/** Archive product: only when status is REJECTED or INACTIVE. */
export async function checkCanArchive(
  prisma: PrismaClient,
  productId: number,
  producerOrgId: number
): Promise<void> {
  const product = await prisma.authProduct.findFirst({
    where: { id: productId, producerOrgId },
    select: { id: true, status: true },
  });
  if (!product) {
    const err = new Error("Product not found") as Error & { code?: string; statusCode?: number };
    err.code = "PRODUCT_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  if (product.status !== "REJECTED" && product.status !== "INACTIVE") {
    const err = new Error("Archive only allowed for REJECTED or INACTIVE products") as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = "INVALID_STATE";
    err.statusCode = 400;
    throw err;
  }
}

/** Unarchive: only when status is ARCHIVED. */
export async function checkCanUnarchive(
  prisma: PrismaClient,
  productId: number,
  producerOrgId: number
): Promise<void> {
  const product = await prisma.authProduct.findFirst({
    where: { id: productId, producerOrgId },
    select: { id: true, status: true },
  });
  if (!product) {
    const err = new Error("Product not found") as Error & { code?: string; statusCode?: number };
    err.code = "PRODUCT_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  if ((product.status as string) !== "ARCHIVED") {
    const err = new Error("Unarchive only allowed for ARCHIVED products") as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = "INVALID_STATE";
    err.statusCode = 400;
    throw err;
  }
}

/** Phase 2: Product must be APPROVED or ACTIVE before batch can be approved by admin. */
export async function checkProductApprovedForBatch(
  prisma: PrismaClient,
  batchId: number
): Promise<void> {
  const batch = await prisma.authBatch.findUnique({
    where: { id: batchId },
    include: { authProduct: { select: { id: true, status: true } } },
  });
  if (!batch) {
    const err = new Error("Batch not found") as Error & { code?: string; statusCode?: number };
    err.code = "BATCH_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  const status = batch.authProduct?.status;
  if (status !== "APPROVED" && status !== "ACTIVE") {
    const err = new Error("Product must be APPROVED or ACTIVE before batch can be approved") as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = "PRODUCT_NOT_APPROVED";
    err.statusCode = 400;
    throw err;
  }
}

/** Phase 2: Batch must be APPROVED before code generation. */
export async function checkBatchApprovedForCodes(
  prisma: PrismaClient,
  batchId: number
): Promise<void> {
  const batch = await prisma.authBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true },
  });
  if (!batch) {
    const err = new Error("Batch not found") as Error & { code?: string; statusCode?: number };
    err.code = "BATCH_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  const allowed: string[] = ["APPROVED", "GENERATED", "CODES_ALLOCATED", "PRINTED"];
  if (!allowed.includes(batch.status as string)) {
    const err = new Error("Batch must be approved before code generation") as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = "BATCH_NOT_APPROVED";
    err.statusCode = 400;
    throw err;
  }
}

/** Trust & Safety: batch must not be quarantined or frozen for code generate/export/print. */
export async function checkBatchNotQuarantinedOrFrozen(
  prisma: PrismaClient,
  batchId: number
): Promise<void> {
  const batch = await prisma.authBatch.findUnique({
    where: { id: batchId },
    select: { id: true, frozenAt: true, quarantinedAt: true },
  });
  if (!batch) {
    const err = new Error("Batch not found") as Error & { code?: string; statusCode?: number };
    err.code = "BATCH_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }
  const b = batch as { quarantinedAt?: Date | null };
  if (b.quarantinedAt) {
    const err = new Error("Batch is quarantined by admin") as Error & { code?: string; statusCode?: number };
    err.code = "BATCH_QUARANTINED";
    err.statusCode = 403;
    throw err;
  }
  if (batch.frozenAt) {
    const err = new Error("Batch is frozen by admin") as Error & { code?: string; statusCode?: number };
    err.code = "BATCH_FROZEN";
    err.statusCode = 403;
    throw err;
  }
}

/** Phase 2: Can void batch only if no VERIFIED codes exist. */
export async function checkCanVoidBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const verified = await prisma.authCode.count({
    where: { batchId, status: "VERIFIED" },
  });
  if (verified > 0) {
    const err = new Error(
      `Cannot void batch: ${verified} code(s) already verified. Void only batches with no verified codes.`
    ) as Error & { code?: string; statusCode?: number };
    err.code = "CODES_ALREADY_VERIFIED";
    err.statusCode = 400;
    throw err;
  }
}
