const prisma = require("../../../../infrastructure/db/prismaClient");
const createError = require("../../utils/apiError");

async function listApprovals(producerOrgId, params = {}) {
  const status = params.status ? String(params.status).toUpperCase() : "SUBMITTED";
  const entityType = params.type ? String(params.type).toUpperCase() : null;
  const take = Math.min(Number(params.limit) || 50, 200);
  const skip = (Number(params.page || 1) - 1) * take;

  const where = {
    producerOrgId,
    ...(status ? { status } : {}),
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
      await tx.authProduct.update({
        where: { id: approval.entityId },
        data: { status: "APPROVED", reviewedAt: now, reviewNotes: note ? String(note) : null },
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
  approveApproval,
  rejectApproval,
};

export {};

