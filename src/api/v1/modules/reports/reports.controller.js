const prisma = require("../../../../infrastructure/db/prismaClient");

// Reason catalogs (server source of truth)
const REASONS = {
  POST: [
    { code: "SPAM", label: "Spam" },
    { code: "INAPPROPRIATE", label: "Inappropriate content" },
    { code: "ANIMAL_ABUSE", label: "Animal abuse" },
    { code: "FALSE_INFO", label: "False or misleading information" },
    { code: "HARASSMENT", label: "Harassment or hate" },
    { code: "OTHER", label: "Other" },
  ],
  FUNDRAISING: [
    { code: "FRAUD", label: "Fraud / scam" },
    { code: "MISLEADING", label: "Misleading fundraising details" },
    { code: "DUPLICATE", label: "Duplicate campaign" },
    { code: "IMPROPER_USE", label: "Suspicious use of funds" },
    { code: "INAPPROPRIATE", label: "Inappropriate content" },
    { code: "OTHER", label: "Other" },
  ],
  USER: [
    { code: "IMPERSONATION", label: "Impersonation" },
    { code: "HARASSMENT", label: "Harassment or hate" },
    { code: "SPAM", label: "Spam" },
    { code: "SCAM", label: "Scam or suspicious behavior" },
    { code: "OTHER", label: "Other" },
  ],
  PET: [
    { code: "FAKE_PROFILE", label: "Fake pet profile" },
    { code: "WRONG_INFO", label: "Wrong or misleading information" },
    { code: "ABUSE", label: "Animal abuse / cruelty" },
    { code: "SPAM", label: "Spam" },
    { code: "OTHER", label: "Other" },
  ],
};

// GET /api/v1/reports/reasons?type=POST|FUNDRAISING|USER|PET
exports.getReasons = async (req, res) => {
  const type = String(req.query.type || "POST").toUpperCase();
  const list = REASONS[type];
  if (!list) {
    return res.status(400).json({
      success: false,
      message: "Invalid report type",
    });
  }
  return res.status(200).json({ success: true, data: { type, reasons: list } });
};

// POST /api/v1/reports
// Body: { type: "POST"|"FUNDRAISING"|"USER"|"PET", targetId: number, reasonCode: string, details?: string }
exports.createReport = async (req, res) => {
  try {
    const reporterId = req.user?.id;
    const type = String(req.body.type || "").toUpperCase();
    const targetId = Number(req.body.targetId);
    const reasonCode = String(req.body.reasonCode || "").toUpperCase();
    const details = req.body.details ? String(req.body.details).trim() : null;

    if (!reporterId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!REASONS[type] || !Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid type or targetId" });
    }
    const allowed = REASONS[type].some((r) => r.code === reasonCode);
    if (!allowed) {
      return res.status(400).json({ success: false, message: "Invalid reasonCode" });
    }

    // Validate target existence (best-effort)
    if (type === "POST") {
      const exists = await prisma.post.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!exists) return res.status(404).json({ success: false, message: "Post not found" });
    }
    if (type === "FUNDRAISING") {
      const exists = await prisma.fundraisingCampaign.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!exists) return res.status(404).json({ success: false, message: "Campaign not found" });
    }
    if (type === "USER") {
      const exists = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!exists) return res.status(404).json({ success: false, message: "User not found" });
    }
    if (type === "PET") {
      const exists = await prisma.pet.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!exists) return res.status(404).json({ success: false, message: "Pet not found" });
    }

    const report = await prisma.report.create({
      data: {
        type,
        targetId,
        reporterId,
        reasonCode,
        details,
      },
      select: { id: true, type: true, targetId: true, reasonCode: true, createdAt: true },
    });

    return res.status(201).json({ success: true, data: report });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Failed to submit report" });
  }
};
