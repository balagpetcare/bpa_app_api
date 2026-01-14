const prisma = require("../../../../infrastructure/db/prismaClient");

function pickJson(bodyVal, fallback) {
  if (bodyVal === undefined) return fallback;
  return bodyVal;
}

async function requireApprovedPartner(userId) {
  const app = await prisma.partnerApplication.findFirst({
    where: { userId: Number(userId) },
    orderBy: { id: "desc" },
    select: { status: true },
  });

  if (!app || app.status !== "APPROVED") {
    const msg = !app
      ? "Partner application required"
      : "Partner application not approved";
    const err = new Error(msg);
    err.statusCode = 403;
    throw err;
  }
}

// ------------------------------
// Compatibility helpers (Partner Next.js wizard)
// Draft is represented by PartnerStatus.NOT_APPLIED
// We keep legacy endpoints working.
// ------------------------------

function normalizeAppForWizard(app) {
  if (!app) return null;
  return {
    ...app,
    // UI expects orgName/contactPhone style fields
    orgName: app.businessName,
    contactPhone: app?.docsJson?.contactPhone || null,
    contactName: app?.docsJson?.contactName || null,
    contactEmail: app?.docsJson?.contactEmail || null,
    addressLine: app?.docsJson?.addressLine || null,
  };
}

function applyWizardPatch(existingDocsJson, body) {
  const docs = { ...(existingDocsJson || {}) };
  if (body.contactPhone !== undefined) docs.contactPhone = body.contactPhone;
  if (body.contactName !== undefined) docs.contactName = body.contactName;
  if (body.contactEmail !== undefined) docs.contactEmail = body.contactEmail;
  if (body.addressLine !== undefined) docs.addressLine = body.addressLine;
  return docs;
}

exports.createOrGetDraft = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    // Prefer the latest NOT_APPLIED draft, otherwise create one
    let app = await prisma.partnerApplication.findFirst({
      where: { userId, status: "NOT_APPLIED" },
      orderBy: { id: "desc" },
    });

    if (!app) {
      app = await prisma.partnerApplication.create({
        data: {
          userId,
          status: "NOT_APPLIED",
          // Required fields in schema; keep empty until submit
          businessName: "",
          nidNumber: "",
          tradeLicenseNo: null,
          docsJson: {},
        },
      });
    }

    return res.json(normalizeAppForWizard(app));
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.listMyApplications = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const rows = await prisma.partnerApplication.findMany({
      where: { userId },
      orderBy: { id: "desc" },
    });
    return res.json(rows.map(normalizeAppForWizard));
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.getApplicationById = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const id = Number(req.params.id);
    const row = await prisma.partnerApplication.findFirst({ where: { id, userId } });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json(normalizeAppForWizard(row));
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateDraft = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const id = Number(req.params.id);
    const body = req.body || {};

    const row = await prisma.partnerApplication.findFirst({ where: { id, userId } });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (row.status !== "NOT_APPLIED") {
      return res.status(400).json({ success: false, message: "Only draft can be updated" });
    }

    const updated = await prisma.partnerApplication.update({
      where: { id },
      data: {
        businessName: body.orgName ?? body.businessName ?? row.businessName,
        nidNumber: body.nidNumber ?? row.nidNumber,
        tradeLicenseNo: body.tradeLicenseNo ?? row.tradeLicenseNo,
        docsJson: applyWizardPatch(row.docsJson, body),
      },
    });

    return res.json(normalizeAppForWizard(updated));
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.submitDraft = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const id = Number(req.params.id);
    const row = await prisma.partnerApplication.findFirst({ where: { id, userId } });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (row.status !== "NOT_APPLIED") {
      return res.status(400).json({ success: false, message: "Only draft can be submitted" });
    }

    if (!row.businessName || !row.nidNumber) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: orgName/businessName and nidNumber",
      });
    }

    const updated = await prisma.partnerApplication.update({
      where: { id },
      data: {
        status: "PENDING_REVIEW",
        submittedAt: new Date(),
      },
    });

    return res.json(normalizeAppForWizard(updated));
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.submitApplication = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { businessName, nidNumber, tradeLicenseNo, docsJson } = req.body || {};

    if (!businessName || !nidNumber) {
      return res
        .status(400)
        .json({ success: false, message: "businessName and nidNumber are required" });
    }

    // If already has a pending/approved app, prevent duplicate spam
    const latest = await prisma.partnerApplication.findFirst({
      where: { userId },
      orderBy: { id: "desc" },
    });

    if (latest && ["PENDING_REVIEW", "APPROVED"].includes(latest.status)) {
      return res.status(400).json({
        success: false,
        message: "You already have an active application",
        data: latest,
      });
    }

    const row = await prisma.partnerApplication.create({
      data: {
        userId,
        status: "PENDING_REVIEW",
        businessName,
        nidNumber,
        tradeLicenseNo: tradeLicenseNo || null,
        docsJson: docsJson || null,
      },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.getMyApplication = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const row = await prisma.partnerApplication.findFirst({
      where: { userId },
      orderBy: { id: "desc" },
    });
    return res.json({ success: true, data: row || null });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.createOrganization = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    await requireApprovedPartner(userId);

    const { name, supportPhone, addressJson } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const org = await prisma.organization.create({
      data: {
        ownerUserId: userId,
        status: "APPROVED",
        name,
        supportPhone: supportPhone || null,
        addressJson: addressJson || null,
      },
    });

    return res.status(201).json({ success: true, data: org });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ success: false, message: e.message });
  }
};

exports.listMyOrganizations = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId: userId },
      orderBy: { id: "desc" },
    });
    return res.json({ success: true, data: orgs });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const orgId = Number(req.params.orgId);
    const { name, capabilitiesJson, addressJson } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    // org must belong to caller
    const org = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId } });
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const branch = await prisma.branch.create({
      data: {
        orgId,
        name,
        status: "DRAFT",
        capabilitiesJson: capabilitiesJson || {},
        featuresJson: {},
        addressJson: addressJson || null,
        verificationStatus: "UNSUBMITTED",
      },
    });

    return res.status(201).json({ success: true, data: branch });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const branchId = Number(req.params.branchId);
    const body = req.body || {};

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: { org: true },
    });

    if (!branch || branch.org?.ownerUserId !== userId) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    if (["PENDING_REVIEW", "ACTIVE"].includes(branch.status)) {
      // Keep it simple: restrict edits while under review or active (you can relax later)
      // Allowed fields could be whitelisted later.
    }

    const updated = await prisma.branch.update({
      where: { id: branchId },
      data: {
        name: body.name ?? undefined,
        addressJson: pickJson(body.addressJson, undefined),
        capabilitiesJson: pickJson(body.capabilitiesJson, undefined),
        verificationStatus: body.verificationStatus ?? undefined,
      },
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.submitPublishRequest = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const branchId = Number(req.params.branchId);

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, include: { org: true } });
    if (!branch || branch.org?.ownerUserId !== userId) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    if (branch.status !== "DRAFT") {
      return res.status(400).json({ success: false, message: `Branch is not in DRAFT (current: ${branch.status})` });
    }

    const reqRow = await prisma.branchPublishRequest.create({
      data: { branchId, status: "PENDING" },
    });

    await prisma.branch.update({
      where: { id: branchId },
      data: { status: "PENDING_REVIEW", verificationStatus: branch.verificationStatus === "UNSUBMITTED" ? "SUBMITTED" : branch.verificationStatus },
    });

    return res.status(201).json({ success: true, data: reqRow });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.getPublishStatus = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const branchId = Number(req.params.branchId);

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, include: { org: true } });
    if (!branch || branch.org?.ownerUserId !== userId) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    const latest = await prisma.branchPublishRequest.findFirst({
      where: { branchId },
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, data: { branch, publishRequest: latest || null } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
