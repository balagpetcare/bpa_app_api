const service = require("./factories.service");

exports.listFactories = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listFactories({ userId });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list factories" });
  }
};

exports.createFactory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.createFactory({
      userId,
      name: req.body.name,
      countryCode: req.body.countryCode,
      addressJson: req.body.addressJson,
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create factory" });
  }
};

exports.listLines = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listLines({ userId, factoryId: req.params.id });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list lines" });
  }
};

exports.createLine = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.createLine({
      userId,
      factoryId: req.params.id,
      lineCode: req.body.lineCode,
      deviceId: req.body.deviceId,
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create line" });
  }
};

module.exports = {
  listFactories: exports.listFactories,
  createFactory: exports.createFactory,
  listLines: exports.listLines,
  createLine: exports.createLine,
};

export {};
