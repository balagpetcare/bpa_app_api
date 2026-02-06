const service = require("./serials.service");

// GET /api/v1/serials/:sid/verify (public)
exports.verifySerial = async (req, res) => {
  try {
    const data = await service.verifySerial({ serialCode: req.params.sid });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to verify serial" });
  }
};

// POST /api/v1/serials/:sid/scan-event (authorized actors)
exports.createScanEvent = async (req, res) => {
  try {
    const data = await service.createScanEvent({
      serialCode: req.params.sid,
      actorRole: req.body.actorRole,
      action: req.body.action,
      countryCode: req.body.countryCode,
      deviceId: req.body.deviceId,
      metaJson: req.body.metaJson,
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to record scan event" });
  }
};

exports.listSerials = async (req, res) => {
  try {
    const data = await service.listSerials({
      batchId: req.query.batchId,
      status: req.query.status,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list serials" });
  }
};

exports.listScanEvents = async (req, res) => {
  try {
    const data = await service.listScanEvents({
      serialCode: req.query.serialCode,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list scan events" });
  }
};

exports.listFraudAlerts = async (req, res) => {
  try {
    const data = await service.listFraudAlerts({ sinceHours: req.query.hours || 24 });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list fraud alerts" });
  }
};

module.exports = {
  verifySerial: exports.verifySerial,
  createScanEvent: exports.createScanEvent,
  listSerials: exports.listSerials,
  listScanEvents: exports.listScanEvents,
  listFraudAlerts: exports.listFraudAlerts,
};

export {};
