const prisma = require("../../../../infrastructure/db/prismaClient");

type AppError = Error & { statusCode?: number; code?: string; fields?: Record<string, string> };
function createError(message: string, statusCode: number, code?: string, fields?: Record<string, string>): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  if (code) err.code = code;
  if (fields) err.fields = fields;
  return err;
}

async function listApprovals(producerOrgId, params: any = {}) {
  // Only return SUBMITTED (pending) by default so owner-auto-approved items never appear in inbox
  const statusParam = params.status ? String(params.status).toUpperCase() : null;
  const status =
    statusParam === "APPROVED" || statusParam === "REJECTED" ? statusParam : "SUBMITTED";
  const entityType = params.type ? String(params.type).toUpperCase() : null;
  const take = Math.min(Number(params.limit) || 50, 200);
  const skip = (Number(params.page || 1) - 1) * take;

  const where = {
    producerOrgId,
    status,
    ...(entityType ? { entityType } : {}),
  };

  const items = await prisma.producerApproval.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });

  return items;
}

const approvalPolicy = require("../../services/governance/approvalPolicy.service");

async function submitProductForApproval(producerOrgId, productId, submittedByUserId) {
  await approvalPolicy.checkCanSubmit(prisma, producerOrgId, "PRODUCT", Number(productId), submittedByUserId);
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(productId), producerOrgId },
    select: { id: true },
  });
  if (!product) throw createError("Product not found", 404);

  const slaHours = 48;
  const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);
  const approval = await prisma.producerApproval.upsert({
    where: { producerOrgId_entityType_entityId: { producerOrgId, entityType: "PRODUCT", entityId: product.id } },
    update: {
      status: "SUBMITTED",
      submittedByUserId,
      reviewedByUserId: null,
      reviewedAt: null,
      note: null,
      slaDeadline,
    },
    create: {
      producerOrgId,
      entityType: "PRODUCT",
      entityId: product.id,
      status: "SUBMITTED",
      submittedByUserId,
      slaDeadline,
    },
  });

  return approval;
}

async function submitBatchForApproval(producerOrgId, batchId, submittedByUserId) {
  await approvalPolicy.checkCanSubmit(prisma, producerOrgId, "BATCH", Number(batchId), submittedByUserId);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId } },
    select: { id: true },
  });
  if (!batch) throw createError("Batch not found", 404);

  const now = new Date();
  const approval = await prisma.$transaction(async (tx) => {
    await tx.authBatch.update({
      where: { id: batch.id },
      data: { status: "SUBMITTED", submittedAt: now },
    });
    const slaHours = 48;
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);
    return await tx.producerApproval.upsert({
      where: { producerOrgId_entityType_entityId: { producerOrgId, entityType: "BATCH", entityId: batch.id } },
      update: {
        status: "SUBMITTED",
        submittedByUserId,
        reviewedByUserId: null,
        reviewedAt: null,
        note: null,
        slaDeadline,
      },
      create: {
        producerOrgId,
        entityType: "BATCH",
        entityId: batch.id,
        status: "SUBMITTED",
        submittedByUserId,
        slaDeadline,
      },
    });
  });

  return approval;
}

/**
 * Owner submit: auto-approve product (UNDER_REVIEW) and upsert ProducerApproval as APPROVED.
 * Does not create SUBMITTED row so item never appears in pending approvals.
 */
async function autoApproveProductAsOwner(producerOrgId, productId, userId) {
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(productId), producerOrgId },
    select: { id: true, status: true },
  });
  if (!product) throw createError("Product not found", 404);

  const previousStatus = product.status || "DRAFT";
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updatedProduct = await tx.authProduct.update({
      where: { id: product.id },
      data: {
        status: "UNDER_REVIEW",
        submittedAt: now,
        reviewedAt: now,
      },
    });
    const approval = await tx.producerApproval.upsert({
      where: { producerOrgId_entityType_entityId: { producerOrgId, entityType: "PRODUCT", entityId: product.id } },
      update: {
        status: "APPROVED",
        submittedByUserId: userId,
        reviewedByUserId: userId,
        reviewedAt: now,
        note: null,
      },
      create: {
        producerOrgId,
        entityType: "PRODUCT",
        entityId: product.id,
        status: "APPROVED",
        submittedByUserId: userId,
        reviewedByUserId: userId,
        reviewedAt: now,
      },
    });
    return { product: updatedProduct, approval, previousStatus };
  });
  return result;
}

/**
 * Owner submit: auto-approve batch (APPROVED) and upsert ProducerApproval as APPROVED.
 */
async function autoApproveBatchAsOwner(producerOrgId, batchId, userId) {
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId } },
    select: { id: true },
  });
  if (!batch) throw createError("Batch not found", 404);

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.authBatch.update({
      where: { id: batch.id },
      data: { status: "APPROVED" },
    });
    const approval = await tx.producerApproval.upsert({
      where: { producerOrgId_entityType_entityId: { producerOrgId, entityType: "BATCH", entityId: batch.id } },
      update: {
        status: "APPROVED",
        submittedByUserId: userId,
        reviewedByUserId: userId,
        reviewedAt: now,
        note: null,
      },
      create: {
        producerOrgId,
        entityType: "BATCH",
        entityId: batch.id,
        status: "APPROVED",
        submittedByUserId: userId,
        reviewedByUserId: userId,
        reviewedAt: now,
      },
    });
    return { approval };
  });
  return result;
}

/** @param overridePayload - Phase 3: when set, persist overrideNote/overrideAt/overrideByUserId (compliance override) */
async function approveApproval(producerOrgId, approvalId, reviewedByUserId, note, overridePayload) {
  const approval = await prisma.producerApproval.findFirst({
    where: { id: Number(approvalId), producerOrgId },
  });
  if (!approval) throw createError("Approval not found", 404);
  if (approval.status !== "SUBMITTED") throw createError("Approval is not pending", 400);
  await approvalPolicy.checkCanApprove(prisma, producerOrgId, approval.entityType, approval.entityId, reviewedByUserId);

  const now = new Date();
  const data: {
    status: string;
    reviewedByUserId: any;
    reviewedAt: Date;
    note: string | null;
    overrideNote?: string | null;
    overrideAt?: Date;
    overrideByUserId?: number;
  } = { status: "APPROVED", reviewedByUserId, reviewedAt: now, note: note ? String(note) : null };
  if (overridePayload && (overridePayload.overrideNote !== undefined || overridePayload.overrideAt !== undefined)) {
    data.overrideNote = typeof overridePayload.overrideNote === "string" ? overridePayload.overrideNote : null;
    data.overrideAt = overridePayload.overrideAt instanceof Date ? overridePayload.overrideAt : now;
    data.overrideByUserId = reviewedByUserId;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.producerApproval.update({
      where: { id: approval.id },
      data,
    });

    if (approval.entityType === "PRODUCT") {
      // Owner internal approval: send to platform queue (UNDER_REVIEW). Only platform admin can set ACTIVE.
      await tx.authProduct.update({
        where: { id: approval.entityId },
        data: { status: "UNDER_REVIEW", reviewedAt: now, reviewNotes: note ? String(note) : null },
      });
    } else if (approval.entityType === "BATCH") {
      await tx.authBatch.update({
        where: { id: approval.entityId },
        data: { status: "APPROVED" },
      });
    }

    return row;
  });

  return updated;
}

async function rejectApproval(producerOrgId, approvalId, reviewedByUserId, note) {
  const approval = await prisma.producerApproval.findFirst({
    where: { id: Number(approvalId), producerOrgId },
  });
  if (!approval) throw createError("Approval not found", 404);
  if (approval.status !== "SUBMITTED") throw createError("Approval is not pending", 400);

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const row = await tx.producerApproval.update({
      where: { id: approval.id },
      data: { status: "REJECTED", reviewedByUserId, reviewedAt: now, note: note ? String(note) : null },
    });

    if (approval.entityType === "PRODUCT") {
      await tx.authProduct.update({
        where: { id: approval.entityId },
        data: { status: "REJECTED", reviewedAt: now, reviewNotes: note ? String(note) : null },
      });
    } else if (approval.entityType === "BATCH") {
      await tx.authBatch.update({
        where: { id: approval.entityId },
        data: { status: "REJECTED" },
      });
    }

    return row;
  });

  return updated;
}

/**
 * Platform admin: activate a product that is UNDER_REVIEW (owner already approved, now platform sets ACTIVE).
 * Approval must be status APPROVED, entityType PRODUCT, and AuthProduct.status UNDER_REVIEW.
 */
async function activateProductForPlatform(producerOrgId, approvalId, reviewedByUserId, note) {
  const approval = await prisma.producerApproval.findFirst({
    where: { id: Number(approvalId), producerOrgId },
  });
  if (!approval) throw createError("Approval not found", 404);
  if (approval.status !== "APPROVED" || approval.entityType !== "PRODUCT") {
    throw createError("Approval is not in platform-review state (APPROVED + PRODUCT)", 400);
  }
  const product = await prisma.authProduct.findFirst({
    where: { id: approval.entityId, producerOrgId },
    select: { id: true, status: true },
  });
  if (!product) throw createError("Product not found", 404);
  if (product.status !== "UNDER_REVIEW") {
    throw createError("Product is not under review; current status: " + (product.status || "unknown"), 400);
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.producerApproval.update({
      where: { id: approval.id },
      data: { reviewedByUserId, reviewedAt: now, note: note ? String(note) : null },
    });
    await tx.authProduct.update({
      where: { id: product.id },
      data: { status: "ACTIVE", reviewedAt: now, reviewNotes: note ? String(note) : null },
    });
  });

  return prisma.producerApproval.findFirst({ where: { id: approval.id } });
}

/**
 * Reject an approval that is APPROVED + PRODUCT + UNDER_REVIEW (platform reject without prior SUBMITTED).
 */
async function rejectUnderReviewProduct(producerOrgId, approvalId, reviewedByUserId, note) {
  const approval = await prisma.producerApproval.findFirst({
    where: { id: Number(approvalId), producerOrgId },
  });
  if (!approval) throw createError("Approval not found", 404);
  if (approval.status !== "APPROVED" || approval.entityType !== "PRODUCT") {
    throw createError("Approval is not in platform-review state", 400);
  }
  const product = await prisma.authProduct.findFirst({
    where: { id: approval.entityId, producerOrgId },
    select: { id: true, status: true },
  });
  if (!product || product.status !== "UNDER_REVIEW") {
    throw createError("Product not found or not under review", 400);
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.producerApproval.update({
      where: { id: approval.id },
      data: { status: "REJECTED", reviewedByUserId, reviewedAt: now, note: note ? String(note) : null },
    });
    await tx.authProduct.update({
      where: { id: product.id },
      data: { status: "REJECTED", reviewedAt: now, reviewNotes: note ? String(note) : null },
    });
    return row;
  });
  return updated;
}

/**
 * Admin: request changes on a product (SUBMITTED or UNDER_REVIEW -> CHANGES_REQUESTED).
 * Sets approval to REJECTED with note so producer can resubmit after fixing.
 */
async function requestChangesApproval(producerOrgId, approvalId, reviewedByUserId, note) {
  const approvalPolicy = require("../../services/governance/approvalPolicy.service");
  const { checkCanRequestChanges } = approvalPolicy;
  const { approval, product } = await checkCanRequestChanges(prisma, Number(approvalId), reviewedByUserId);
  if (approval.producerOrgId !== Number(producerOrgId)) throw createError("Approval not found", 404);

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.producerApproval.update({
      where: { id: approval.id },
      data: { status: "REJECTED", reviewedByUserId, reviewedAt: now, note: note ? String(note) : null },
    });
    await tx.authProduct.update({
      where: { id: product.id },
      data: {
        status: "CHANGES_REQUESTED",
        reviewedAt: now,
        reviewNotes: note ? String(note) : null,
      },
    });
    return await tx.producerApproval.findFirst({ where: { id: approval.id } });
  });
  return updated;
}

/**
 * Take reviewer lock on an approval (assign current user).
 */
async function takeReviewerLock(approvalId, userId) {
  const approval = await prisma.producerApproval.findFirst({
    where: { id: Number(approvalId) },
    select: { id: true, assignedToUserId: true },
  });
  if (!approval) throw createError("Approval not found", 404);
  if (approval.assignedToUserId != null && approval.assignedToUserId !== userId) {
    throw createError("Approval is already assigned to another reviewer", 409);
  }
  const now = new Date();
  return prisma.producerApproval.update({
    where: { id: approval.id },
    data: { assignedToUserId: userId, assignedAt: now },
  });
}

/**
 * Release reviewer lock (only if assigned to current user or force by same user).
 */
async function releaseReviewerLock(approvalId, userId) {
  const approval = await prisma.producerApproval.findFirst({
    where: { id: Number(approvalId) },
    select: { id: true, assignedToUserId: true },
  });
  if (!approval) throw createError("Approval not found", 404);
  if (approval.assignedToUserId != null && approval.assignedToUserId !== userId) {
    throw createError("Cannot release: approval is assigned to another reviewer", 403);
  }
  return prisma.producerApproval.update({
    where: { id: approval.id },
    data: { assignedToUserId: null, assignedAt: null },
  });
}

module.exports = {
  listApprovals,
  submitProductForApproval,
  submitBatchForApproval,
  autoApproveProductAsOwner,
  autoApproveBatchAsOwner,
  approveApproval,
  rejectApproval,
  activateProductForPlatform,
  rejectUnderReviewProduct,
  requestChangesApproval,
  takeReviewerLock,
  releaseReviewerLock,
};

export {};
