const svc = require('./wallet.service');
const { logAdminAction } = require('../../../../infrastructure/audit/auditLogger');

async function me(req, res, next) {
  try {
    const userId = req.user?.id;
    const wallet = await svc.getMyWallet({ userId });
    return res.status(200).json({ success: true, data: wallet });
  } catch (e) {
    return next(e);
  }
}

async function transactions(req, res, next) {
  try {
    const userId = req.user?.id;
    const { limit, cursor, type, status, sourceType } = req.query || {};
    const data = await svc.listMyTransactions({
      userId,
      limit,
      cursor,
      type,
      status,
      sourceType,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

async function createWithdrawRequest(req, res, next) {
  try {
    const userId = req.user?.id;
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
    const data = await svc.createWithdrawRequest({ userId, body: req.body, idempotencyKey });
    return res.status(201).json({
      success: true,
      message: 'Withdraw request submitted',
      data,
    });
  } catch (e) {
    return next(e);
  }
}

async function listMyWithdrawRequests(req, res, next) {
  try {
    const userId = req.user?.id;
    const { limit, cursor, status } = req.query || {};
    const data = await svc.listMyWithdrawRequests({ userId, limit, cursor, status });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

async function getMyWithdrawRequest(req, res, next) {
  try {
    const userId = req.user?.id;
    const id = req.params?.id;
    const data = await svc.getMyWithdrawRequest({ userId, id });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

async function cancelWithdrawRequest(req, res, next) {
  try {
    const userId = req.user?.id;
    const id = req.params?.id;
    const data = await svc.cancelWithdrawRequest({ userId, id });
    return res.status(200).json({ success: true, message: 'Withdraw request canceled', data });
  } catch (e) {
    return next(e);
  }
}

// Admin
async function adminListWithdrawRequests(req, res, next) {
  try {
    const data = await svc.adminListWithdrawRequests({ query: req.query || {} });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

async function adminUpdateWithdrawStatus(req, res, next) {
  try {
    const adminUserId = req.user?.id;
    const id = req.params?.id;
    logAdminAction({ req, action: 'WALLET_WITHDRAW_STATUS_UPDATE', targetType: 'WalletWithdrawRequest', targetId: id, meta: { status: req.body?.status } });
    const data = await svc.adminUpdateWithdrawStatus({ adminUserId, id, body: req.body });
    return res.status(200).json({ success: true, message: 'Withdraw request updated', data });
  } catch (e) {
    return next(e);
  }
}


async function adminApproveAndQueue(req, res, next) {
  try {
    const adminUserId = req.user?.id;
    const id = req.params?.id;
    logAdminAction({ req, action: 'WALLET_WITHDRAW_APPROVE_AND_QUEUE', targetType: 'WalletWithdrawRequest', targetId: id, meta: { note: req.body?.note || null } });
    const data = await svc.adminApproveAndQueue({ adminUserId, id, note: req.body?.note });
    return res.status(200).json({ success: true, message: 'Queued for payout', data });
  } catch (e) {
    return next(e);
  }
}

async function adminPayNow(req, res, next) {
  try {
    const adminUserId = req.user?.id;
    const id = req.params?.id;
    logAdminAction({ req, action: 'WALLET_WITHDRAW_PAY_NOW', targetType: 'WalletWithdrawRequest', targetId: id });
    const data = await svc.adminPayNow({ adminUserId, id });
    return res.status(200).json({ success: true, message: 'Payout initiated', data });
  } catch (e) {
    return next(e);
  }
}

async function adminRetryPayout(req, res, next) {
  try {
    const adminUserId = req.user?.id;
    const id = req.params?.id;
    logAdminAction({ req, action: 'WALLET_WITHDRAW_RETRY_PAYOUT', targetType: 'WalletWithdrawRequest', targetId: id });
    const data = await svc.adminRetryPayout({ adminUserId, id });
    return res.status(200).json({ success: true, message: 'Retry queued', data });
  } catch (e) {
    return next(e);
  }
}

async function adminRunPayoutWorkerOnce(req, res, next) {
  try {
    logAdminAction({ req, action: 'PAYOUT_WORKER_RUN_ONCE', targetType: 'PayoutWorker', targetId: 'once' });
    const data = await svc.adminRunPayoutWorkerOnce();
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  me,
  transactions,
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
