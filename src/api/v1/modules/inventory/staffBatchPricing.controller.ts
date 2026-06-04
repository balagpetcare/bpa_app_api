const service = require("./staffBatchPricing.service");

exports.getShopBatches = async (req: { user?: { id?: number }; query: { branchId?: string } }, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = parseInt(String(req.query.branchId || ""), 10);
    if (!branchId) return res.status(400).json({ success: false, message: "branchId is required" });
    const data = await service.listShopBatchesForBranch(userId, branchId);
    return res.json({ success: true, data });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code;
    if (code === "FORBIDDEN") return res.status(403).json({ success: false, message: err.message });
    if (code === "NO_SHOP") return res.status(400).json({ success: false, message: err.message });
    console.error("getShopBatches error", e);
    return res.status(500).json({ success: false, message: err.message || "Failed" });
  }
};

exports.getShopBatchDetail = async (req: { user?: { id?: number }; query: { branchId?: string }; params: { lotId?: string } }, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = parseInt(String(req.query.branchId || ""), 10);
    if (!branchId) return res.status(400).json({ success: false, message: "branchId is required" });
    const lotId = parseInt(String(req.params.lotId || ""), 10);
    if (!lotId) return res.status(400).json({ success: false, message: "lotId is required" });
    const data = await service.getShopBatchDetailForBranch(userId, branchId, lotId);
    return res.json({ success: true, data });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code;
    if (code === "FORBIDDEN") return res.status(403).json({ success: false, message: err.message });
    if (code === "NO_SHOP" || code === "VALIDATION") return res.status(400).json({ success: false, message: err.message, code });
    if (code === "NOT_FOUND") return res.status(404).json({ success: false, message: err.message });
    console.error("getShopBatchDetail error", e);
    return res.status(500).json({ success: false, message: err.message || "Failed" });
  }
};

exports.patchShopBatch = async (req: { user?: { id?: number }; query: { branchId?: string }; body: any; params: { lotId?: string } }, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = parseInt(String(req.query.branchId || ""), 10);
    if (!branchId) return res.status(400).json({ success: false, message: "branchId is required" });
    const lotId = parseInt(String(req.params.lotId || ""), 10);
    if (!lotId) return res.status(400).json({ success: false, message: "lotId is required" });
    const data = await service.updateShopBatchForBranch(userId, branchId, lotId, {
      expDate: req.body?.expDate,
      sellPrice: req.body?.sellPrice,
      reason: req.body?.reason,
      sellsAtRulePrice: req.body?.sellsAtRulePrice,
    });
    return res.json({ success: true, data });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code;
    if (code === "FORBIDDEN") return res.status(403).json({ success: false, message: err.message });
    if (code === "VALIDATION" || code === "BOUNDS" || code === "NO_SHOP") {
      return res.status(400).json({ success: false, message: err.message, code });
    }
    if (code === "LOT_EXPIRED") return res.status(400).json({ success: false, message: err.message, code });
    if (code === "NOT_FOUND") return res.status(404).json({ success: false, message: err.message });
    console.error("patchShopBatch error", e);
    return res.status(500).json({ success: false, message: err.message || "Failed" });
  }
};

export {};
