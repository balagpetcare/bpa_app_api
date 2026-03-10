/**
 * Vet reference API: countries, regulatory bodies, required doc types.
 * Public endpoints (no auth) for doctor verification form and admin panel.
 */
const vetReferenceService = require("./vetReference.service");

exports.listCountries = async (req: any, res: any) => {
  try {
    const rows = await vetReferenceService.listCountries();
    return res.status(200).json({ success: true, data: rows });
  } catch (e) {
    console.error("[vetReference.listCountries]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list countries" });
  }
};

exports.getBodiesByCountryCode = async (req: any, res: any) => {
  try {
    const code = req.params.code;
    if (!code) {
      return res.status(400).json({ success: false, message: "Country code required" });
    }
    const rows = await vetReferenceService.getBodiesByCountryCode(code);
    return res.status(200).json({ success: true, data: rows });
  } catch (e) {
    console.error("[vetReference.getBodiesByCountryCode]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list bodies" });
  }
};

exports.getDocTypesByBodyId = async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid body id" });
    }
    const rows = await vetReferenceService.getDocTypesByBodyId(id);
    return res.status(200).json({ success: true, data: rows });
  } catch (e) {
    console.error("[vetReference.getDocTypesByBodyId]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list doc types" });
  }
};

exports.getBodyById = async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid body id" });
    }
    const body = await vetReferenceService.getBodyById(id);
    if (!body) {
      return res.status(404).json({ success: false, message: "Regulatory body not found" });
    }
    return res.status(200).json({ success: true, data: body });
  } catch (e) {
    console.error("[vetReference.getBodyById]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get body" });
  }
};
