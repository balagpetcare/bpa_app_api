const { prisma } = require("../../../../lib/prisma");
const { signPayload } = require("../../utils/serialSigner");
const crypto = require("crypto");

function randomSerialCode(): string {
  return crypto.randomBytes(16).toString("base64url");
}

async function createBatch({
  productVersionId,
  factoryId,
  lineId,
  requestedQty,
  mfgDate,
  expDate,
  createdByUserId,
}) {
  if (!productVersionId || !factoryId || !requestedQty) {
    const err = new Error("productVersionId, factoryId, requestedQty are required");
    (err as any).statusCode = 400;
    throw err;
  }

  const batch = await prisma.batch.create({
    data: {
      productVersionId,
      factoryId,
      lineId: lineId || null,
      requestedQty,
      status: "PENDING",
      mfgDate: mfgDate ? new Date(mfgDate) : null,
      expDate: expDate ? new Date(expDate) : null,
      createdByUserId: createdByUserId || null,
    },
  });

  return batch;
}

async function approveBatch({ batchId, approvedQty }) {
  const id = Number(batchId);
  const qty = Number(approvedQty);
  if (!id || !Number.isFinite(qty) || qty <= 0) {
    const err = new Error("Invalid batchId or approvedQty");
    (err as any).statusCode = 400;
    throw err;
  }

  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) {
    const err = new Error("Batch not found");
    (err as any).statusCode = 404;
    throw err;
  }

  if (batch.status !== "PENDING") {
    const err = new Error("Batch is not pending");
    (err as any).statusCode = 400;
    throw err;
  }

  const updated = await prisma.batch.update({
    where: { id },
    data: { approvedQty: qty, status: "APPROVED" },
  });

  // Initialize quota usage for this batch (MVP)
  await prisma.quotaUsage.upsert({
    where: { batchId: id },
    update: { remainingQty: qty, issuedQty: 0 },
    create: { batchId: id, remainingQty: qty, issuedQty: 0 },
  });

  return updated;
}

async function issueSerials({ batchId, qty, issuedByUserId }) {
  const id = Number(batchId);
  const issueQty = Number(qty);
  if (!id || !Number.isFinite(issueQty) || issueQty <= 0) {
    const err = new Error("Invalid batchId or qty");
    (err as any).statusCode = 400;
    throw err;
  }

  const batch = await prisma.batch.findUnique({
    where: { id },
    include: { productVersion: true },
  });
  if (!batch) {
    const err = new Error("Batch not found");
    (err as any).statusCode = 404;
    throw err;
  }

  if (batch.status !== "APPROVED" && batch.status !== "ISSUED") {
    const err = new Error("Batch is not approved");
    (err as any).statusCode = 400;
    throw err;
  }

  const approvedQty = Number(batch.approvedQty || 0);
  if (!approvedQty) {
    const err = new Error("Batch approvedQty is not set");
    (err as any).statusCode = 400;
    throw err;
  }

  const existingCount = await prisma.serial.count({ where: { batchId: id } });
  if (existingCount + issueQty > approvedQty) {
    const err = new Error("Issue qty exceeds approved quota");
    (err as any).statusCode = 400;
    throw err;
  }

  const serialsToCreate = [];
  for (let i = 0; i < issueQty; i += 1) {
    const serialCode = randomSerialCode();
    const payload = `${serialCode}:${batch.productVersionId}:${id}`;
    const signature = signPayload(payload);
    serialsToCreate.push({
      batchId: id,
      serialCode,
      signature,
      status: "ISSUED",
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const range = await tx.serialRange.create({
      data: { batchId: id, qty: issueQty, issuedByUserId: issuedByUserId || null },
    });
    const created = await tx.serial.createMany({ data: serialsToCreate });
    await tx.batch.update({ where: { id }, data: { status: "ISSUED" } });

    await tx.quotaUsage.upsert({
      where: { batchId: id },
      update: {
        issuedQty: { increment: issueQty },
        remainingQty: { decrement: issueQty },
      },
      create: { batchId: id, issuedQty: issueQty, remainingQty: approvedQty - issueQty },
    });

    return { range, createdCount: created.count };
  });

  return result;
}

async function listBatches({ status, productVersionId, factoryId, page = 1, limit = 20 }) {
  const take = Math.min(Number(limit) || 20, 100);
  const skip = (Number(page) - 1) * take;
  const where: any = {};
  if (status) where.status = String(status).toUpperCase();
  if (productVersionId) where.productVersionId = Number(productVersionId);
  if (factoryId) where.factoryId = Number(factoryId);

  const [items, total] = await Promise.all([
    prisma.batch.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: { factory: true, line: true, productVersion: true },
    }),
    prisma.batch.count({ where }),
  ]);

  return { items, pagination: { page: Number(page), limit: take, total } };
}

module.exports = {
  createBatch,
  approveBatch,
  issueSerials,
  listBatches,
};
export { createBatch, approveBatch, issueSerials };
