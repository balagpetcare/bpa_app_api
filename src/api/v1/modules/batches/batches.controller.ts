const service = require("./batches.service");

exports.createBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const data = await service.createBatch({
      productVersionId: req.body.productVersionId,
      factoryId: req.body.factoryId,
      lineId: req.body.lineId,
      requestedQty: req.body.requestedQty,
      mfgDate: req.body.mfgDate,
      expDate: req.body.expDate,
      createdByUserId: userId,
    });

    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create batch" });
  }
};

exports.approveBatch = async (req, res) => {
  try {
    const data = await service.approveBatch({
      batchId: req.params.id,
      approvedQty: req.body.approvedQty,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to approve batch" });
  }
};

exports.issueSerials = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const data = await service.issueSerials({
      batchId: req.params.id,
      qty: req.body.qty,
      issuedByUserId: userId,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to issue serials" });
  }
};

exports.listBatches = async (req, res) => {
  try {
    const data = await service.listBatches({
      status: req.query.status,
      productVersionId: req.query.productVersionId,
      factoryId: req.query.factoryId,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list batches" });
  }
};

module.exports = {
  createBatch: exports.createBatch,
  approveBatch: exports.approveBatch,
  issueSerials: exports.issueSerials,
  listBatches: exports.listBatches,
};

export {};
