const clinicalItemService = require("../clinic/clinicalItem.service");
const clinicalItemApprovalService = require("../clinic/clinicalItemApproval.service");
const masterCatalogService = require("../clinic/masterCatalog.service");
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

function asInt(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

exports.listItems = async (req: any, res: any) => {
  try {
    const orgId = asInt(req.query.orgId as string);
    if (orgId == null) return res.status(400).json({ success: false, message: "orgId is required" });
    const data = await clinicalItemService.listClinicalItems({
      orgId,
      domainType: req.query.domainType ? String(req.query.domainType) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
      page: asInt(req.query.page as string),
      limit: asInt(req.query.limit as string),
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.listAuditLogs = async (req: any, res: any) => {
  try {
    const orgId = asInt(req.query.orgId as string);
    const itemId = asInt(req.query.itemId as string);
    const page = Math.max(1, asInt(req.query.page as string) ?? 1);
    const limit = Math.min(100, Math.max(1, asInt(req.query.limit as string) ?? 20));
    const skip = (page - 1) * limit;
    const where = {};
    if (itemId != null) (where as any).itemId = itemId;
    if (orgId != null) (where as any).item = { orgId };
    const [logs, total] = await Promise.all([
      prisma.clinicalItemAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { performedAt: "desc" },
        include: { item: { select: { id: true, itemCode: true, name: true, orgId: true, domainType: true } } },
      }),
      prisma.clinicalItemAuditLog.count({ where }),
    ]);
    return res.json({
      success: true,
      data: {
        items: logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.listPendingApprovals = async (req: any, res: any) => {
  try {
    const data = await clinicalItemApprovalService.listPendingApprovals();
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.approveRequest = async (req: any, res: any) => {
  try {
    const logId = asInt(req.params.logId);
    const userId = req.user?.id ?? req.auth?.userId;
    if (logId == null) return res.status(400).json({ success: false, message: "logId required" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await clinicalItemApprovalService.approveRequest(logId, {
      approvedBy: typeof userId === "number" ? userId : parseInt(String(userId), 10),
      remarks: req.body?.remarks,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message?.includes("not found")) return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.rejectRequest = async (req: any, res: any) => {
  try {
    const logId = asInt(req.params.logId);
    const userId = req.user?.id ?? req.auth?.userId;
    if (logId == null) return res.status(400).json({ success: false, message: "logId required" });
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await clinicalItemApprovalService.rejectRequest(logId, {
      approvedBy: typeof userId === "number" ? userId : parseInt(String(userId), 10),
      remarks: req.body?.remarks,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message?.includes("not found")) return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.listMasterCategories = async (req: any, res: any) => {
  try {
    const data = await masterCatalogService.listMasterCategories({
      parentId: req.query.parentId !== undefined ? (req.query.parentId === "" ? null : asInt(req.query.parentId as string)) : undefined,
      domainType: req.query.domainType ? String(req.query.domainType) : undefined,
      isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
      page: asInt(req.query.page as string),
      limit: asInt(req.query.limit as string),
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.getMasterCategoryTree = async (req: any, res: any) => {
  try {
    const data = await masterCatalogService.getMasterCategoryTree();
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.listMasterItems = async (req: any, res: any) => {
  try {
    const data = await masterCatalogService.listMasterItems({
      categoryId: asInt(req.query.categoryId as string),
      domainType: req.query.domainType ? String(req.query.domainType) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
      page: asInt(req.query.page as string),
      limit: asInt(req.query.limit as string),
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.listMasterTemplates = async (req: any, res: any) => {
  try {
    const data = await masterCatalogService.listTemplates({
      isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.getMasterTemplateById = async (req: any, res: any) => {
  try {
    const templateId = asInt(req.params.templateId);
    if (templateId == null) return res.status(400).json({ success: false, message: "templateId required" });
    const data = await masterCatalogService.getTemplateById(templateId);
    return res.json({ success: true, data });
  } catch (e: any) {
    if (e?.message === "Template not found") return res.status(404).json({ success: false, message: e.message });
    console.error(e);
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};
