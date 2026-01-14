const prisma = require('../../../../infrastructure/db/prismaClient');
const payout = require('./payout_orchestrator');
const payoutCrypto = require('../../../../utils/crypto/payoutDetailsCrypto');

function parseIntSafe(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function getMyWallet({ userId }) {
  const uid = Number(userId);
  const wallet = await prisma.userWallet.upsert({
    where: { userId: uid },
    update: {},
    create: {
      userId: uid,
      balance: 0,
      availableBalance: 0,
      pendingBalance: 0,
      lockedBalance: 0,
    },
  });

  // Backward compatibility: older wallets may have only `balance` populated.
  // If split balances are all zero but balance is positive, treat it as available.
  const sumSplit =
    Number(wallet.availableBalance) + Number(wallet.pendingBalance) + Number(wallet.lockedBalance);
  if (sumSplit === 0 && Number(wallet.balance) > 0) {
    return prisma.userWallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: wallet.balance,
      },
    });
  }

  return wallet;
}

async function listMyTransactions({ userId, limit = 20, cursor, type, status, sourceType }) {
  const wallet = await getMyWallet({ userId });
  const take = Math.min(parseIntSafe(limit, 20), 100);

  const where = {
    walletId: wallet.id,
  };
  if (type) where.type = String(type).toUpperCase();
  if (status) where.status = String(status).toUpperCase();
  if (sourceType) where.sourceType = String(sourceType).toUpperCase();

  const args = {
    where,
    take,
    orderBy: { id: 'desc' },
  };
  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }

  const items = await prisma.walletTransaction.findMany(args);
  const nextCursor = items.length === take ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

// -----------------------------
// Wallet Withdraw Requests (V2)
// -----------------------------

async function createWithdrawRequest({ userId, body, idempotencyKey }) {
  const uid = Number(userId);
  const amount = parseMoney(body?.amount);
  const method = String(body?.method || '').toUpperCase();
  const payoutDetails = body?.payoutDetails || {};
  const note = body?.note ? String(body.note) : null;

  if (!amount || amount <= 0) {
    const err = new Error('Invalid amount');
    err.statusCode = 400;
    throw err;
  }
  if (!method) {
    const err = new Error('Invalid method');
    err.statusCode = 400;
    throw err;
  }

  const wallet = await getMyWallet({ userId: uid });

  // Idempotency: if client retries the same request, return the already-created request.
  // We store the key on the HOLD transaction reference as: idem:<key>
  const idemKey = idempotencyKey ? String(idempotencyKey).trim() : null;
  if (idemKey) {
    const existingHold = await prisma.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        reference: `idem:${idemKey}`,
        sourceType: 'WALLET_WITHDRAW_REQUEST',
      },
      orderBy: { id: 'desc' },
    });
    if (existingHold?.sourceId) {
      const existingReq = await prisma.walletWithdrawRequest.findUnique({ where: { id: existingHold.sourceId } });
      if (existingReq) return { request: existingReq, idempotent: true };
    }
  }

  return prisma.$transaction(async (tx) => {
    // Lock wallet row to prevent double-spend / race conditions (important under concurrency)
    await tx.$queryRaw`SELECT id FROM "user_wallets" WHERE id = ${wallet.id} FOR UPDATE`;

    const freshWallet = await tx.userWallet.findUnique({ where: { id: wallet.id } });
    const available = Number(freshWallet?.availableBalance ?? 0);
    if (available < amount) {
      const err = new Error('Insufficient available balance');
      err.statusCode = 400;
      throw err;
    }

    const req = await tx.walletWithdrawRequest.create({
      data: {
        walletId: wallet.id,
        userId: uid,
        amount,
        method,
        payoutDetailsJson: payoutCrypto.encryptJsonString(JSON.stringify(payoutDetails)),
        status: payout.canAutoQueue() ? 'QUEUED' : 'SUBMITTED',
        note,
      },
    });

    // Reserve (HOLD): available -> locked
    // We only move to pending when payout actually starts (PROCESSING).
    await tx.userWallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: { decrement: amount },
        lockedBalance: { increment: amount },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        status: 'PENDING',
        amount,
        method,
        reference: idemKey ? `idem:${idemKey}` : null,
        sourceType: 'WALLET_WITHDRAW_REQUEST',
        sourceId: req.id,
        note: note || 'Wallet withdraw request (reserved)',
      },
    });

    return { request: req, idempotent: false };
  });
}

async function listMyWithdrawRequests({ userId, limit = 20, cursor, status }) {
  const uid = Number(userId);
  const take = Math.min(parseIntSafe(limit, 20), 100);

  const where = { userId: uid };
  if (status) where.status = String(status).toUpperCase();

  const args = {
    where,
    take,
    orderBy: { id: 'desc' },
  };
  if (cursor) {
    args.skip = 1;
    args.cursor = { id: parseIntSafe(cursor) };
  }

  const itemsRaw = await prisma.walletWithdrawRequest.findMany(args);
  const items = itemsRaw.map((r) => {
    const plain = payoutCrypto.decryptToJson(r.payoutDetailsJson);
    return {
      ...r,
      payoutDetails: plain ?? payoutCrypto.maskEncrypted(),
    };
  });
  const nextCursor = items.length === take ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

async function getMyWithdrawRequest({ userId, id }) {
  const uid = Number(userId);
  const reqId = Number(id);
  const req = await prisma.walletWithdrawRequest.findFirst({
    where: { id: reqId, userId: uid },
  });
  if (!req) {
    const err = new Error('Withdraw request not found');
    err.statusCode = 404;
    throw err;
  }
  const plain = payoutCrypto.decryptToJson(req.payoutDetailsJson);
  return { ...req, payoutDetails: plain ?? payoutCrypto.maskEncrypted() };
}


async function cancelWithdrawRequest({ userId, id }) {
  const uid = Number(userId);
  const reqId = Number(id);

  const req = await prisma.walletWithdrawRequest.findFirst({
    where: { id: reqId, userId: uid },
  });
  if (!req) {
    const err = new Error('Withdraw request not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['SUBMITTED', 'UNDER_REVIEW', 'QUEUED'].includes(req.status)) {
    const err = new Error('Cannot cancel this request');
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.walletWithdrawRequest.update({
      where: { id: reqId },
      data: { status: 'CANCELED' },
    });

    await tx.userWallet.update({
      where: { id: req.walletId },
      data: {
        lockedBalance: { decrement: req.amount },
        availableBalance: { increment: req.amount },
      },
    });

    await tx.walletTransaction.updateMany({
      where: {
        walletId: req.walletId,
        sourceType: 'WALLET_WITHDRAW_REQUEST',
        sourceId: reqId,
        type: 'DEBIT',
        status: 'PENDING',
      },
      data: {
        status: 'FAILED',
        note: 'Canceled by user',
      },
    });

    return { request: updated };
  });
}

// -----------------------------
// Admin (V2)
// -----------------------------

async function adminListWithdrawRequests({ query }) {
  const take = Math.min(parseIntSafe(query.limit, 50), 200);
  const status = query.status ? String(query.status).toUpperCase() : undefined;

  const where = {};
  if (status) where.status = status;

  const itemsRaw = await prisma.walletWithdrawRequest.findMany({
    where,
    take,
    orderBy: { id: 'desc' },
  });

  // Admin can view decrypted payout details if key is configured.
  return itemsRaw.map((r) => {
    const plain = payoutCrypto.decryptToJson(r.payoutDetailsJson);
    return { ...r, payoutDetails: plain ?? payoutCrypto.maskEncrypted() };
  });
}

async function adminUpdateWithdrawStatus({ adminUserId, id, body }) {
  const reqId = Number(id);
  const nextStatus = String(body?.status || '').toUpperCase();
  const note = body?.note ? String(body.note) : null;
  const reference = body?.reference ? String(body.reference) : null;

  if (!nextStatus) {
    const err = new Error('Status is required');
    err.statusCode = 400;
    throw err;
  }

  const req = await prisma.walletWithdrawRequest.findUnique({ where: { id: reqId } });
  if (!req) {
    const err = new Error('Withdraw request not found');
    err.statusCode = 404;
    throw err;
  }

  const allowed = ['UNDER_REVIEW', 'APPROVED', 'QUEUED', 'PROCESSING', 'TRANSFERRED', 'FAILED', 'REJECTED'];
  if (!allowed.includes(nextStatus)) {
    const err = new Error('Unsupported status');
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.walletWithdrawRequest.update({
      where: { id: reqId },
      data: {
        status: nextStatus,
        adminUserId: Number(adminUserId),
        reviewedAt: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(nextStatus) ? new Date() : req.reviewedAt,
        processedAt: nextStatus === 'TRANSFERRED' ? new Date() : req.processedAt,
        note: note ?? req.note,
      },
    });

    // Move funds between wallet buckets based on lifecycle.
    // Rule:
    // - On create: available -> locked (reserve)
    // - On PROCESSING: locked -> pending
    // - On TRANSFERRED: pending -> paid out (balance decreases)
    // - On FAILED/REJECTED: release back to available (from pending if already processing, else from locked)

    if (nextStatus === 'PROCESSING' && req.status !== 'PROCESSING') {
      await tx.userWallet.update({
        where: { id: req.walletId },
        data: {
          lockedBalance: { decrement: req.amount },
          pendingBalance: { increment: req.amount },
        },
      });
    }

    if (nextStatus === 'TRANSFERRED') {
      await tx.userWallet.update({
        where: { id: req.walletId },
        data: {
          pendingBalance: { decrement: req.amount },
          balance: { decrement: req.amount },
        },
      });

      await tx.walletTransaction.updateMany({
        where: {
          walletId: req.walletId,
          sourceType: 'WALLET_WITHDRAW_REQUEST',
          sourceId: reqId,
          type: 'DEBIT',
        },
        data: {
          status: 'SUCCESS',
          reference: reference,
          note: note || 'Transferred',
        },
      });
    }

    if (nextStatus === 'FAILED') {
      const fromPending = ['PROCESSING', 'TRANSFERRED'].includes(req.status);
      await tx.userWallet.update({
        where: { id: req.walletId },
        data: fromPending
          ? {
              pendingBalance: { decrement: req.amount },
              availableBalance: { increment: req.amount },
            }
          : {
              lockedBalance: { decrement: req.amount },
              availableBalance: { increment: req.amount },
            },
      });

      await tx.walletTransaction.updateMany({
        where: {
          walletId: req.walletId,
          sourceType: 'WALLET_WITHDRAW_REQUEST',
          sourceId: reqId,
          type: 'DEBIT',
        },
        data: {
          status: 'FAILED',
          note: note || 'Failed',
        },
      });
    }

    if (nextStatus === 'REJECTED') {
      const fromPending = ['PROCESSING', 'TRANSFERRED'].includes(req.status);
      await tx.userWallet.update({
        where: { id: req.walletId },
        data: fromPending
          ? {
              pendingBalance: { decrement: req.amount },
              availableBalance: { increment: req.amount },
            }
          : {
              lockedBalance: { decrement: req.amount },
              availableBalance: { increment: req.amount },
            },
      });

      await tx.walletTransaction.updateMany({
        where: {
          walletId: req.walletId,
          sourceType: 'WALLET_WITHDRAW_REQUEST',
          sourceId: reqId,
          type: 'DEBIT',
        },
        data: {
          status: 'FAILED',
          note: note || 'Rejected',
        },
      });
    }

    return { request: updated };
  });
}


// -----------------------------
// Session-3: Automation helpers
// -----------------------------

async function adminApproveAndQueue({ adminUserId, id, note }) {
  const reqId = Number(id);
  const req = await prisma.walletWithdrawRequest.findUnique({ where: { id: reqId } });
  if (!req) {
    const err = new Error('Withdraw request not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(req.status)) {
    const err = new Error('Request cannot be queued from current status');
    err.statusCode = 400;
    throw err;
  }

  const updated = await prisma.walletWithdrawRequest.update({
    where: { id: reqId },
    data: {
      status: 'QUEUED',
      adminUserId: Number(adminUserId),
      reviewedAt: new Date(),
      note: note ?? req.note,
    },
  });
  return { request: updated };
}

async function adminPayNow({ adminUserId, id }) {
  // Semi-auto trigger: queue then immediately start payout
  await adminApproveAndQueue({ adminUserId, id });
  const updated = await payout.startPayoutForRequest({ withdrawRequestId: Number(id) });
  return { request: updated };
}

async function adminRetryPayout({ adminUserId, id }) {
  const reqId = Number(id);
  const req = await prisma.walletWithdrawRequest.findUnique({ where: { id: reqId } });
  if (!req) {
    const err = new Error('Withdraw request not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['FAILED', 'QUEUED', 'PROCESSING'].includes(req.status)) {
    const err = new Error('Retry is only allowed for FAILED/QUEUED/PROCESSING');
    err.statusCode = 400;
    throw err;
  }

  // If FAILED, it was already released back to available in finalizeFailure; user/admin may want to re-reserve.
  // For simplicity, admin can re-queue only (no auto reserve). If you want to re-reserve, create a new request.
  const updated = await prisma.walletWithdrawRequest.update({
    where: { id: reqId },
    data: {
      status: 'QUEUED',
      adminUserId: Number(adminUserId),
      nextRetryAt: null,
    },
  });

  return { request: updated };
}

async function adminRunPayoutWorkerOnce() {
  const q = await payout.processQueueOnce();
  const r = await payout.reconcileProcessingOnce();
  return { queue: q, reconcile: r, mode: payout.PAYOUT_MODE };
}

module.exports = {
  getMyWallet,
  listMyTransactions,

  createWithdrawRequest,
  listMyWithdrawRequests,
  getMyWithdrawRequest,
  cancelWithdrawRequest,

  adminListWithdrawRequests,
  adminUpdateWithdrawStatus,
  adminApproveAndQueue,
  adminPayNow,
  adminRetryPayout,
  adminRunPayoutWorkerOnce,
};
