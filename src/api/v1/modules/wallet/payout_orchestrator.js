const prisma = require('../../../../infrastructure/db/prismaClient');
const { getProviderAdapter } = require('../../../../integrations/payout/providers');

const PAYOUT_MODE = (process.env.WALLET_PAYOUT_MODE || 'semi').toLowerCase(); // 'auto' or 'semi'
const MAX_ATTEMPTS = Number(process.env.WALLET_PAYOUT_MAX_ATTEMPTS || 5);
const RETRY_DELAY_SECONDS = Number(process.env.WALLET_PAYOUT_RETRY_DELAY_SECONDS || 300);

/**
 * Decide provider from PaymentMethod
 */
function providerFromMethod(method) {
  const m = String(method || '').toUpperCase();
  if (m === 'BKASH') return 'BKASH';
  if (m === 'NAGAD') return 'NAGAD';
  if (m === 'ROCKET') return 'ROCKET';
  // fallback: treat unknown as BKASH (but safer to throw)
  const err = new Error('Unsupported payout method');
  err.statusCode = 400;
  throw err;
}

function canAutoQueue() {
  return PAYOUT_MODE === 'auto';
}

function nextRetryAt(attemptCount) {
  const base = RETRY_DELAY_SECONDS * 1000;
  const jitter = Math.floor(Math.random() * 10000);
  return new Date(Date.now() + base + jitter + attemptCount * 2000);
}

async function enqueueIfAuto({ withdrawRequestId }) {
  if (!canAutoQueue()) return null;
  return prisma.walletWithdrawRequest.update({
    where: { id: withdrawRequestId },
    data: { status: 'QUEUED' },
  });
}

async function startPayoutForRequest({ withdrawRequestId }) {
  const req = await prisma.walletWithdrawRequest.findUnique({ where: { id: withdrawRequestId } });
  if (!req) throw Object.assign(new Error('Withdraw request not found'), { statusCode: 404 });

  if (!['QUEUED', 'APPROVED'].includes(req.status)) {
    throw Object.assign(new Error('Request is not ready for payout'), { statusCode: 400 });
  }
  if (req.attemptCount >= MAX_ATTEMPTS) {
    throw Object.assign(new Error('Max payout attempts reached'), { statusCode: 400 });
  }

  const provider = providerFromMethod(req.method);
  const adapter = getProviderAdapter(provider);

  const destination = safeParseJson(req.payoutDetailsJson) || {};
  const idempotencyKey = `WR${req.id}`;

  const res = await adapter.createPayout({
    amount: Number(req.amount),
    destination,
    idempotencyKey,
    reference: `wallet-withdraw-${req.id}`,
  });

  return prisma.$transaction(async (tx) => {
    // Move reserved funds to pending when payout actually starts.
    // Reserve was created at request time: available -> locked.
    await tx.userWallet.update({
      where: { id: req.walletId },
      data: {
        lockedBalance: { decrement: req.amount },
        pendingBalance: { increment: req.amount },
      },
    });

    const updated = await tx.walletWithdrawRequest.update({
      where: { id: req.id },
      data: {
        provider,
        providerPayoutId: res.providerPayoutId,
        providerStatus: res.providerStatus,
        providerResponseJson: JSON.stringify(res.raw),
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        processingStartedAt: req.processingStartedAt || new Date(),
        nextRetryAt: null,
      },
    });

    // update ledger note (keep DEBIT PENDING)
    await tx.walletTransaction.updateMany({
      where: {
        walletId: req.walletId,
        sourceType: 'WALLET_WITHDRAW_REQUEST',
        sourceId: req.id,
        type: 'DEBIT',
      },
      data: {
        note: `Payout initiated (${provider})`,
      },
    });

    return updated;
  });
}

async function finalizeSuccess({ withdrawRequestId, providerStatus, raw, reference }) {
  const req = await prisma.walletWithdrawRequest.findUnique({ where: { id: withdrawRequestId } });
  if (!req) return null;
  if (req.status === 'TRANSFERRED') return req;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.walletWithdrawRequest.update({
      where: { id: req.id },
      data: {
        status: 'TRANSFERRED',
        providerStatus: providerStatus || req.providerStatus,
        providerResponseJson: raw ? JSON.stringify(raw) : req.providerResponseJson,
        processedAt: new Date(),
        completedAt: new Date(),
      },
    });

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
        sourceId: req.id,
        type: 'DEBIT',
      },
      data: {
        status: 'SUCCESS',
        reference: reference || req.providerPayoutId || null,
        note: 'Payout transferred',
      },
    });

    return updated;
  });
}

async function finalizeFailure({ withdrawRequestId, providerStatus, raw, failureCode, failureMessage }) {
  const req = await prisma.walletWithdrawRequest.findUnique({ where: { id: withdrawRequestId } });
  if (!req) return null;
  if (['FAILED', 'REJECTED', 'CANCELED'].includes(req.status)) return req;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.walletWithdrawRequest.update({
      where: { id: req.id },
      data: {
        status: 'FAILED',
        providerStatus: providerStatus || req.providerStatus,
        providerResponseJson: raw ? JSON.stringify(raw) : req.providerResponseJson,
        failureCode: failureCode || req.failureCode,
        failureMessage: failureMessage || req.failureMessage,
        completedAt: new Date(),
        nextRetryAt: nextRetryAt(req.attemptCount),
      },
    });

    // release pending back to available (user can retry or admin)
    await tx.userWallet.update({
      where: { id: req.walletId },
      data: {
        pendingBalance: { decrement: req.amount },
        availableBalance: { increment: req.amount },
      },
    });

    await tx.walletTransaction.updateMany({
      where: {
        walletId: req.walletId,
        sourceType: 'WALLET_WITHDRAW_REQUEST',
        sourceId: req.id,
        type: 'DEBIT',
      },
      data: {
        status: 'FAILED',
        note: failureMessage || 'Payout failed',
      },
    });

    return updated;
  });
}

async function processQueueOnce({ take = 20 } = {}) {
  const now = new Date();
  const queued = await prisma.walletWithdrawRequest.findMany({
    where: { status: 'QUEUED' },
    orderBy: { id: 'asc' },
    take,
  });

  const results = [];
  for (const req of queued) {
    try {
      const updated = await startPayoutForRequest({ withdrawRequestId: req.id });
      results.push({ id: req.id, status: updated.status });
    } catch (e) {
      results.push({ id: req.id, error: e.message });
    }
  }
  return { processed: results.length, results };
}

async function reconcileProcessingOnce({ take = 30 } = {}) {
  const processing = await prisma.walletWithdrawRequest.findMany({
    where: { status: 'PROCESSING' },
    orderBy: { id: 'asc' },
    take,
  });

  const results = [];
  for (const req of processing) {
    try {
      if (!req.provider || !req.providerPayoutId) continue;
      const adapter = getProviderAdapter(req.provider);
      const q = await adapter.queryPayout(req.providerPayoutId);
      if (q.isFinal && q.isSuccess) {
        await finalizeSuccess({ withdrawRequestId: req.id, providerStatus: q.providerStatus, raw: q.raw, reference: req.providerPayoutId });
        results.push({ id: req.id, status: 'TRANSFERRED' });
      } else if (q.isFinal && !q.isSuccess) {
        await finalizeFailure({ withdrawRequestId: req.id, providerStatus: q.providerStatus, raw: q.raw, failureCode: q.failureCode, failureMessage: q.failureMessage });
        results.push({ id: req.id, status: 'FAILED' });
      } else {
        // still processing
        await prisma.walletWithdrawRequest.update({
          where: { id: req.id },
          data: { providerStatus: q.providerStatus, providerResponseJson: JSON.stringify(q.raw) },
        });
        results.push({ id: req.id, status: 'PROCESSING' });
      }
    } catch (e) {
      results.push({ id: req.id, error: e.message });
    }
  }
  return { processed: results.length, results };
}

async function handleWebhook({ provider, headers, body, rawBody }) {
  const adapter = getProviderAdapter(provider);
  const signatureValid = adapter.verifyWebhookSignature({ headers, body, rawBody });

  // Optional strict mode: reject unsigned/invalid webhooks (recommended in production).
  const sigRequired = String(process.env.WEBHOOK_SIGNATURE_REQUIRED || 'false').toLowerCase() === 'true';

  // Persist event log (best effort)
  const providerEventId = body?.eventId || body?.id || null;
  const providerPayoutId = body?.providerPayoutId || body?.trxId || body?.transactionId || null;
  const status = String(body?.status || '').toUpperCase();

  const wr = providerPayoutId
    ? await prisma.walletWithdrawRequest.findFirst({ where: { provider, providerPayoutId } })
    : null;

  // Deduplicate webhook events best-effort (prevents bot/replay spam & double-processing).
  // Ideally backed by a DB unique constraint, but we keep it safe even without migrations.
  if (providerEventId) {
    const exists = await prisma.payoutEventLog.findFirst({
      where: { provider, providerEventId },
      select: { id: true },
    });
    if (!exists) {
      await prisma.payoutEventLog.create({
        data: {
          provider,
          providerEventId,
          providerPayoutId,
          withdrawRequestId: wr ? wr.id : null,
          payloadJson: JSON.stringify(body || {}),
          signatureValid,
        },
      });
    }
  } else {
    await prisma.payoutEventLog.create({
      data: {
        provider,
        providerEventId,
        providerPayoutId,
        withdrawRequestId: wr ? wr.id : null,
        payloadJson: JSON.stringify(body || {}),
        signatureValid,
      },
    });
  }

  if (sigRequired && !signatureValid) {
    const err = new Error('Invalid webhook signature');
    err.statusCode = 401;
    throw err;
  }

  if (!wr) return { ok: true, matched: false };

  if (status === 'TRANSFERRED' || status === 'SUCCESS') {
    await finalizeSuccess({ withdrawRequestId: wr.id, providerStatus: status, raw: body, reference: providerPayoutId });
    return { ok: true, matched: true, status: 'TRANSFERRED' };
  }
  if (status === 'FAILED' || status === 'FAIL') {
    await finalizeFailure({ withdrawRequestId: wr.id, providerStatus: status, raw: body, failureMessage: 'Webhook indicates failure' });
    return { ok: true, matched: true, status: 'FAILED' };
  }

  // Non-final status update
  await prisma.walletWithdrawRequest.update({
    where: { id: wr.id },
    data: { providerStatus: status || wr.providerStatus, providerResponseJson: JSON.stringify(body || {}) },
  });

  return { ok: true, matched: true, status: 'PROCESSING' };
}

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

module.exports = {
  PAYOUT_MODE,
  canAutoQueue,
  enqueueIfAuto,
  processQueueOnce,
  reconcileProcessingOnce,
  startPayoutForRequest,
  finalizeSuccess,
  finalizeFailure,
  handleWebhook,
};
