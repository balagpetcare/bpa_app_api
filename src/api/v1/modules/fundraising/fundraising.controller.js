const service = require('./fundraising.service');

exports.getFeed = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = await service.getFeed({
      userId,
      limit: req.query.limit,
      cursor: req.query.cursor,
      verified: req.query.verified,
      sort: req.query.sort,
    });

    return res.status(200).json({ success: true, data });
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
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('fundraising.getCampaign error:', e);
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
      deadline: req.body.deadline,
      mediaIds: req.body.mediaIds,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const status = e.statusCode || 500;
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
      deadline: req.body.deadline,
      status: req.body.status,
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    const status = e.statusCode || 500;
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
    const status = e.statusCode || 500;
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
    const status = e.statusCode || 500;
    console.error('fundraising.donate error:', e);
    return res.status(status).json({ success: false, message: e.message || 'Failed' });
  }
};
