/**
 * Phase 4: Ads – public serve + admin CRUD.
 */

const adsService = require("./ads.service");
const { writeAudit } = require("../../../../middlewares/auditWriter");

exports.serve = async (req, res) => {
  try {
    const countryCode = req.countryContext?.countryCode || "BD";
    const policy = req.countryContext?.policy || null;
    const list = await adsService.serve(countryCode, policy);
    return res.json({ success: true, data: list });
  } catch (e) {
    console.error("ads.serve error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.adminList = async (req, res) => {
  try {
    const countryId = req.query.countryId ? Number(req.query.countryId) : undefined;
    const status = req.query.status as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const result = await adsService.adminList({ countryId, status, limit, cursor });
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("ads.adminList error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.adminCreate = async (req, res) => {
  try {
    const ad = await adsService.adminCreate(req.body);
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "ADS_CREATE",
      entityType: "AD",
      entityId: ad.id,
      before: null,
      after: ad,
    });
    return res.status(201).json({ success: true, data: ad });
  } catch (e: any) {
    if (e.statusCode === 400) return res.status(400).json({ success: false, message: e.message });
    console.error("ads.adminCreate error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.adminUpdate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const ad = await adsService.adminUpdate(id, req.body);
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "ADS_UPDATE",
      entityType: "AD",
      entityId: ad.id,
      before: null,
      after: ad,
    });
    return res.json({ success: true, data: ad });
  } catch (e: any) {
    if (e.statusCode === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("ads.adminUpdate error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.adminDelete = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const result = await adsService.adminDelete(id);
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "ADS_DELETE",
      entityType: "AD",
      entityId: id,
      before: null,
      after: result,
    });
    return res.json({ success: true, data: result });
  } catch (e: any) {
    if (e.statusCode === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("ads.adminDelete error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
