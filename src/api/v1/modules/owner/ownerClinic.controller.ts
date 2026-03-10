/**
 * Owner Panel clinic routes: list clinic branches, settings, services, staff, rooms.
 */

const clinicService = require("./ownerClinic.service");
const { writeAudit: writeClinicAudit } = require("../../../../middlewares/auditWriter");

function getPrisma(req: any) {
  if (!req.prisma) throw new Error("Prisma instance not found on req.prisma");
  return req.prisma;
}

function getUserId(req: any): number | null {
  const v = req.user?.id ?? req.auth?.userId;
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

function asInt(param: string | undefined): number | null {
  if (param == null || param === "") return null;
  const n = parseInt(String(param), 10);
  return Number.isNaN(n) ? null : n;
}

// GET /api/v1/owner/clinic/branches
exports.listClinicBranches = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const data = await clinicService.listClinicBranches(prisma, userId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/clinic/network-stats
exports.getClinicNetworkStats = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const data = await clinicService.getClinicNetworkStats(prisma, userId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/dashboard-stats
exports.getClinicDashboardStats = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const data = await clinicService.getClinicDashboardStats(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/settings
exports.getClinicSettings = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const data = await clinicService.getClinicSettings(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// PUT /api/v1/owner/clinic/branches/:branchId/settings
exports.updateClinicSettings = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const data = await clinicService.updateClinicSettings(prisma, userId, branchId, body);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/modules/clinic — clinic module enabled flag
exports.getClinicModule = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const enabled = await clinicService.getClinicModuleEnabled(prisma, userId, branchId);
    if (enabled === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data: { clinicEnabled: enabled } });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// PATCH /api/v1/owner/clinic/branches/:branchId/modules/clinic — owner-only enable/disable clinic module
exports.updateClinicModule = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const enabled = req.body?.enabled;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (typeof enabled !== "boolean") return res.status(400).json({ success: false, message: "body.enabled (boolean) is required" });
    const data = await clinicService.setClinicModuleEnabled(prisma, userId, branchId, enabled);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/services
exports.listClinicServices = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const data = await clinicService.listClinicServices(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, ...data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// POST /api/v1/owner/clinic/branches/:branchId/services
exports.createClinicService = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!body.name || body.category == null) {
      return res.status(400).json({ success: false, message: "name and category are required" });
    }

    const data = await clinicService.createClinicService(prisma, userId, branchId, {
      name: String(body.name),
      description: body.description != null ? String(body.description) : undefined,
      category: String(body.category),
      price: Number(body.price),
      duration: body.duration != null ? Number(body.duration) : undefined,
      isRecurring: Boolean(body.isRecurring),
      status: body.status != null ? String(body.status) : undefined,
      department: body.department != null ? String(body.department) : undefined,
      paymentGateRule: body.paymentGateRule != null ? String(body.paymentGateRule) : undefined,
      serviceCode: body.serviceCode != null ? String(body.serviceCode) : undefined,
      prerequisiteRule: body.prerequisiteRule != null ? body.prerequisiteRule : undefined,
      allowDiscount: body.allowDiscount != null ? Boolean(body.allowDiscount) : undefined,
      maxDiscountPct: body.maxDiscountPct != null ? Number(body.maxDiscountPct) : undefined,
      discountNeedsApproval: body.discountNeedsApproval != null ? Boolean(body.discountNeedsApproval) : undefined,
      taxRuleJson: body.taxRuleJson != null ? body.taxRuleJson : undefined,
      applicableSpecies: Array.isArray(body.applicableSpecies) ? body.applicableSpecies : undefined,
      isCustom: body.isCustom != null ? Boolean(body.isCustom) : undefined,
      proposedByUserId: body.proposedByUserId != null ? Number(body.proposedByUserId) : undefined,
      approvalStatus: body.approvalStatus != null ? String(body.approvalStatus) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// PATCH /api/v1/owner/clinic/branches/:branchId/services/:serviceId
exports.updateClinicService = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const serviceId = asInt(req.params.serviceId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !serviceId) return res.status(400).json({ success: false, message: "Invalid branchId or serviceId" });

    const data = await clinicService.updateClinicService(prisma, userId, branchId, serviceId, {
      name: body.name != null ? String(body.name) : undefined,
      description: body.description != null ? String(body.description) : undefined,
      category: body.category != null ? String(body.category) : undefined,
      price: body.price != null ? Number(body.price) : undefined,
      duration: body.duration != null ? Number(body.duration) : undefined,
      isRecurring: body.isRecurring != null ? Boolean(body.isRecurring) : undefined,
      status: body.status != null ? String(body.status) : undefined,
      department: body.department != null ? String(body.department) : undefined,
      paymentGateRule: body.paymentGateRule != null ? String(body.paymentGateRule) : undefined,
      serviceCode: body.serviceCode !== undefined ? (body.serviceCode == null ? null : String(body.serviceCode)) : undefined,
      prerequisiteRule: body.prerequisiteRule !== undefined ? body.prerequisiteRule : undefined,
      allowDiscount: body.allowDiscount != null ? Boolean(body.allowDiscount) : undefined,
      maxDiscountPct: body.maxDiscountPct !== undefined ? (body.maxDiscountPct == null ? null : Number(body.maxDiscountPct)) : undefined,
      discountNeedsApproval: body.discountNeedsApproval != null ? Boolean(body.discountNeedsApproval) : undefined,
      taxRuleJson: body.taxRuleJson !== undefined ? body.taxRuleJson : undefined,
      applicableSpecies: body.applicableSpecies !== undefined ? (Array.isArray(body.applicableSpecies) ? body.applicableSpecies : undefined) : undefined,
      approvalStatus: body.approvalStatus !== undefined ? (body.approvalStatus == null ? null : String(body.approvalStatus)) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or service not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/services/:serviceId/variants
exports.getClinicServiceVariants = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const serviceId = asInt(req.params.serviceId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !serviceId) return res.status(400).json({ success: false, message: "Invalid branchId or serviceId" });
    const data = await clinicService.getClinicServiceVariants(prisma, userId, branchId, serviceId);
    if (data === null) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// PUT /api/v1/owner/clinic/branches/:branchId/services/:serviceId/variants
exports.putClinicServiceVariants = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const serviceId = asInt(req.params.serviceId);
    const body = req.body || {};
    const variants = Array.isArray(body.variants) ? body.variants : [];
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !serviceId) return res.status(400).json({ success: false, message: "Invalid branchId or serviceId" });
    const data = await clinicService.putClinicServiceVariants(prisma, userId, branchId, serviceId, variants);
    if (data === null) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/service-proposals
exports.listClinicServiceProposals = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const status = req.query.status;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.listClinicServiceProposals(prisma, userId, branchId, status ? { status: String(status) } : undefined);
    if (data === null) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, ...data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// POST /api/v1/owner/clinic/branches/:branchId/service-proposals/:proposalId/review
exports.reviewClinicServiceProposal = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const proposalId = asInt(req.params.proposalId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !proposalId) return res.status(400).json({ success: false, message: "Invalid branchId or proposalId" });
    const action = body.action === "APPROVED" || body.action === "REJECTED" ? body.action : undefined;
    if (!action) return res.status(400).json({ success: false, message: "body.action must be APPROVED or REJECTED" });
    const data = await clinicService.reviewClinicServiceProposal(prisma, userId, branchId, proposalId, { action, reviewNote: body.reviewNote });
    if (data === null) return res.status(404).json({ success: false, message: "Proposal not found or not pending" });
    return res.json({ success: true, ...data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// DELETE /api/v1/owner/clinic/branches/:branchId/services/:serviceId
exports.deleteClinicService = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const serviceId = asInt(req.params.serviceId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !serviceId) return res.status(400).json({ success: false, message: "Invalid branchId or serviceId" });

    const data = await clinicService.deleteClinicService(prisma, userId, branchId, serviceId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or service not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/staff
exports.listClinicStaff = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const data = await clinicService.listClinicStaff(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/clinic/branches/:branchId/staff/:memberId/profile
exports.getClinicStaffProfile = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });

    const data = await clinicService.getClinicStaffProfile(prisma, userId, branchId, memberId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or staff member not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// PUT /api/v1/owner/clinic/branches/:branchId/staff/:memberId/profile
exports.upsertClinicStaffProfile = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });

    const data = await clinicService.upsertClinicStaffProfile(prisma, userId, branchId, memberId, {
      staffType: body.staffType != null ? String(body.staffType) : undefined,
      licenseNumber: body.licenseNumber,
      specializationTags: Array.isArray(body.specializationTags) ? body.specializationTags : undefined,
      defaultConsultationFee: body.defaultConsultationFee != null ? Number(body.defaultConsultationFee) : undefined,
      visiting: body.visiting != null ? Boolean(body.visiting) : undefined,
      status: body.status != null ? String(body.status) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or staff member not found" });

    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_STAFF_PROFILE_UPSERT",
      entityType: "BRANCH",
      entityId: `${branchId}:staffProfile:${memberId}`,
      before: null,
      after: { branchMemberId: memberId, staffType: data.staffType, status: data.status },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// --- Clinic Rooms ---

// GET /api/v1/owner/clinic/branches/:branchId/rooms
exports.listClinicRooms = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const data = await clinicService.listClinicRooms(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// POST /api/v1/owner/clinic/branches/:branchId/rooms
exports.createClinicRoom = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const data = await clinicService.createClinicRoom(prisma, userId, branchId, {
      name: String(body.name).trim(),
      roomType: body.roomType != null ? String(body.roomType) : "GENERAL",
      capacity: body.capacity != null ? Number(body.capacity) : undefined,
      status: body.status != null ? String(body.status) : "ACTIVE",
      notes: body.notes != null ? String(body.notes) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });

    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_ROOM_CREATE",
      entityType: "BRANCH",
      entityId: `${branchId}:room:${data.id}`,
      before: null,
      after: { id: data.id, name: data.name, roomType: data.roomType, status: data.status },
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// PATCH /api/v1/owner/clinic/branches/:branchId/rooms/:roomId
exports.updateClinicRoom = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const roomId = asInt(req.params.roomId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !roomId) return res.status(400).json({ success: false, message: "Invalid branchId or roomId" });

    const before = await prisma.branchRoom.findFirst({
      where: { id: roomId, branchId },
      select: { id: true, name: true, roomType: true, status: true },
    });
    const data = await clinicService.updateClinicRoom(prisma, userId, branchId, roomId, {
      name: body.name != null ? String(body.name).trim() : undefined,
      roomType: body.roomType != null ? String(body.roomType) : undefined,
      capacity: body.capacity !== undefined ? (body.capacity == null ? undefined : Number(body.capacity)) : undefined,
      status: body.status != null ? String(body.status) : undefined,
      notes: body.notes !== undefined ? (body.notes == null ? null : String(body.notes).trim()) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or room not found" });

    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_ROOM_UPDATE",
      entityType: "BRANCH",
      entityId: `${branchId}:room:${roomId}`,
      before: before ?? null,
      after: { id: data.id, name: data.name, roomType: data.roomType, status: data.status },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// DELETE /api/v1/owner/clinic/branches/:branchId/rooms/:roomId (soft: set status INACTIVE)
exports.deleteClinicRoom = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const roomId = asInt(req.params.roomId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !roomId) return res.status(400).json({ success: false, message: "Invalid branchId or roomId" });

    const before = await prisma.branchRoom.findFirst({
      where: { id: roomId, branchId },
      select: { id: true, name: true, status: true },
    });
    const data = await clinicService.deleteClinicRoom(prisma, userId, branchId, roomId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or room not found" });

    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_ROOM_DEACTIVATE",
      entityType: "BRANCH",
      entityId: `${branchId}:room:${roomId}`,
      before: before ?? null,
      after: { id: data.id, status: data.status },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// --- Schedule templates ---
exports.getScheduleTemplates = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.getScheduleTemplates(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.putScheduleTemplates = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.putScheduleTemplates(prisma, userId, branchId, {
      doctorTemplates: body.doctorTemplates,
      roomTemplates: body.roomTemplates,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_SCHEDULE_TEMPLATE_PUT",
      entityType: "BRANCH",
      entityId: `${branchId}:schedule`,
      before: null,
      after: { branchId },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(400).json({ success: false, message: isProd ? "Bad request" : (e?.message || "Bad request") });
  }
};

// --- Holidays ---
exports.listHolidays = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.listHolidays(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.createHoliday = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!body.date) return res.status(400).json({ success: false, message: "date is required" });
    const data = await clinicService.createHoliday(prisma, userId, branchId, {
      date: body.date,
      name: body.name,
      notes: body.notes,
      isClosed: body.isClosed,
      startTime: body.startTime,
      endTime: body.endTime,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_HOLIDAY_CREATE",
      entityType: "BRANCH",
      entityId: `${branchId}:holiday:${data.id}`,
      before: null,
      after: { id: data.id, date: data.date, name: data.name },
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(400).json({ success: false, message: isProd ? "Bad request" : (e?.message || "Bad request") });
  }
};

exports.deleteHoliday = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const holidayId = asInt(req.params.holidayId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !holidayId) return res.status(400).json({ success: false, message: "Invalid branchId or holidayId" });
    const data = await clinicService.deleteHoliday(prisma, userId, branchId, holidayId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or holiday not found" });
    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_HOLIDAY_DELETE",
      entityType: "BRANCH",
      entityId: `${branchId}:holiday:${holidayId}`,
      before: { holidayId },
      after: null,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// --- Emergency policy ---
exports.getEmergencyPolicy = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.getEmergencyPolicy(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.updateEmergencyPolicy = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.updateEmergencyPolicy(prisma, userId, branchId, {
      enabled: body.enabled,
      reservedSlotsPerDay: body.reservedSlotsPerDay,
      allowedHours: body.allowedHours,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_EMERGENCY_POLICY_UPDATE",
      entityType: "BRANCH",
      entityId: `${branchId}:policy:emergency`,
      before: null,
      after: data,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// --- Fees ---
exports.getClinicFees = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.getClinicFees(prisma, userId, branchId);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.updateClinicFees = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.updateClinicFees(prisma, userId, branchId, { serviceOverrides: body.serviceOverrides });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_FEES_UPDATE",
      entityType: "BRANCH",
      entityId: `${branchId}:fees`,
      before: null,
      after: { branchId },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(400).json({ success: false, message: isProd ? "Bad request" : (e?.message || "Bad request") });
  }
};

// POST /api/v1/owner/clinic/branches/:branchId/staff/:memberId/assign-template
exports.assignClinicRoleTemplate = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const templateKey = req.body?.templateKey;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    if (!templateKey || typeof templateKey !== "string") return res.status(400).json({ success: false, message: "templateKey is required" });
    const data = await clinicService.assignClinicRoleTemplate(prisma, userId, branchId, memberId, templateKey);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or staff member not found" });
    await writeClinicAudit({
      prisma,
      req,
      action: "CLINIC_ROLE_TEMPLATE_ASSIGN",
      entityType: "BRANCH",
      entityId: `${branchId}:staffProfile:${memberId}`,
      before: null,
      after: { templateKey, staffType: data.staffType },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(400).json({ success: false, message: isProd ? "Bad request" : (e?.message || "Bad request") });
  }
};

// PATCH /api/v1/owner/clinic/branches/:branchId/staff/:memberId/permissions — clinic-only permission overrides (owner-only)
exports.updateClinicStaffPermissions = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const permissionOverrides = req.body?.permissionOverrides;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    if (!Array.isArray(permissionOverrides)) return res.status(400).json({ success: false, message: "body.permissionOverrides (array) is required" });
    const data = await clinicService.updateClinicStaffPermissions(prisma, userId, branchId, memberId, permissionOverrides);
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch or staff member not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(400).json({ success: false, message: isProd ? "Bad request" : (e?.message || "Bad request") });
  }
};

// --- Appointment + Schedule Exceptions (Phase 2) ---

exports.listClinicAppointments = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const { date, doctorId, status, limit, offset } = req.query;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.listAppointmentsForOwner(prisma, userId, branchId, {
      date: date ? String(date) : undefined,
      doctorId: doctorId ? Number(doctorId) : undefined,
      status: status ? String(status) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.getClinicSlots = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const { doctorId, serviceId, date } = req.query;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !date) return res.status(400).json({ success: false, message: "branchId and date required" });
    const data = await clinicService.getSlotsForOwner(prisma, userId, branchId, {
      doctorId: doctorId ? Number(doctorId) : undefined,
      serviceId: serviceId ? Number(serviceId) : undefined,
      date: String(date),
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data: { slots: data } });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.createClinicAppointment = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.createAppointmentForOwner(prisma, userId, branchId, {
      patientId: Number(body.patientId),
      petId: body.petId ? Number(body.petId) : undefined,
      doctorId: Number(body.doctorId),
      serviceId: Number(body.serviceId),
      scheduledStartAt: new Date(body.scheduledStartAt),
      scheduledEndAt: new Date(body.scheduledEndAt),
      source: body.source || "OWNER_PORTAL",
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(400).json({ success: false, message: e?.message || "Bad request" });
  }
};

exports.cancelClinicAppointment = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const appointmentId = asInt(req.params.appointmentId);
    const reason = req.body?.reason ?? "Cancelled by owner";
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !appointmentId) return res.status(400).json({ success: false, message: "Invalid branchId or appointmentId" });
    const data = await clinicService.cancelAppointmentForOwner(prisma, userId, branchId, appointmentId, reason);
    if (data === null) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(400).json({ success: false, message: e?.message || "Bad request" });
  }
};

exports.rescheduleClinicAppointment = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const appointmentId = asInt(req.params.appointmentId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !appointmentId) return res.status(400).json({ success: false, message: "Invalid branchId or appointmentId" });
    const data = await clinicService.rescheduleAppointmentForOwner(prisma, userId, branchId, appointmentId, {
      scheduledStartAt: new Date(body.scheduledStartAt),
      scheduledEndAt: new Date(body.scheduledEndAt),
      doctorId: body.doctorId ? Number(body.doctorId) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(400).json({ success: false, message: e?.message || "Bad request" });
  }
};

exports.listClinicScheduleExceptions = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const { doctorId, from, to } = req.query;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.listScheduleExceptions(prisma, userId, branchId, {
      doctorId: doctorId ? Number(doctorId) : undefined,
      from: from ? String(from) : undefined,
      to: to ? String(to) : undefined,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.createClinicScheduleException = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.createScheduleException(prisma, userId, branchId, {
      doctorId: Number(body.doctorId),
      date: String(body.date),
      type: String(body.type),
      startTime: body.startTime,
      endTime: body.endTime,
      note: body.note,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(400).json({ success: false, message: e?.message || "Bad request" });
  }
};

exports.deleteClinicScheduleException = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const exceptionId = asInt(req.params.exceptionId ?? req.params.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !exceptionId) return res.status(400).json({ success: false, message: "Invalid branchId or exceptionId" });
    const data = await clinicService.deleteScheduleException(prisma, userId, branchId, exceptionId);
    if (data === null) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(400).json({ success: false, message: e?.message || "Bad request" });
  }
};

// --- Doctor management (CP1) ---

exports.listClinicDoctors = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const contractStatus = req.query?.contractStatus ? String(req.query.contractStatus) : undefined;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.listClinicDoctors(prisma, userId, branchId, { contractStatus });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.inviteClinicDoctor = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.inviteClinicDoctor(prisma, userId, branchId, {
      email: body.email,
      phone: body.phone,
      displayName: body.displayName,
      role: body.role,
      roleInClinic: body.roleInClinic,
      defaultConsultationFee: body.defaultConsultationFee != null ? Number(body.defaultConsultationFee) : undefined,
      scheduleEditPolicy: body.scheduleEditPolicy,
      message: body.message,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const { devInviteToken, ...rest } = data as { devInviteToken?: string; [k: string]: unknown };
    return res.status(201).json({
      success: true,
      data: isProd ? rest : { ...rest, devInviteToken },
    });
  } catch (e: any) {
    console.error(e);
    if (e?.message === "role is required" || e?.message === "phone or email is required" || e?.message === "Invalid role for this branch type") {
      return res.status(400).json({ success: false, message: e.message });
    }
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.getClinicDoctorDetail = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const data = await clinicService.getClinicDoctorDetail(prisma, userId, branchId, memberId);
    if (data === null) return res.status(404).json({ success: false, message: "Doctor not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.patchClinicDoctorTerms = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const data = await clinicService.patchClinicDoctorTerms(prisma, userId, branchId, memberId, body);
    if (data === null) return res.status(404).json({ success: false, message: "Doctor not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.putClinicDoctorServices = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const data = await clinicService.putClinicDoctorServices(prisma, userId, branchId, memberId, { services: body.services });
    if (data === null) return res.status(404).json({ success: false, message: "Doctor not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// --- Schedule proposals (CP3A) ---
exports.listClinicScheduleProposals = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const status = req.query?.status ? String(req.query.status) : undefined;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicService.listClinicScheduleProposals(prisma, userId, branchId, { status });
    if (data === null) return res.status(404).json({ success: false, message: "Clinic branch not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.reviewClinicScheduleProposal = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const proposalId = asInt(req.params.proposalId);
    const body = req.body || {};
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !proposalId) return res.status(400).json({ success: false, message: "Invalid branchId or proposalId" });
    const data = await clinicService.reviewClinicScheduleProposal(prisma, userId, branchId, proposalId, {
      status: body.status,
      reviewNote: body.reviewNote,
    });
    if (data === null) return res.status(404).json({ success: false, message: "Proposal not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Proposal already reviewed") return res.status(400).json({ success: false, message: e.message });
    if (e?.message === "status must be APPROVED or REJECTED") return res.status(400).json({ success: false, message: e.message });
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// --- Doctor metrics (CP4A) ---
exports.getClinicDoctorMetrics = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const data = await clinicService.getClinicDoctorMetrics(prisma, userId, branchId, memberId, { from, to });
    if (data === null) return res.status(404).json({ success: false, message: "Doctor not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.getClinicDoctorCapacity = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const date = req.query?.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const data = await clinicService.getClinicDoctorCapacity(prisma, userId, branchId, memberId, date);
    if (data === null) return res.status(404).json({ success: false, message: "Doctor not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.listClinicDoctorSettlementLedger = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const status = req.query?.status ? String(req.query.status) : undefined;
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const data = await clinicService.listClinicDoctorSettlementLedger(prisma, userId, branchId, memberId, { status, from, to });
    if (data === null) return res.status(404).json({ success: false, message: "Doctor not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.listClinicDoctorAuditLog = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const limit = req.query?.limit != null ? parseInt(String(req.query.limit), 10) : undefined;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const data = await clinicService.listClinicDoctorAuditLog(prisma, userId, branchId, memberId, { limit: Number.isFinite(limit) ? limit : undefined });
    if (data === null) return res.status(404).json({ success: false, message: "Doctor not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

// ------------------------------
// Clinic Enterprise: Surgery Packages (owner proxy to clinic module)
// ------------------------------
const packageService = require("../clinic/package.service");
const clinicalItemService = require("../clinic/clinicalItem.service");
const clinicalItemCategoryService = require("../clinic/clinicalItemCategory.service");
const clinicalItemStockService = require("../clinic/clinicalItemStock.service");
const clinicalStockLedgerService = require("../clinic/clinicalStockLedger.service");
const inventoryConsumptionService = require("../clinic/inventoryConsumption.service");
const clinicalSupplyRequestService = require("../clinic/clinicalSupplyRequest.service");
const clinicalStockTransferService = require("../clinic/clinicalStockTransfer.service");
const sterilizationService = require("../clinic/sterilization.service");
const instrumentInstanceService = require("../clinic/instrumentInstance.service");
const clinicalStockAuditService = require("../clinic/clinicalStockAudit.service");
const clinicalWastageService = require("../clinic/clinicalWastage.service");
const replenishmentService = require("../clinic/replenishment.service");
const mediaService = require("../media/media.service");
const masterCatalogService = require("../clinic/masterCatalog.service");
const clinicCatalogInstallService = require("../clinic/clinicCatalogInstall.service");
const clinicCatalogImportService = require("../clinic/clinicCatalogImport.service");
const addFromMasterCatalogService = require("../clinic/addFromMasterCatalog.service");

exports.listClinicPackages = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await packageService.listPackages({
      branchId,
      serviceId: q.serviceId ? parseInt(String(q.serviceId), 10) : undefined,
      packageType: q.packageType ? String(q.packageType) : undefined,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.getClinicPackageById = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.getPackageById(packageId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[getClinicPackageById] Package not found", { branchId: req.params?.branchId, packageId: req.params?.packageId });
      }
      return res.status(404).json({ success: false, message: "Package not found" });
    }
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.createClinicPackage = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
    const data = await packageService.createPackage({
      orgId: branch.orgId,
      branchId,
      packageCode: body.packageCode,
      packageName: body.packageName,
      serviceId: body.serviceId,
      packageType: body.packageType ?? "STANDARD",
      baseSellingPrice: body.baseSellingPrice,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validTo: body.validTo ? new Date(body.validTo) : undefined,
      doctorFeeAmount: body.doctorFeeAmount,
      clinicFeeAmount: body.clinicFeeAmount,
      consumableBlockAmount: body.consumableBlockAmount,
      medicationBlockAmount: body.medicationBlockAmount,
      supportFeeAmount: body.supportFeeAmount,
      estimatedCost: body.estimatedCost,
      emergencySurchargeRule: body.emergencySurchargeRule,
      addOnAllowed: body.addOnAllowed,
      discountable: body.discountable,
      speciesCondition: body.speciesCondition,
      status: body.status ?? "DRAFT",
      eligibilityRuleJson: body.eligibilityRuleJson,
      availabilityRuleJson: body.availabilityRuleJson,
      minSellingPrice: body.minSellingPrice,
      maxDiscountPct: body.maxDiscountPct,
      maxDiscountAmount: body.maxDiscountAmount,
      taxApplicable: body.taxApplicable,
      branchOverrideAllowed: body.branchOverrideAllowed,
      description: body.description,
      publicDescription: body.publicDescription,
      internalNotes: body.internalNotes,
      department: body.department,
      breedNote: body.breedNote,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
      effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function toBool(v: unknown): boolean {
  return v === true || v === "true";
}

exports.updateClinicPackage = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const body = req.body || {};
    const userId = req.user?.id;
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.updatePackage(packageId, branchId, {
      packageName: body.packageName,
      packageType: body.packageType,
      baseSellingPrice: toNum(body.baseSellingPrice) ?? (typeof body.baseSellingPrice === "number" ? body.baseSellingPrice : undefined),
      validFrom: body.validFrom != null ? new Date(body.validFrom) : undefined,
      validTo: body.validTo != null ? new Date(body.validTo) : undefined,
      doctorFeeAmount: body.doctorFeeAmount != null && body.doctorFeeAmount !== "" ? toNum(body.doctorFeeAmount) ?? null : body.doctorFeeAmount,
      clinicFeeAmount: body.clinicFeeAmount != null && body.clinicFeeAmount !== "" ? toNum(body.clinicFeeAmount) ?? null : body.clinicFeeAmount,
      consumableBlockAmount: body.consumableBlockAmount != null && body.consumableBlockAmount !== "" ? toNum(body.consumableBlockAmount) ?? null : body.consumableBlockAmount,
      medicationBlockAmount: body.medicationBlockAmount != null && body.medicationBlockAmount !== "" ? toNum(body.medicationBlockAmount) ?? null : body.medicationBlockAmount,
      supportFeeAmount: body.supportFeeAmount != null && body.supportFeeAmount !== "" ? toNum(body.supportFeeAmount) ?? null : body.supportFeeAmount,
      estimatedCost: body.estimatedCost != null && body.estimatedCost !== "" ? toNum(body.estimatedCost) ?? null : body.estimatedCost,
      emergencySurchargeRule: body.emergencySurchargeRule,
      addOnAllowed: body.addOnAllowed,
      discountable: body.discountable,
      speciesCondition: body.speciesCondition,
      status: body.status,
      eligibilityRuleJson: body.eligibilityRuleJson,
      availabilityRuleJson: body.availabilityRuleJson,
      minSellingPrice: body.hasOwnProperty("minSellingPrice") ? (body.minSellingPrice === null || body.minSellingPrice === "" ? null : (toNum(body.minSellingPrice) ?? null)) : undefined,
      maxDiscountPct: body.hasOwnProperty("maxDiscountPct") ? (body.maxDiscountPct === null || body.maxDiscountPct === "" ? null : (toNum(body.maxDiscountPct) ?? null)) : undefined,
      maxDiscountAmount: body.hasOwnProperty("maxDiscountAmount") ? (body.maxDiscountAmount === null || body.maxDiscountAmount === "" ? null : (toNum(body.maxDiscountAmount) ?? null)) : undefined,
      taxApplicable: body.hasOwnProperty("taxApplicable") ? toBool(body.taxApplicable) : undefined,
      branchOverrideAllowed: body.hasOwnProperty("branchOverrideAllowed") ? toBool(body.branchOverrideAllowed) : undefined,
      description: body.description,
      publicDescription: body.publicDescription,
      internalNotes: body.internalNotes,
      department: body.department,
      breedNote: body.breedNote,
      updatedByUserId: userId,
      effectiveFrom: body.effectiveFrom != null ? new Date(body.effectiveFrom) : undefined,
      effectiveTo: body.effectiveTo != null ? new Date(body.effectiveTo) : undefined,
      serviceId: body.serviceId != null && body.serviceId !== "" ? (typeof body.serviceId === "number" ? body.serviceId : parseInt(String(body.serviceId), 10)) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.deleteClinicPackage = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    await packageService.deletePackage(packageId, branchId);
    return res.json({ success: true, data: { deleted: true } });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

exports.listClinicPackageItems = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.listPackageItems(packageId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicPackageItemsBatch = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const body = req.body || {};
    const rows = Array.isArray(body.items) ? body.items : [];
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const result = await packageService.createPackageItemsBatch(packageId, branchId, rows);
    return res.json({ success: true, data: result });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.upsertClinicPackageItem = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const body = req.body || {};
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.upsertPackageItem(packageId, branchId, {
      id: body.id,
      itemType: body.itemType ?? "INCLUDED",
      productId: body.productId,
      variantId: body.variantId,
      clinicalItemId: body.clinicalItemId,
      clinicalItemVariantId: body.clinicalItemVariantId,
      estimatedQty: body.estimatedQty,
      estimatedCost: body.estimatedCost,
      displayLabel: body.displayLabel,
      sortOrder: body.sortOrder,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.deleteClinicPackageItem = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const itemId = asInt(req.params.itemId);
    if (!branchId || !packageId || !itemId) return res.status(400).json({ success: false, message: "Invalid params" });
    await packageService.deletePackageItem(packageId, itemId, branchId);
    return res.json({ success: true, data: { deleted: true } });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicPackagePriceRules = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.listPackagePriceRules(packageId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicPackagePriceRule = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const body = req.body || {};
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const priceOverride = body.priceOverride ?? body.price;
    const data = await packageService.createPackagePriceRule(packageId, branchId, {
      branchId,
      species: body.species,
      weightMin: body.weightMin,
      weightMax: body.weightMax,
      clinicStaffProfileId: body.clinicStaffProfileId,
      isEmergency: body.isEmergency,
      price: priceOverride != null ? Number(priceOverride) : undefined,
      priceOverride: priceOverride != null ? Number(priceOverride) : undefined,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validTo: body.validTo ? new Date(body.validTo) : undefined,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.deleteClinicPackagePriceRule = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const ruleId = asInt(req.params.ruleId);
    if (!branchId || !packageId || !ruleId) return res.status(400).json({ success: false, message: "Invalid params" });
    await packageService.deletePackagePriceRule(packageId, ruleId, branchId);
    return res.json({ success: true, data: { deleted: true } });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicPackageImpact = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.getPackageImpact(packageId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicPackageAuditLog = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const limit = req.query?.limit != null ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query?.offset != null ? parseInt(String(req.query.offset), 10) : 0;
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.getPackageAuditLog(packageId, branchId, { limit, offset });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.duplicateClinicPackage = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const body = req.body || {};
    const userId = req.user?.id;
    const newPackageCode = body.packageCode ?? body.newPackageCode;
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    if (!newPackageCode || typeof newPackageCode !== "string" || !newPackageCode.trim()) {
      return res.status(400).json({ success: false, message: "packageCode or newPackageCode is required" });
    }
    const data = await packageService.duplicatePackage(packageId, branchId, {
      newPackageCode: newPackageCode.trim(),
      userId,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    if (e?.message === "Package code already exists") return res.status(400).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicPackageTemplates = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const list = await prisma.surgeryPackageTemplate.findMany({
      where: { orgId },
      orderBy: { packageName: "asc" },
      include: { service: { select: { id: true, name: true } } },
    });
    return res.json({ success: true, data: list });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicPackageTemplateById = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const templateId = asInt(req.params.templateId);
    if (!branchId || !templateId) return res.status(400).json({ success: false, message: "Invalid branchId or templateId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const row = await prisma.surgeryPackageTemplate.findFirst({
      where: { id: templateId, orgId },
      include: { service: { select: { id: true, name: true } } },
    });
    if (!row) return res.status(404).json({ success: false, message: "Template not found" });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicPackageTemplate = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!body.packageName?.trim()) return res.status(400).json({ success: false, message: "packageName is required" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const itemsJson = body.itemsJson != null ? (typeof body.itemsJson === "string" ? JSON.parse(body.itemsJson) : body.itemsJson) : [];
    const row = await prisma.surgeryPackageTemplate.create({
      data: {
        orgId,
        packageName: body.packageName.trim(),
        serviceId: body.serviceId != null ? parseInt(String(body.serviceId), 10) : undefined,
        surgeryType: body.surgeryType?.trim() || undefined,
        itemsJson: Array.isArray(itemsJson) ? itemsJson : [],
      },
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.updateClinicPackageTemplate = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const templateId = asInt(req.params.templateId);
    const body = req.body || {};
    if (!branchId || !templateId) return res.status(400).json({ success: false, message: "Invalid branchId or templateId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const existing = await prisma.surgeryPackageTemplate.findFirst({ where: { id: templateId, orgId } });
    if (!existing) return res.status(404).json({ success: false, message: "Template not found" });
    const updateData = {};
    if (body.packageName !== undefined) (updateData as any).packageName = String(body.packageName).trim();
    if (body.serviceId !== undefined) (updateData as any).serviceId = body.serviceId == null ? null : parseInt(String(body.serviceId), 10);
    if (body.surgeryType !== undefined) (updateData as any).surgeryType = body.surgeryType?.trim() || null;
    if (body.itemsJson !== undefined) (updateData as any).itemsJson = typeof body.itemsJson === "string" ? JSON.parse(body.itemsJson) : body.itemsJson;
    const row = await prisma.surgeryPackageTemplate.update({
      where: { id: templateId },
      data: updateData,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.deleteClinicPackageTemplate = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const templateId = asInt(req.params.templateId);
    if (!branchId || !templateId) return res.status(400).json({ success: false, message: "Invalid branchId or templateId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const existing = await prisma.surgeryPackageTemplate.findFirst({ where: { id: templateId, orgId } });
    if (!existing) return res.status(404).json({ success: false, message: "Template not found" });
    await prisma.surgeryPackageTemplate.delete({ where: { id: templateId } });
    return res.json({ success: true });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicPackageComposition = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const packageId = asInt(req.params.packageId);
    const species = req.query?.species ? String(req.query.species) : undefined;
    if (!branchId || !packageId) return res.status(400).json({ success: false, message: "Invalid branchId or packageId" });
    const data = await packageService.getPackageComposition(packageId, branchId, { species });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Surgery package not found") return res.status(404).json({ success: false, message: "Package not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Clinical Item Master (owner)
async function getBranchOrgIdForItems(prisma: any, branchId: number): Promise<number> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");
  return branch.orgId;
}

exports.listClinicItems = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const q = req.query || {};
    const data = await clinicalItemService.listClinicalItems({
      orgId,
      domainType: q.domainType ? String(q.domainType) : undefined,
      categoryId: q.categoryId ? parseInt(String(q.categoryId), 10) : undefined,
      search: q.search ? String(q.search) : undefined,
      isActive: q.isActive !== undefined ? q.isActive === "true" : undefined,
      page: q.page ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicItemById = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    if (!branchId || !itemId) return res.status(400).json({ success: false, message: "Invalid branchId or itemId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemService.getClinicalItemById(itemId, { orgId });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Clinical item not found") return res.status(404).json({ success: false, message: "Item not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.searchClinicItems = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const q = req.query || {};
    const data = await clinicalItemService.searchClinicalItems({
      orgId,
      q: q.q ? String(q.q) : undefined,
      domainType: q.domainType ? String(q.domainType) : undefined,
      branchId: branchId,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicItem = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!body.name || !body.domainType) return res.status(400).json({ success: false, message: "name and domainType are required" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemService.createClinicalItem({
      orgId,
      name: body.name,
      domainType: body.domainType,
      categoryId: body.categoryId,
      baseUnit: body.baseUnit,
      description: body.description,
      brandName: body.brandName,
      manufacturerName: body.manufacturerName,
      isClinicUse: body.isClinicUse,
      isSellable: body.isSellable,
      isPackageEligible: body.isPackageEligible,
      isInventoryTracked: body.isInventoryTracked,
      requiresBatch: body.requiresBatch,
      requiresExpiry: body.requiresExpiry,
      isReusable: body.isReusable,
      isHighRisk: body.isHighRisk,
      defaultCost: body.defaultCost,
      defaultSalePrice: body.defaultSalePrice,
      createdByUserId: userId ?? undefined,
      itemCode: body.itemCode,
      medicineProfile: body.medicineProfile,
      consumableProfile: body.consumableProfile,
      instrumentProfile: body.instrumentProfile,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.updateClinicItem = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    const body = req.body || {};
    if (!branchId || !itemId) return res.status(400).json({ success: false, message: "Invalid branchId or itemId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemService.updateClinicalItem(itemId, orgId, {
      name: body.name,
      categoryId: body.categoryId,
      baseUnit: body.baseUnit,
      description: body.description,
      brandName: body.brandName,
      manufacturerName: body.manufacturerName,
      isClinicUse: body.isClinicUse,
      isSellable: body.isSellable,
      isPackageEligible: body.isPackageEligible,
      isInventoryTracked: body.isInventoryTracked,
      requiresBatch: body.requiresBatch,
      requiresExpiry: body.requiresExpiry,
      isReusable: body.isReusable,
      isHighRisk: body.isHighRisk,
      defaultCost: body.defaultCost,
      defaultSalePrice: body.defaultSalePrice,
      updatedByUserId: userId ?? undefined,
      medicineProfile: body.medicineProfile,
      consumableProfile: body.consumableProfile,
      instrumentProfile: body.instrumentProfile,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Clinical item not found") return res.status(404).json({ success: false, message: "Item not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.activateClinicItem = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    if (!branchId || !itemId) return res.status(400).json({ success: false, message: "Invalid branchId or itemId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemService.activateClinicalItem(itemId, orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Clinical item not found") return res.status(404).json({ success: false, message: "Item not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.deactivateClinicItem = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    if (!branchId || !itemId) return res.status(400).json({ success: false, message: "Invalid branchId or itemId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemService.deactivateClinicalItem(itemId, orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Clinical item not found") return res.status(404).json({ success: false, message: "Item not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicItemVariant = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    const body = req.body || {};
    if (!branchId || !itemId) return res.status(400).json({ success: false, message: "Invalid branchId or itemId" });
    if (!body.variantName) return res.status(400).json({ success: false, message: "variantName is required" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemService.createClinicalItemVariant(itemId, orgId, {
      variantName: body.variantName,
      sku: body.sku,
      barcode: body.barcode,
      unitLabel: body.unitLabel,
      packSize: body.packSize,
      strengthOrSpec: body.strengthOrSpec,
      defaultCost: body.defaultCost,
      defaultSalePrice: body.defaultSalePrice,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Clinical item not found") return res.status(404).json({ success: false, message: "Item not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.updateClinicItemVariant = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    const variantId = asInt(req.params.variantId);
    const body = req.body || {};
    if (!branchId || !variantId) return res.status(400).json({ success: false, message: "Invalid branchId or variantId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemService.updateClinicalItemVariant(variantId, orgId, {
      variantName: body.variantName,
      sku: body.sku,
      barcode: body.barcode,
      unitLabel: body.unitLabel,
      packSize: body.packSize,
      strengthOrSpec: body.strengthOrSpec,
      defaultCost: body.defaultCost,
      defaultSalePrice: body.defaultSalePrice,
      isActive: body.isActive,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Clinical item variant not found") return res.status(404).json({ success: false, message: "Variant not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicItemCategories = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const q = req.query || {};
    const data = await clinicalItemCategoryService.listClinicalItemCategories({
      orgId,
      parentId: q.parentId !== undefined ? (q.parentId === "" || q.parentId === "null" ? null : parseInt(String(q.parentId), 10)) : undefined,
      domainType: q.domainType ? String(q.domainType) : undefined,
      isActive: q.isActive !== undefined ? q.isActive === "true" : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicItemCategoryTree = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemCategoryService.getClinicalItemCategoryTree(orgId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicItemCategory = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!body.name) return res.status(400).json({ success: false, message: "name is required" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemCategoryService.createClinicalItemCategory({
      orgId,
      name: body.name,
      parentId: body.parentId,
      domainType: body.domainType,
      sortOrder: body.sortOrder,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.updateClinicItemCategory = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const categoryId = asInt(req.params.categoryId);
    const body = req.body || {};
    if (!branchId || !categoryId) return res.status(400).json({ success: false, message: "Invalid branchId or categoryId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    const data = await clinicalItemCategoryService.updateClinicalItemCategory(categoryId, orgId, {
      name: body.name,
      parentId: body.parentId,
      domainType: body.domainType,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Clinical item category not found") return res.status(404).json({ success: false, message: "Category not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.deleteClinicItemCategory = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const categoryId = asInt(req.params.categoryId);
    if (!branchId || !categoryId) return res.status(400).json({ success: false, message: "Invalid branchId or categoryId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    await clinicalItemCategoryService.deleteClinicalItemCategory(categoryId, orgId);
    return res.json({ success: true });
  } catch (e: any) {
    if (e?.message === "Clinical item category not found") return res.status(404).json({ success: false, message: "Category not found" });
    if (e?.message?.includes("has items") || e?.message?.includes("subcategories")) return res.status(400).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.uploadClinicItemMedia = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    const file = req.file;
    if (!branchId || !itemId) return res.status(400).json({ success: false, message: "Invalid branchId or itemId" });
    if (!file?.buffer) return res.status(400).json({ success: false, message: "No file uploaded. Use multipart field 'file'." });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    await clinicalItemService.getClinicalItemById(itemId, { orgId });
    const ownerUserId = userId ?? 0;
    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId,
      file: { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname },
      folder: "clinical-items",
    });
    const sortOrder = req.body?.sortOrder != null ? parseInt(String(req.body.sortOrder), 10) : 0;
    const row = await prisma.clinicalItemMedia.create({
      data: { itemId, mediaUrl: media.url, sortOrder },
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    if (e?.message === "Clinical item not found" || e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.deleteClinicItemMedia = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const itemId = asInt(req.params.itemId);
    const mediaId = asInt(req.params.mediaId);
    if (!branchId || !itemId || !mediaId) return res.status(400).json({ success: false, message: "Invalid branchId, itemId or mediaId" });
    const orgId = await getBranchOrgIdForItems(prisma, branchId);
    await clinicalItemService.getClinicalItemById(itemId, { orgId });
    const existing = await prisma.clinicalItemMedia.findFirst({
      where: { id: mediaId, itemId },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Media not found" });
    await prisma.clinicalItemMedia.delete({ where: { id: mediaId } });
    return res.json({ success: true });
  } catch (e: any) {
    if (e?.message === "Clinical item not found" || e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Master Catalog: templates, install, import, upgrade
async function getBranchOrgIdForCatalog(prisma: any, branchId: number): Promise<number> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");
  return branch.orgId;
}

exports.listCatalogTemplates = async (req: any, res: any) => {
  try {
    const data = await masterCatalogService.listTemplates({ isActive: true });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getCatalogTemplateById = async (req: any, res: any) => {
  try {
    const templateId = asInt(req.params.templateId);
    if (!templateId) return res.status(400).json({ success: false, message: "Invalid templateId" });
    const data = await masterCatalogService.getTemplateById(templateId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Template not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.previewCatalogInstall = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const templateId = asInt(req.body?.templateId ?? req.query?.templateId);
    if (!branchId || !templateId) return res.status(400).json({ success: false, message: "Invalid branchId or templateId" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const categoryIds = req.body?.categoryIds ?? req.query?.categoryIds;
    const itemIds = req.body?.itemIds ?? req.query?.itemIds;
    const data = await clinicCatalogInstallService.previewInstall(orgId, templateId, {
      categoryIds: Array.isArray(categoryIds) ? categoryIds.map((x: unknown) => parseInt(String(x), 10)) : undefined,
      itemIds: Array.isArray(itemIds) ? itemIds.map((x: unknown) => parseInt(String(x), 10)) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Template not found" || e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.installCatalogTemplate = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    const templateId = asInt(body.templateId);
    if (!branchId || !templateId) return res.status(400).json({ success: false, message: "Invalid branchId or templateId" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const data = await clinicCatalogInstallService.installTemplate(orgId, templateId, userId, {
      categoryIds: Array.isArray(body.categoryIds) ? body.categoryIds.map((x: unknown) => parseInt(String(x), 10)) : undefined,
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map((x: unknown) => parseInt(String(x), 10)) : undefined,
      overwriteExisting: body.overwriteExisting === true,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Template not found" || e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getCatalogInstallHistory = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const limit = req.query?.limit ? parseInt(String(req.query.limit), 10) : 20;
    const data = await clinicCatalogInstallService.getInstallHistory(orgId, limit);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getCatalogUpgradeCheck = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const templateId = asInt(req.params.templateId ?? req.query?.templateId);
    if (!branchId || !templateId) return res.status(400).json({ success: false, message: "Invalid branchId or templateId" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const data = await clinicCatalogInstallService.getUpgradeDiff(orgId, templateId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Template not found" || e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listMasterCatalogCategories = async (req: any, res: any) => {
  try {
    const q = req.query || {};
    const data = await masterCatalogService.listMasterCategories({
      parentId: q.parentId != null ? parseInt(String(q.parentId), 10) : undefined,
      domainType: q.domainType != null ? String(q.domainType) : undefined,
      isActive: q.isActive !== undefined ? q.isActive === "true" : undefined,
      page: q.page != null ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listMasterCatalogItems = async (req: any, res: any) => {
  try {
    const q = req.query || {};
    const data = await masterCatalogService.listMasterItems({
      categoryId: q.categoryId != null ? parseInt(String(q.categoryId), 10) : undefined,
      domainType: q.domainType != null ? String(q.domainType) : undefined,
      search: q.search != null ? String(q.search) : undefined,
      isActive: q.isActive !== undefined ? q.isActive === "true" : undefined,
      page: q.page != null ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.previewAddFromMasterCatalog = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const body = req.body || {};
    const masterItemIds = Array.isArray(body.masterItemIds) ? body.masterItemIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const masterCategoryIds = Array.isArray(body.masterCategoryIds) ? body.masterCategoryIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const option = body.option && ["createMissingOnly", "createOrUpdate", "skipExisting"].includes(body.option) ? body.option : "createMissingOnly";
    const data = await addFromMasterCatalogService.previewAddFromMaster(orgId, {
      masterItemIds: masterItemIds.length ? masterItemIds : undefined,
      masterCategoryIds: masterCategoryIds.length ? masterCategoryIds : undefined,
      option,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.executeAddFromMasterCatalog = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const userId = getUserId(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const body = req.body || {};
    const masterItemIds = Array.isArray(body.masterItemIds) ? body.masterItemIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const masterCategoryIds = Array.isArray(body.masterCategoryIds) ? body.masterCategoryIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const option = body.option && ["createMissingOnly", "createOrUpdate", "skipExisting"].includes(body.option) ? body.option : "createMissingOnly";
    const data = await addFromMasterCatalogService.executeAddFromMaster(orgId, userId, {
      masterItemIds: masterItemIds.length ? masterItemIds : undefined,
      masterCategoryIds: masterCategoryIds.length ? masterCategoryIds : undefined,
      option,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.previewCatalogImport = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const raw = req.body?.csvText ?? req.body?.csv ?? req.body?.data ?? "";
    const csvText = typeof raw === "string" ? raw : "";
    const csvRows = clinicCatalogImportService.parseCsvToRows(csvText);
    const rows = clinicCatalogImportService.csvRowsToImportRows(csvRows);
    const action = req.body?.action ?? "create-or-update";
    const data = await clinicCatalogImportService.previewImport(orgId, rows, { action });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.executeCatalogImport = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgIdForCatalog(prisma, branchId);
    const body = req.body || {};
    const preview = body.preview;
    if (!preview || !Array.isArray(preview.rows)) return res.status(400).json({ success: false, message: "Body must include preview with rows" });
    const action = body.action ?? "create-or-update";
    const data = await clinicCatalogImportService.executeImport(orgId, preview, { action });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicBranchItemStock = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await clinicalItemStockService.getBranchItemStock({
      branchId,
      itemId: q.itemId ? parseInt(String(q.itemId), 10) : undefined,
      variantId: q.variantId ? parseInt(String(q.variantId), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicLowStockAlerts = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicalItemStockService.getLowStockAlerts(branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicItemStockLedger = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await clinicalStockLedgerService.getClinicalStockHistory({
      branchId,
      clinicalItemId: q.clinicalItemId ? parseInt(String(q.clinicalItemId), 10) : undefined,
      variantId: q.variantId ? parseInt(String(q.variantId), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : 100,
      offset: q.offset ? parseInt(String(q.offset), 10) : 0,
      fromDate: q.fromDate ? new Date(String(q.fromDate)) : undefined,
      toDate: q.toDate ? new Date(String(q.toDate)) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicItemStockConsumption = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await inventoryConsumptionService.getConsumptionForBranch({
      branchId,
      limit: q.limit ? parseInt(String(q.limit), 10) : 50,
      offset: q.offset ? parseInt(String(q.offset), 10) : 0,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicItemStockAdjust = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const body = req.body || {};
    const itemId = body.itemId != null ? parseInt(String(body.itemId), 10) : null;
    const variantId = body.variantId != null ? parseInt(String(body.variantId), 10) : null;
    const deltaQty = body.deltaQty != null ? parseFloat(String(body.deltaQty)) : null;
    if (itemId == null || variantId == null || deltaQty == null || Number.isNaN(itemId) || Number.isNaN(variantId) || Number.isNaN(deltaQty)) {
      return res.status(400).json({ success: false, message: "itemId, variantId, and deltaQty are required" });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;
    const unitCost = body.unitCost != null ? parseFloat(String(body.unitCost)) : undefined;
    const actorId = getUserId(req);
    const data = await clinicalItemStockService.adjustBranchItemStock(branchId, itemId, variantId, deltaQty, { reason, unitCost, actorId });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicItemStockReceive = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const body = req.body || {};
    const itemId = body.itemId != null ? parseInt(String(body.itemId), 10) : null;
    const variantId = body.variantId != null ? parseInt(String(body.variantId), 10) : null;
    const quantity = body.quantity != null ? parseFloat(String(body.quantity)) : null;
    if (itemId == null || variantId == null || quantity == null || Number.isNaN(itemId) || Number.isNaN(variantId) || Number.isNaN(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: "itemId, variantId, and positive quantity are required" });
    }
    const batchNo = typeof body.batchNo === "string" ? body.batchNo.trim() : undefined;
    const expiryDate = body.expiryDate ? new Date(body.expiryDate) : undefined;
    const purchaseCost = body.purchaseCost != null ? parseFloat(String(body.purchaseCost)) : undefined;
    const actorId = getUserId(req);
    if (batchNo) {
      const data = await clinicalItemStockService.createBranchItemBatch(branchId, itemId, variantId, {
        batchNo,
        expiryDate: expiryDate || undefined,
        receivedQty: quantity,
        purchaseCost,
        actorId,
      });
      return res.json({ success: true, data });
    }
    const data = await clinicalItemStockService.adjustBranchItemStock(branchId, itemId, variantId, quantity, { reason: "Receive", unitCost: purchaseCost, actorId });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Clinical supply requests & transfers (owner)
async function getOwnerOrgIdOrFail(prisma: any, req: any): Promise<number> {
  const userId = getUserId(req);
  if (!userId) throw new Error("Unauthorized");
  const orgIdParam = asInt(req.query?.orgId ?? req.params?.orgId);
  if (orgIdParam) {
    const org = await prisma.organization.findFirst({
      where: { id: orgIdParam, ownerUserId: userId },
      select: { id: true },
    });
    if (!org) throw new Error("Organization not found or access denied");
    return org.id;
  }
  const first = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!first) throw new Error("No organization found");
  return first.id;
}

exports.listClinicSupplyRequests = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const orgId = await getOwnerOrgIdOrFail(prisma, req);
    const q = req.query || {};
    const data = await clinicalSupplyRequestService.listSupplyRequests({
      orgId,
      status: q.status ? String(q.status) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : 50,
      offset: q.offset ? parseInt(String(q.offset), 10) : 0,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicSupplyRequestById = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const orgId = await getOwnerOrgIdOrFail(prisma, req);
    const requestId = asInt(req.params.requestId);
    if (!requestId) return res.status(400).json({ success: false, message: "Invalid requestId" });
    const data = await clinicalSupplyRequestService.getSupplyRequestById(requestId, { orgId });
    if (!data) return res.status(404).json({ success: false, message: "Supply request not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.reviewClinicSupplyRequest = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const orgId = await getOwnerOrgIdOrFail(prisma, req);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const requestId = asInt(req.params.requestId);
    if (!requestId) return res.status(400).json({ success: false, message: "Invalid requestId" });
    const body = req.body || {};
    const decision = (body.decision as string) || "REJECTED";
    if (!["APPROVED", "PARTIAL_APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Invalid decision" });
    }
    const data = await clinicalSupplyRequestService.reviewSupplyRequest(
      requestId,
      orgId,
      userId,
      decision as "APPROVED" | "PARTIAL_APPROVED" | "REJECTED",
      { reviewNote: body.reviewNote, items: body.items }
    );
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicTransferFromRequest = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const orgId = await getOwnerOrgIdOrFail(prisma, req);
    const requestId = asInt(req.params.requestId);
    if (!requestId) return res.status(400).json({ success: false, message: "Invalid requestId" });
    const body = req.body || {};
    const fromBranchId = asInt(body.fromBranchId);
    if (!fromBranchId) return res.status(400).json({ success: false, message: "fromBranchId is required" });
    const branch = await prisma.branch.findFirst({
      where: { id: fromBranchId, orgId },
      select: { id: true },
    });
    if (!branch) return res.status(400).json({ success: false, message: "Branch not found or not in org" });
    const data = await clinicalStockTransferService.createTransferFromRequest(
      requestId,
      orgId,
      fromBranchId,
      { actorId: getUserId(req) ?? undefined }
    );
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.dispatchClinicTransfer = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const orgId = await getOwnerOrgIdOrFail(prisma, req);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const transferId = asInt(req.params.transferId);
    if (!transferId) return res.status(400).json({ success: false, message: "Invalid transferId" });
    const data = await clinicalStockTransferService.dispatchTransfer(transferId, orgId, userId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicTransfers = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const orgId = await getOwnerOrgIdOrFail(prisma, req);
    const q = req.query || {};
    const data = await clinicalStockTransferService.getTransferHistory({
      orgId,
      branchId: q.branchId ? asInt(String(q.branchId)) : undefined,
      direction: q.direction === "from" || q.direction === "to" ? q.direction : undefined,
      status: q.status ? String(q.status) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : 50,
      offset: q.offset ? parseInt(String(q.offset), 10) : 0,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicTransferById = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const orgId = await getOwnerOrgIdOrFail(prisma, req);
    const transferId = asInt(req.params.transferId);
    if (!transferId) return res.status(400).json({ success: false, message: "Invalid transferId" });
    const data = await clinicalStockTransferService.getTransferById(transferId, { orgId });
    if (!data) return res.status(404).json({ success: false, message: "Transfer not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Instrument issue/return (owner)
exports.listClinicInstrumentIssueLogs = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const status = req.query?.status === "returned" ? "returned" : req.query?.status === "open" ? "open" : undefined;
    const where = { branchId };
    if (status === "open") where.returnedAt = null;
    if (status === "returned") where.returnedAt = { not: null };
    const rows = await prisma.instrumentIssueLog.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      take: 200,
    });
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const variantIds = [...new Set(rows.map((r) => r.variantId))];
    const [items, variants] = await Promise.all([
      itemIds.length ? prisma.clinicalItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, itemCode: true } }) : [],
      variantIds.length ? prisma.clinicalItemVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, variantName: true, sku: true } }) : [],
    ]);
    const itemMap = new Map((items as any[]).map((i) => [i.id, i]));
    const variantMap = new Map((variants as any[]).map((v) => [v.id, v]));
    const data = rows.map((r) => ({
      ...r,
      item: itemMap.get(r.itemId),
      variant: variantMap.get(r.variantId),
    }));
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicInstrumentIssueLog = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const body = req.body || {};
    const itemId = body.itemId != null ? parseInt(String(body.itemId), 10) : null;
    const variantId = body.variantId != null ? parseInt(String(body.variantId), 10) : null;
    const issuedQty = body.issuedQty != null ? parseFloat(String(body.issuedQty)) : null;
    if (itemId == null || variantId == null || issuedQty == null || Number.isNaN(itemId) || Number.isNaN(variantId) || Number.isNaN(issuedQty) || issuedQty <= 0) {
      return res.status(400).json({ success: false, message: "itemId, variantId, and positive issuedQty are required" });
    }
    const issuedToUserId = body.issuedToUserId != null ? parseInt(String(body.issuedToUserId), 10) : null;
    const procedureId = body.procedureId != null ? parseInt(String(body.procedureId), 10) : null;
    const data = await prisma.instrumentIssueLog.create({
      data: {
        branchId,
        itemId,
        variantId,
        issuedToUserId: Number.isNaN(issuedToUserId) ? null : issuedToUserId,
        procedureId: procedureId != null && !Number.isNaN(procedureId) ? procedureId : null,
        issuedQty,
      },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.returnClinicInstrumentIssueLog = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const logId = asInt(req.params.logId);
    if (!branchId || !logId) return res.status(400).json({ success: false, message: "Invalid branchId or logId" });
    const body = req.body || {};
    const returnedQty = body.returnedQty != null ? parseFloat(String(body.returnedQty)) : null;
    if (returnedQty == null || Number.isNaN(returnedQty) || returnedQty < 0) {
      return res.status(400).json({ success: false, message: "returnedQty is required and must be >= 0" });
    }
    const sterilizationStatus = typeof body.sterilizationStatus === "string" ? body.sterilizationStatus.trim() || null : null;
    const conditionNote = typeof body.conditionNote === "string" ? body.conditionNote.trim() || null : null;
    const existing = await prisma.instrumentIssueLog.findFirst({ where: { id: logId, branchId } });
    if (!existing) return res.status(404).json({ success: false, message: "Log not found" });
    const data = await prisma.instrumentIssueLog.update({
      where: { id: logId },
      data: {
        returnedQty,
        returnedAt: new Date(),
        sterilizationStatus,
        conditionNote,
      },
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if ((e as any)?.code === "P2025") return res.status(404).json({ success: false, message: "Log not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicSterilizationCycles = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await sterilizationService.getSterilizationCycles(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : 50,
      offset: q.offset != null ? parseInt(String(q.offset), 10) : 0,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicSterilizationCycleById = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const cycleId = asInt(req.params.cycleId);
    if (!branchId || !cycleId) return res.status(400).json({ success: false, message: "Invalid branchId or cycleId" });
    const data = await sterilizationService.getSterilizationCycleById(cycleId, { branchId });
    if (!data) return res.status(404).json({ success: false, message: "Cycle not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicSterilizationCycleStart = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const userId = getUserId(req);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const body = req.body || {};
    const instrumentIds = Array.isArray(body.instrumentIds) ? body.instrumentIds.map((id: any) => parseInt(String(id), 10)).filter((n: number) => !Number.isNaN(n)) : [];
    const method = typeof body.method === "string" ? body.method : "AUTOCLAVE";
    const data = await sterilizationService.startSterilizationCycle(branchId, instrumentIds, method, {
      machineName: body.machineName,
      operatorId: userId,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicSterilizationCycleComplete = async (req: any, res: any) => {
  try {
    const cycleId = asInt(req.params.cycleId);
    if (!cycleId) return res.status(400).json({ success: false, message: "Invalid cycleId" });
    const body = req.body || {};
    const data = await sterilizationService.completeSterilizationCycle(cycleId, {
      sterileDays: body.sterileDays != null ? parseInt(String(body.sterileDays), 10) : undefined,
    });
    if (!data) return res.status(404).json({ success: false, message: "Cycle not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicSterilizationCycleFail = async (req: any, res: any) => {
  try {
    const cycleId = asInt(req.params.cycleId);
    if (!cycleId) return res.status(400).json({ success: false, message: "Invalid cycleId" });
    const data = await sterilizationService.failSterilizationCycle(cycleId);
    if (!data) return res.status(404).json({ success: false, message: "Cycle not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicInstrumentInstances = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await instrumentInstanceService.listInstrumentInstances(branchId, {
      clinicalItemId: q.clinicalItemId != null ? parseInt(String(q.clinicalItemId), 10) : undefined,
      sterilizationStatus: q.sterilizationStatus ? String(q.sterilizationStatus) : undefined,
      activeOnly: q.activeOnly !== "false",
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicSterilizationDueAlerts = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await instrumentInstanceService.getDueSterilizationAlerts(branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicStockAudits = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await clinicalStockAuditService.listAudits(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : 50,
      offset: q.offset != null ? parseInt(String(q.offset), 10) : 0,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicStockAuditById = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const auditId = asInt(req.params.auditId);
    if (!branchId || !auditId) return res.status(400).json({ success: false, message: "Invalid branchId or auditId" });
    const data = await clinicalStockAuditService.getAuditById(auditId, { branchId });
    if (!data) return res.status(404).json({ success: false, message: "Audit not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicStockAuditApprove = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const auditId = asInt(req.params.auditId);
    const userId = getUserId(req);
    if (!branchId || !auditId) return res.status(400).json({ success: false, message: "Invalid branchId or auditId" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await clinicalStockAuditService.approveAudit(auditId, userId, { branchId });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicWastageLogs = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await clinicalWastageService.listWastageLogs(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : 50,
      offset: q.offset != null ? parseInt(String(q.offset), 10) : 0,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicWastageLogById = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const wastageId = asInt(req.params.wastageId);
    if (!branchId || !wastageId) return res.status(400).json({ success: false, message: "Invalid branchId or wastageId" });
    const data = await clinicalWastageService.getWastageLogById(wastageId, { branchId });
    if (!data) return res.status(404).json({ success: false, message: "Wastage log not found" });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicWastageApprove = async (req: any, res: any) => {
  try {
    const wastageId = asInt(req.params.wastageId);
    const userId = getUserId(req);
    if (!wastageId) return res.status(400).json({ success: false, message: "Invalid wastageId" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getOwnerOrgIdOrFail(getPrisma(req), req);
    const data = await clinicalWastageService.approveWastage(wastageId, userId, { orgId });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicReplenishmentRecommendations = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await replenishmentService.listRecommendations(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : 50,
      offset: q.offset != null ? parseInt(String(q.offset), 10) : 0,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.postClinicReplenishmentGenerate = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const body = req.body || {};
    const data = await replenishmentService.generateRecommendations(branchId, {
      days: body.days ?? 30,
      requestedById: getUserId(req) ?? undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Clinic Enterprise: Discount (owner proxy)
const discountService = require("../clinic/discount.service");

async function getBranchOrgId(prisma: any, branchId: number): Promise<number> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");
  return branch.orgId;
}

exports.listClinicDiscountPolicies = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const q = req.query || {};
    const data = await discountService.listDiscountPolicies({
      branchId,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicDiscountPolicyById = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const policyId = asInt(req.params.policyId);
    if (!branchId || !policyId) return res.status(400).json({ success: false, message: "Invalid branchId or policyId" });
    const data = await discountService.getDiscountPolicyById(policyId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Discount policy not found") return res.status(404).json({ success: false, message: "Policy not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicDiscountPolicy = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const orgId = await getBranchOrgId(prisma, branchId);
    const data = await discountService.createDiscountPolicy({
      orgId,
      branchId,
      name: body.name,
      discountType: body.discountType,
      scope: body.scope ?? "SERVICE_LEVEL",
      calcType: body.calcType ?? "PERCENTAGE",
      maxPercent: body.maxPercent,
      maxAmount: body.maxAmount,
      absorptionMode: body.absorptionMode ?? "CLINIC_ABSORBS",
      requiresApproval: body.requiresApproval ?? true,
      serviceIds: body.serviceIds,
      packageIds: body.packageIds,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validTo: body.validTo ? new Date(body.validTo) : undefined,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.updateClinicDiscountPolicy = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const policyId = asInt(req.params.policyId);
    const body = req.body || {};
    if (!branchId || !policyId) return res.status(400).json({ success: false, message: "Invalid branchId or policyId" });
    const data = await discountService.updateDiscountPolicy(policyId, branchId, {
      name: body.name,
      maxPercent: body.maxPercent,
      maxAmount: body.maxAmount,
      requiresApproval: body.requiresApproval,
      serviceIds: body.serviceIds,
      packageIds: body.packageIds,
      validFrom: body.validFrom != null ? new Date(body.validFrom) : undefined,
      validTo: body.validTo != null ? new Date(body.validTo) : undefined,
      status: body.status,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Discount policy not found") return res.status(404).json({ success: false, message: "Policy not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicDiscountApprovalRules = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await discountService.getDiscountApprovalRules(branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.upsertClinicDiscountApprovalRule = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await discountService.upsertDiscountApprovalRule(branchId, {
      roleKey: body.roleKey,
      maxPercent: body.maxPercent,
      maxAmount: body.maxAmount,
      appliesToScope: body.appliesToScope,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicDiscountAuditLog = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const q = req.query || {};
    const data = await discountService.getDiscountAuditLog({
      branchId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      policyId: q.policyId ? parseInt(String(q.policyId), 10) : undefined,
      orderId: q.orderId ? parseInt(String(q.orderId), 10) : undefined,
      caseId: q.caseId ? parseInt(String(q.caseId), 10) : undefined,
      page: q.page ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Clinic Enterprise: Doctor contract (owner proxy)
const doctorContractService = require("../clinic/doctorContract.service");

async function getClinicStaffProfileIdFromMember(prisma: any, branchId: number, memberId: number): Promise<number> {
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId: memberId },
    select: { id: true },
  });
  if (!profile) throw new Error("Doctor clinic profile not found for this branch");
  return profile.id;
}

exports.getClinicDoctorContract = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const clinicStaffProfileId = await getClinicStaffProfileIdFromMember(prisma, branchId, memberId);
    const data = await doctorContractService.getContractForDoctor(clinicStaffProfileId, branchId);
    return res.json({ success: true, data: data ?? null });
  } catch (e: any) {
    if (e?.message?.includes("not found")) return res.status(404).json({ success: false, message: (e as Error)?.message || "Not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicDoctorContracts = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const q = req.query || {};
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const clinicStaffProfileId = await getClinicStaffProfileIdFromMember(prisma, branchId, memberId);
    const data = await doctorContractService.listContracts({
      branchId,
      clinicStaffProfileId,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.createClinicDoctorContract = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const body = req.body || {};
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const clinicStaffProfileId = await getClinicStaffProfileIdFromMember(prisma, branchId, memberId);
    const data = await doctorContractService.createContract({
      clinicStaffProfileId,
      branchId,
      contractType: body.contractType,
      effectiveFrom: new Date(body.effectiveFrom),
      effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
      consultationRule: body.consultationRule,
      surgeryRule: body.surgeryRule,
      emergencyRule: body.emergencyRule,
      discountImpactRule: body.discountImpactRule,
      payoutFrequency: body.payoutFrequency,
      thresholdIncentiveJson: body.thresholdIncentiveJson,
      serviceApplicability: body.serviceApplicability,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.updateClinicDoctorContract = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const contractId = asInt(req.params.contractId);
    const body = req.body || {};
    if (!branchId || !memberId || !contractId) return res.status(400).json({ success: false, message: "Invalid params" });
    await getClinicStaffProfileIdFromMember(prisma, branchId, memberId);
    const data = await doctorContractService.updateContract(contractId, branchId, {
      effectiveTo: body.effectiveTo != null ? new Date(body.effectiveTo) : undefined,
      status: body.status,
      consultationRule: body.consultationRule,
      surgeryRule: body.surgeryRule,
      emergencyRule: body.emergencyRule,
      discountImpactRule: body.discountImpactRule,
      payoutFrequency: body.payoutFrequency,
      thresholdIncentiveJson: body.thresholdIncentiveJson,
      serviceApplicability: body.serviceApplicability,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Contract not found") return res.status(404).json({ success: false, message: "Contract not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicDoctorContractRatePreview = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const q = req.query || {};
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const clinicStaffProfileId = await getClinicStaffProfileIdFromMember(prisma, branchId, memberId);
    const data = await doctorContractService.getRatePreview(branchId, clinicStaffProfileId, {
      serviceId: q.serviceId ? parseInt(String(q.serviceId), 10) : undefined,
      caseAmount: q.caseAmount != null ? parseFloat(String(q.caseAmount)) : undefined,
      isEmergency: q.isEmergency === "true",
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Clinic Enterprise: Settlement batches (owner proxy)
const settlementBatchService = require("../clinic/settlementBatch.service");

exports.generateClinicSettlementBatches = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await settlementBatchService.generateBatchesForBranch(branchId, {
      periodEnd: body.periodEnd ? new Date(body.periodEnd) : undefined,
      doctorProfileIds: body.doctorProfileIds,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.listClinicSettlementBatches = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const q = req.query || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await settlementBatchService.listBatches({
      branchId,
      clinicStaffProfileId: q.doctorProfileId ? parseInt(String(q.doctorProfileId), 10) : undefined,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicSettlementBatchById = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const batchId = asInt(req.params.batchId);
    if (!branchId || !batchId) return res.status(400).json({ success: false, message: "Invalid branchId or batchId" });
    const data = await settlementBatchService.getBatchById(batchId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Settlement batch not found") return res.status(404).json({ success: false, message: "Batch not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.reviewClinicSettlementBatch = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const batchId = asInt(req.params.batchId);
    if (!branchId || !batchId) return res.status(400).json({ success: false, message: "Invalid branchId or batchId" });
    const data = await settlementBatchService.reviewBatch(batchId, branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Settlement batch not found") return res.status(404).json({ success: false, message: "Batch not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.approveClinicSettlementBatch = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const batchId = asInt(req.params.batchId);
    const userId = getUserId(req);
    if (!branchId || !batchId) return res.status(400).json({ success: false, message: "Invalid branchId or batchId" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await settlementBatchService.approveBatch(batchId, branchId, userId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Settlement batch not found") return res.status(404).json({ success: false, message: "Batch not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.payClinicSettlementBatch = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const batchId = asInt(req.params.batchId);
    const userId = getUserId(req);
    const body = req.body || {};
    if (!branchId || !batchId) return res.status(400).json({ success: false, message: "Invalid branchId or batchId" });
    const data = await settlementBatchService.payBatch(batchId, branchId, {
      paymentMethod: body.paymentMethod ?? "BANK_TRANSFER",
      amount: body.amount != null ? parseFloat(String(body.amount)) : undefined,
      paidByUserId: userId ?? undefined,
      receiptRef: body.reference ?? body.receiptRef,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Settlement batch not found") return res.status(404).json({ success: false, message: "Batch not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.addClinicSettlementBatchAdjustment = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const batchId = asInt(req.params.batchId);
    const body = req.body || {};
    if (!branchId || !batchId) return res.status(400).json({ success: false, message: "Invalid branchId or batchId" });
    const data = await settlementBatchService.addBatchAdjustment(batchId, branchId, {
      adjustmentType: body.adjustmentType ?? body.type ?? "DEDUCTION",
      amount: parseFloat(String(body.amount)),
      reason: body.reason,
      createdByUserId: getUserId(req) ?? undefined,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Settlement batch not found") return res.status(404).json({ success: false, message: "Batch not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicDoctorSettlementSummary = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const branchId = asInt(req.params.branchId);
    const memberId = asInt(req.params.memberId);
    const q = req.query || {};
    if (!branchId || !memberId) return res.status(400).json({ success: false, message: "Invalid branchId or memberId" });
    const clinicStaffProfileId = await getClinicStaffProfileIdFromMember(prisma, branchId, memberId);
    const data = await settlementBatchService.getSettlementSummaryForDoctor(clinicStaffProfileId, branchId, {
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message?.includes("not found")) return res.status(404).json({ success: false, message: (e as Error)?.message || "Not found" });
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Clinic Enterprise: Reports (owner proxy)
const clinicReportsService = require("../clinic/clinicReports.service");

exports.getClinicProfitabilityReport = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    if (!branchId || !from || !to) return res.status(400).json({ success: false, message: "branchId, from and to (YYYY-MM-DD) required" });
    const data = await clinicReportsService.getProfitabilityReport(branchId, from, to);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicSettlementSummaryReport = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    if (!branchId || !from || !to) return res.status(400).json({ success: false, message: "branchId, from and to (YYYY-MM-DD) required" });
    const data = await clinicReportsService.getSettlementSummaryReport(branchId, from, to);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicDiscountAnalysisReport = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    if (!branchId || !from || !to) return res.status(400).json({ success: false, message: "branchId, from and to (YYYY-MM-DD) required" });
    const data = await clinicReportsService.getDiscountAnalysisReport(branchId, from, to);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicInventoryVarianceReport = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    if (!branchId || !from || !to) return res.status(400).json({ success: false, message: "branchId, from and to (YYYY-MM-DD) required" });
    const data = await clinicReportsService.getInventoryVarianceReport(branchId, from, to);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.getClinicDoctorContributionReport = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    if (!branchId || !from || !to) return res.status(400).json({ success: false, message: "branchId, from and to (YYYY-MM-DD) required" });
    const data = await clinicReportsService.getDoctorContributionReport(branchId, from, to);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

// ------------------------------ Clinic Enterprise: Finance config (owner proxy)
const clinicFinanceConfigService = require("../clinic/clinicFinanceConfig.service");

exports.getClinicFinanceConfig = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicFinanceConfigService.getFinanceConfig(branchId);
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};

exports.updateClinicFinanceConfig = async (req: any, res: any) => {
  try {
    const branchId = asInt(req.params.branchId);
    const body = req.body || {};
    if (!branchId) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await clinicFinanceConfigService.updateFinanceConfig(branchId, {
      settlementCycle: body.settlementCycle,
      discountLimitDefaultPct: body.discountLimitDefaultPct,
      overheadAllocationMethod: body.overheadAllocationMethod,
      caseCompletionRule: body.caseCompletionRule,
      vialReturnDays: body.vialReturnDays,
      stockIssueAuditLock: body.stockIssueAuditLock,
      billEditRestrictionAfterClose: body.billEditRestrictionAfterClose,
      doctorFeeEditRestricted: body.doctorFeeEditRestricted,
      configJson: body.configJson,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: (e as Error)?.message || "Server error" });
  }
};
