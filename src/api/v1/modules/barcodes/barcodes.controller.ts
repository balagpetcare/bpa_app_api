const prisma = require("../../../../infrastructure/db/prismaClient");
const service = require("./barcodes.service");

exports.resolve = async (req, res) => {
  try {
    const branchId = req.barcodeBranchId;
    const code = String(req.query?.code || "").trim();
    if (!code) {
      return res.status(400).json({ success: false, message: "code query parameter is required" });
    }
    const { resolvePosProductByBarcode } = require("./barcodeResolve.service");
    const data = await resolvePosProductByBarcode(branchId, code);
    if (!data) {
      return res.status(404).json({ success: false, message: "No match for barcode in this branch context" });
    }
    return res.json({ success: true, data });
  } catch (e) {
    console.error("barcodes.resolve", e);
    return res.status(500).json({ success: false, message: e?.message || "Resolve failed" });
  }
};

exports.getProductLabel = async (req, res) => {
  try {
    const orgId = req.barcodeOrgId;
    const branchId = req.barcodeBranchId;
    const variantId = parseInt(req.params?.variantId, 10);
    if (!variantId) {
      return res.status(400).json({ success: false, message: "Invalid variant ID" });
    }
    const data = await service.getProductLabelDto(variantId, branchId, orgId);
    return res.json({ success: true, data });
  } catch (e) {
    const code = e?.code;
    const status = code === "NOT_FOUND" ? 404 : 500;
    console.error("barcodes.getProductLabel", e);
    return res.status(status).json({ success: false, message: e?.message || "Failed to load label" });
  }
};

exports.getBatchLabel = async (req, res) => {
  try {
    const orgId = req.barcodeOrgId;
    const branchId = req.barcodeBranchId;
    const lotId = parseInt(req.params?.lotId, 10);
    if (!lotId) {
      return res.status(400).json({ success: false, message: "Invalid batch/lot ID" });
    }
    const data = await service.getBatchLabelDto(lotId, branchId, orgId);
    return res.json({ success: true, data });
  } catch (e) {
    const code = e?.code;
    const status = code === "NOT_FOUND" ? 404 : 500;
    console.error("barcodes.getBatchLabel", e);
    return res.status(status).json({ success: false, message: e?.message || "Failed to load label" });
  }
};

exports.bulkLabels = async (req, res) => {
  try {
    const orgId = req.barcodeOrgId;
    const branchId = Number(req.body?.branchId ?? req.barcodeBranchId);
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, orgId },
      select: { id: true },
    });
    if (!branch) {
      return res.status(400).json({ success: false, message: "Invalid branchId for this organization" });
    }
    const data = await service.bulkLabels({ ...req.body, branchId }, orgId);
    return res.json({ success: true, data });
  } catch (e) {
    const code = e?.code;
    const status =
      code === "NOT_FOUND" ? 404 : code === "VALIDATION" ? 400 : code === "CONFLICT" ? 409 : 500;
    console.error("barcodes.bulkLabels", e);
    return res.status(status).json({ success: false, message: e?.message || "Bulk labels failed" });
  }
};

exports.listBranchLots = async (req, res) => {
  try {
    const orgId = req.barcodeOrgId;
    const branchId = req.barcodeBranchId;
    const data = await service.listBranchLotsForLabels(orgId, branchId, {
      q: req.query?.q,
      stockGt0: req.query?.stockGt0,
      nearExpiry: req.query?.nearExpiry,
      expired: req.query?.expired,
      hasLabelBarcode: req.query?.hasLabelBarcode,
      missingLabelBarcode: req.query?.missingLabelBarcode,
    });
    return res.json({ success: true, data });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const status = code === "NOT_FOUND" ? 404 : 500;
    console.error("barcodes.listBranchLots", e);
    return res.status(status).json({ success: false, message: (e as Error)?.message || "Failed" });
  }
};

exports.listBranchVariants = async (req, res) => {
  try {
    const orgId = req.barcodeOrgId;
    const branchId = req.barcodeBranchId;
    const q = req.query?.q != null ? String(req.query.q) : "";
    const limit = parseInt(String(req.query?.limit || "50"), 10);
    const data = await service.listBranchVariantsForLabels(orgId, branchId, q, limit);
    return res.json({ success: true, data });
  } catch (e) {
    console.error("barcodes.listBranchVariants", e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Failed" });
  }
};

exports.patchLotLabelBarcode = async (req, res) => {
  try {
    const orgId = req.barcodeOrgId;
    const lotId = parseInt(req.params?.lotId, 10);
    if (!lotId) {
      return res.status(400).json({ success: false, message: "Invalid lot ID" });
    }
    const raw = req.body?.labelBarcode ?? req.body?.barcode;
    const data = await service.patchLotLabelBarcode(lotId, orgId, raw);
    return res.json({ success: true, data });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const status =
      code === "NOT_FOUND" ? 404 : code === "CONFLICT" ? 409 : code === "VALIDATION" ? 400 : 500;
    console.error("barcodes.patchLotLabelBarcode", e);
    return res.status(status).json({ success: false, message: (e as Error)?.message || "Update failed" });
  }
};

export {};
