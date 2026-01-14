const prisma = require("../../../../infrastructure/db/prismaClient");

exports.listPartnerApps = async (req, res) => {
  try {
    const status = (req.query.status || "PENDING_REVIEW").toString();
    const rows = await prisma.partnerApplication.findMany({
      where: { status },
      orderBy: { id: "desc" },
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.approvePartnerApp = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = req.body?.note ? String(req.body.note) : null;
    const adminId = Number(req.user?.id);

    const row = await prisma.partnerApplication.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewNote: note,
        reviewedByAdminId: adminId,
      },
    });

    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.rejectPartnerApp = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = req.body?.note ? String(req.body.note) : "Rejected";
    const adminId = Number(req.user?.id);

    const row = await prisma.partnerApplication.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewNote: note,
        reviewedByAdminId: adminId,
      },
    });

    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.listPublishRequests = async (req, res) => {
  try {
    const status = (req.query.status || "PENDING").toString();
    const rows = await prisma.branchPublishRequest.findMany({
      where: { status },
      orderBy: { id: "desc" },
      include: { branch: true },
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.approvePublishRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminId = Number(req.user?.id);
    const note = req.body?.note ? String(req.body.note) : null;
    const features = req.body?.features || {};

    const pr = await prisma.branchPublishRequest.findUnique({
      where: { id },
      include: { branch: true },
    });
    if (!pr) return res.status(404).json({ success: false, message: "Publish request not found" });
    if (pr.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Already processed (${pr.status})` });
    }

    // Transaction: approve request + activate branch + unlock features
    const result = await prisma.$transaction(async (tx) => {
      const updatedReq = await tx.branchPublishRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
          note,
        },
      });

      const mergedFeatures = { ...(pr.branch.featuresJson || {}), ...(features || {}) };

      const updatedBranch = await tx.branch.update({
        where: { id: pr.branchId },
        data: {
          status: "ACTIVE",
          featuresJson: mergedFeatures,
          verificationStatus: "VERIFIED",
        },
      });

      return { updatedReq, updatedBranch };
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.rejectPublishRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminId = Number(req.user?.id);
    const note = req.body?.note ? String(req.body.note) : "Changes required";

    const pr = await prisma.branchPublishRequest.findUnique({ where: { id } });
    if (!pr) return res.status(404).json({ success: false, message: "Publish request not found" });
    if (pr.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Already processed (${pr.status})` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedReq = await tx.branchPublishRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
          note,
        },
      });

      // Put branch back to DRAFT so owner can edit + resubmit
      const updatedBranch = await tx.branch.update({
        where: { id: pr.branchId },
        data: {
          status: "DRAFT",
        },
      });

      return { updatedReq, updatedBranch };
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
