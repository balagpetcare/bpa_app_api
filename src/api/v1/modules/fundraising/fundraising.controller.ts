const service = require('./fundraising.service');
const { logAdminAction } = require('../../../../infrastructure/audit/auditLogger');

function attachLast3Donors(c) {
  if (!c || !c.donations) return c;
  const last3Donors = (c.donations || []).slice(0, 3).map((d) => ({
    ...(d.donor || {}),
    amount: d.amount,
    createdAt: d.createdAt,
  }));
  return { ...c, last3Donors };
}

exports.getFeed = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.getFeed({
      userId,
      limit: req.query.limit,
      cursor: req.query.cursor,
      verified: req.query.verified,
      sort: req.query.sort,      category: req.query.category,      location: req.query.location,
    });

    return res.status(200).json({ success: true, data: (data || []).map(attachLast3Donors) });
  } catch (e) {
    console.error('fundraising.getFeed error:', e);
    return res.status(500).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.getCampaign = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.getCampaign({ id: req.params.id });
    return res.status(200).json({ success: true, data: attachLast3Donors(data) });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.getCampaign error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// Aggregated endpoint for the donation single page (campaign + post counts + last3 donations + updates preview)
exports.getCampaignSingle = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.getCampaignSingle({ id: req.params.id });
    // preserve existing shape for campaign while adding extra fields
    return res.status(200).json({ success: true, data: {
      campaign: attachLast3Donors(data.campaign),
      postCounts: data.postCounts,
      updates: data.updates,
    } });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.getCampaignSingle error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const created = await service.createCampaign({
      userId,
      title: req.body.title,
      caption: req.body.caption,
      targetAmount: req.body.targetAmount,
      deadline: req.body.deadline,      category: req.body.category,      locationText: req.body.locationText,
      mediaIds: req.body.mediaIds,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.createCampaign error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const updated = await service.updateCampaign({
      userId,
      id: req.params.id,
      title: req.body.title,
      caption: req.body.caption,
      targetAmount: req.body.targetAmount,
      deadline: req.body.deadline,      category: req.body.category,      locationText: req.body.locationText,
      status: req.body.status,
      mediaIds: req.body.mediaIds,
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.updateCampaign error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await service.deleteCampaign({ userId, id: req.params.id });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.deleteCampaign error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.donate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await service.donate({
      donorId: userId,
      campaignId: req.params.id,
      amount: req.body.amount,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.donate error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// ------------------------------
// Donations & Updates
// ------------------------------
exports.listDonations = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.listDonations({
      campaignId: req.params.id,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.listDonations error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.listUpdates = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.listUpdates({
      campaignId: req.params.id,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.listUpdates error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.createUpdate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const created = await service.createUpdate({
      userId,
      campaignId: req.params.id,
      caption: req.body.caption,
      mediaIds: req.body.mediaIds,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.createUpdate error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.updateUpdate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const updated = await service.updateUpdate({
      userId,
      id: req.params.id,
      caption: req.body.caption,
      mediaIds: req.body.mediaIds,
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.updateUpdate error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.deleteUpdate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await service.deleteUpdate({ userId, id: req.params.id });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.deleteUpdate error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// ------------------------------
// Fundraising Account Verification (Phase A)
// ------------------------------
exports.getMyAccount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.getMyAccount({ userId });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.getMyAccount error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.updateMyAccount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const data = await service.updateMyAccount({
      userId,
      accountType: req.body.accountType,
      permanentAddress: req.body.permanentAddress,
      presentAddress: req.body.presentAddress,
      occupation: req.body.occupation,
      area: req.body.area,
      divisionId: req.body.divisionId,
      districtId: req.body.districtId,
      upazilaId: req.body.upazilaId,
      areaId: req.body.areaId,
      dateOfBirth: req.body.dateOfBirth,
      nationalIdNumber: req.body.nationalIdNumber,
      birthRegNumber: req.body.birthRegNumber,
      studentIdNumber: req.body.studentIdNumber,
      rescueSinceYear: req.body.rescueSinceYear,
      orgName: req.body.orgName,
      orgDescription: req.body.orgDescription,
      orgWorkType: req.body.orgWorkType,
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error("fundraising.updateMyAccount error:", e);
    return res.status(status).json({ success: false, message: e.message || "Failed" });
  }
};


exports.addVerificationDocument = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const created = await service.addVerificationDocument({
      userId,
      title: req.body.title,
      mediaId: req.body.mediaId,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.addVerificationDocument error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.deleteVerificationDocument = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await service.deleteVerificationDocument({ userId, id: req.params.id });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.deleteVerificationDocument error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.submitAccount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await service.submitAccount({ userId });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.submitAccount error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// Admin
exports.adminListAccounts = async (req, res) => {
  try {
    const data = await service.adminListAccounts({ status: req.query.status });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.adminListAccounts error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.adminUpdateAccountStatus = async (req, res) => {
  try {
    const adminUserId = req.user?.id;
    logAdminAction({ req, action: 'FUNDRAISING_ACCOUNT_STATUS_UPDATE', targetType: 'FundraisingAccount', targetId: req.params.id, meta: { status: req.body?.status } });
    const data = await service.adminUpdateAccountStatus({
      adminUserId,
      accountId: req.params.id,
      status: req.body.status,
      note: req.body.note,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.adminUpdateAccountStatus error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// ------------------------------
// Payout Catalog + Methods
// ------------------------------
exports.listPayoutCatalog = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const data = await service.listPayoutCatalog({ activeOnly: req.query.all ? false : true });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.listPayoutCatalog error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// ------------------------------
// My Campaigns (for Unified Withdraw UI)
// ------------------------------
exports.listMyCampaigns = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const data = await service.listMyCampaigns({ userId });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.listMyCampaigns error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.listMyPayoutMethods = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const data = await service.listMyPayoutMethods({ userId });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.listMyPayoutMethods error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.createMyPayoutMethod = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const created = await service.createMyPayoutMethod({
      userId,
      catalogId: req.body.catalogId,
      label: req.body.label,
      detailsJson: req.body.detailsJson,
      isDefault: req.body.isDefault,
    });
    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.createMyPayoutMethod error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.updateMyPayoutMethod = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const updated = await service.updateMyPayoutMethod({
      userId,
      id: req.params.id,
      label: req.body.label,
      detailsJson: req.body.detailsJson,
      isDefault: req.body.isDefault,
      isActive: req.body.isActive,
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.updateMyPayoutMethod error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.deleteMyPayoutMethod = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await service.deleteMyPayoutMethod({ userId, id: req.params.id });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.deleteMyPayoutMethod error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// ------------------------------
// Withdraw Requests
// ------------------------------
exports.createWithdrawRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
    const created = await service.createWithdrawRequest({
      userId,
      campaignId: req.params.id,
      amount: req.body.amount,
      methodId: req.body.methodId,
      note: req.body.note,
      idempotencyKey,
    });
    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.createWithdrawRequest error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.listMyWithdrawRequests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const data = await service.listMyWithdrawRequests({
      userId,
      campaignId: req.query.campaignId,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.listMyWithdrawRequests error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

// Admin
exports.adminListWithdrawRequests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const data = await service.adminListWithdrawRequests({
      status: req.query.status,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.adminListWithdrawRequests error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.adminUpdateWithdrawRequestStatus = async (req, res) => {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    logAdminAction({ req, action: 'FUNDRAISING_WITHDRAW_STATUS_UPDATE', targetType: 'FundraisingWithdrawRequest', targetId: req.params.id, meta: { status: req.body?.status } });
    const updated = await service.adminUpdateWithdrawRequestStatus({
      adminUserId,
      id: req.params.id,
      status: req.body.status,
      note: req.body.note,
      reference: req.body.reference,
      proofMediaId: req.body.proofMediaId,
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    const status = (e as any)?.statusCode || 500;
    console.error('fundraising.adminUpdateWithdrawRequestStatus error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};

export {};
