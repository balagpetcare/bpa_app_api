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

async function submitProductForApproval(producerOrgId, productId, submittedByUserId) {
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(productId), producerOrgId },
    select: { id: true },
  });
  if (!product) throw createError("Product not found", 404);

  const approval = await prisma.producerApproval.upsert({
    where: { producerOrgId_entityType_entityId: { producerOrgId, entityType: "PRODUCT", entityId: product.id } },
    update: {
      status: "SUBMITTED",
      submittedByUserId,
      reviewedByUserId: null,
      reviewedAt: null,
      note: null,
    },
    create: {
      producerOrgId,
      entityType: "PRODUCT",
      entityId: product.id,
      status: "SUBMITTED",
      submittedByUserId,
    },
  });

  return approval;
}

async function submitBatchForApproval(producerOrgId, batchId, submittedByUserId) {
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId } },
    select: { id: true },
  });
  if (!batch) throw createError("Batch not found", 404);

  const approval = await prisma.producerApproval.upsert({
    where: { producerOrgId_entityType_entityId: { producerOrgId, entityType: "BATCH", entityId: batch.id } },
    update: {
      status: "SUBMITTED",
      submittedByUserId,
      reviewedByUserId: null,
      reviewedAt: null,
      note: null,
    },
    create: {
      producerOrgId,
      entityType: "BATCH",
      entityId: batch.id,
      status: "SUBMITTED",
      submittedByUserId,
    },
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

async function approveApproval(producerOrgId, approvalId, reviewedByUserId, note) {
  const approval = await prisma.producerApproval.findFirst({
    where: { id: Number(approvalId), producerOrgId },
  });
  if (!approval) throw createError("Approval not found", 404);
  if (approval.status !== "SUBMITTED") throw createError("Approval is not pending", 400);

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const row = await tx.producerApproval.update({
      where: { id: approval.id },
      data: { status: "APPROVED", reviewedByUserId, reviewedAt: now, note: note ? String(note) : null },
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

module.exports = {
  listApprovals,
  submitProductForApproval,
  submitBatchForApproval,
  autoApproveProductAsOwner,
  autoApproveBatchAsOwner,
  approveApproval,
  rejectApproval,
};

export {};
