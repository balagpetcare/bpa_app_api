const svc = require("../../services/medicine-master/medicineMaster.workspace.service");

function getUserId(req: any): number | null {
  const id = req.user?.id;
  return id != null ? Number(id) : null;
}

function asInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message });
}

exports.countries = async (req: any, res: any) => {
  try {
    const data = await svc.listActiveCountries();
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.dashboardSummary = async (req: any, res: any) => {
  try {
    const data = await svc.getDashboardSummary();
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.reviewQueues = async (_req: any, res: any) => {
  try {
    const data = await svc.getReviewQueuesDetail();
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

function parseHasPrescriptionsQuery(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

function parseSourceTypeQuery(v: unknown): "imported" | "manual" | undefined {
  const s = String(v || "").toLowerCase();
  if (s === "imported") return "imported";
  if (s === "manual") return "manual";
  return undefined;
}

function parseIsoDayParam(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  return s.slice(0, 10);
}

function parseListingStatusQuery(q: any): boolean | undefined {
  const ls = q.listingStatus != null ? String(q.listingStatus).toLowerCase() : "";
  if (ls === "active") return true;
  if (ls === "inactive") return false;
  if (q.isActive === "true") return true;
  if (q.isActive === "false") return false;
  return undefined;
}

function parsePrescriptionStateQuery(q: any): boolean | undefined {
  const ps = q.prescriptionState != null ? String(q.prescriptionState).toLowerCase() : "";
  if (ps === "yes") return true;
  if (ps === "no") return false;
  const rx = q.rx != null ? String(q.rx).toLowerCase() : "";
  if (rx === "yes") return true;
  if (rx === "no") return false;
  return parseHasPrescriptionsQuery(q.hasPrescriptions);
}

function listingFilterFromQuery(q: any) {
  const countryId = asInt(q.countryId);
  const includeArchived =
    String(q.includeArchived || "") === "1" ||
    String(q.includeArchived) === "true" ||
    String(q.arch || "") === "1";
  return {
    countryId: countryId ?? undefined,
    includeArchived,
    q: q.q ? String(q.q) : undefined,
    isActive: parseListingStatusQuery(q),
    hasPrescriptions: parsePrescriptionStateQuery(q),
    brandQ: q.brandContains ? String(q.brandContains) : q.brandQ ? String(q.brandQ) : undefined,
    genericQ: q.genericContains ? String(q.genericContains) : q.genericQ ? String(q.genericQ) : undefined,
    dosageFormQ: q.dosageFormContains ? String(q.dosageFormContains) : q.dosageFormQ ? String(q.dosageFormQ) : undefined,
    strengthQ: q.strengthContains ? String(q.strengthContains) : q.strengthQ ? String(q.strengthQ) : undefined,
    manufacturerQ: q.manufacturerContains ? String(q.manufacturerContains) : q.manufacturerQ ? String(q.manufacturerQ) : undefined,
    packageQ: q.packageContains ? String(q.packageContains) : q.packageQ ? String(q.packageQ) : undefined,
    sourceType: parseSourceTypeQuery(q.sourceType),
    importBatchId: asInt(q.importBatchId),
    genericId: asInt(q.genericId),
    brandId: asInt(q.brandId),
    dosageFormId: asInt(q.dosageFormId),
    manufacturerId: asInt(q.manufacturerId),
    listingCreatedAtFrom: parseIsoDayParam(q.createdFrom ?? q.listingCreatedAtFrom),
    listingCreatedAtTo: parseIsoDayParam(q.createdTo ?? q.listingCreatedAtTo),
    listingUpdatedAtFrom: parseIsoDayParam(q.updatedFrom ?? q.listingUpdatedAtFrom),
    listingUpdatedAtTo: parseIsoDayParam(q.updatedTo ?? q.listingUpdatedAtTo),
    firstBatchCreatedAtFrom: parseIsoDayParam(q.importDateFrom ?? q.firstBatchCreatedAtFrom),
    firstBatchCreatedAtTo: parseIsoDayParam(q.importDateTo ?? q.firstBatchCreatedAtTo),
    firstBatchUploadedByUserId: asInt(q.importedByUserId ?? q.firstBatchUploadedByUserId ?? q.impBy),
    relatedExpand: q.relatedExpand ? String(q.relatedExpand) : q.rel ? String(q.rel) : undefined,
  };
}

exports.exportListingsCsv = async (req: any, res: any) => {
  try {
    const csv = await svc.exportListingsCsv(listingFilterFromQuery(req.query));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="medicine-listings.csv"');
    return res.send(csv);
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsList = async (req: any, res: any) => {
  try {
    const data = await svc.listCountryListings({
      ...listingFilterFromQuery(req.query),
      page: asInt(req.query.page),
      limit: asInt(req.query.limit),
      sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
      sortDir: req.query.sortDir ? String(req.query.sortDir) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsBulk = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const action = req.body?.action;
    if (action !== "deactivate" && action !== "activate" && action !== "archive") {
      return err(res, 400, "action must be deactivate, activate, or archive");
    }
    const data = await svc.bulkMutateCountryListings(userId, {
      action,
      ids: Array.isArray(req.body?.ids) ? req.body.ids : [],
      reason: req.body?.reason != null ? String(req.body.reason) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.auditLogs = async (req: any, res: any) => {
  try {
    const entityType = req.query.entityType ? String(req.query.entityType).trim() : "";
    const entityId = asInt(req.query.entityId);
    if (!entityType || entityId == null) {
      return err(res, 400, "entityType and entityId query parameters are required");
    }
    const data = await svc.listMedicineMasterAuditLogs({
      entityType,
      entityId,
      page: asInt(req.query.page),
      limit: asInt(req.query.limit),
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsGet = async (req: any, res: any) => {
  try {
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.getCountryListingById(id);
    if (!row) return err(res, 404, "Not found");
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsPreview = async (req: any, res: any) => {
  try {
    const countryId = asInt(req.body?.countryId);
    const presentationId = asInt(req.body?.presentationId);
    const brandId = asInt(req.body?.brandId);
    if (countryId == null || presentationId == null || brandId == null) {
      return err(res, 400, "countryId, presentationId, and brandId are required");
    }
    const data = await svc.previewCountryListing({
      countryId,
      presentationId,
      brandId,
      packageMarkDisplay: req.body?.packageMarkDisplay != null ? String(req.body.packageMarkDisplay) : undefined,
      packageMarkNormalized: req.body?.packageMarkNormalized != null ? String(req.body.packageMarkNormalized) : undefined,
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsCreate = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const countryId = asInt(req.body?.countryId);
    const presentationId = asInt(req.body?.presentationId);
    const brandId = asInt(req.body?.brandId);
    if (countryId == null || presentationId == null || brandId == null) {
      return err(res, 400, "countryId, presentationId, and brandId are required");
    }
    const row = await svc.createCountryListing(userId, {
      countryId,
      presentationId,
      brandId,
      packageMarkDisplay: req.body?.packageMarkDisplay != null ? String(req.body.packageMarkDisplay) : undefined,
      packageMarkNormalized: req.body?.packageMarkNormalized != null ? String(req.body.packageMarkNormalized) : undefined,
      isActive: req.body?.isActive,
      workspaceProfileJson:
        req.body?.workspaceProfileJson !== undefined
          ? (req.body.workspaceProfileJson === null ? null : (req.body.workspaceProfileJson as object))
          : undefined,
      reviewStatus: req.body?.reviewStatus != null ? String(req.body.reviewStatus) : undefined,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsPatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.patchCountryListing(userId, id, {
      packageMarkDisplay: req.body?.packageMarkDisplay != null ? String(req.body.packageMarkDisplay) : undefined,
      packageMarkNormalized: req.body?.packageMarkNormalized != null ? String(req.body.packageMarkNormalized) : undefined,
      isActive: req.body?.isActive,
      deactivatedReason: req.body?.deactivatedReason != null ? String(req.body.deactivatedReason) : undefined,
      workspaceProfileJson:
        req.body?.workspaceProfileJson !== undefined
          ? (req.body.workspaceProfileJson === null ? null : (req.body.workspaceProfileJson as object))
          : undefined,
      reviewStatus:
        req.body?.reviewStatus === undefined
          ? undefined
          : req.body.reviewStatus === null
            ? null
            : String(req.body.reviewStatus),
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsArchive = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const reason = req.body?.reason != null ? String(req.body.reason) : undefined;
    const row = await svc.archiveCountryListing(userId, id, reason);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.listingsRestore = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.restoreCountryListing(userId, id);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.genericsList = async (req: any, res: any) => {
  try {
    const data = await svc.listGenerics({
      search: req.query.search ? String(req.query.search) : undefined,
      page: asInt(req.query.page),
      limit: asInt(req.query.limit),
      includeInactive: String(req.query.includeInactive) === "1" || String(req.query.includeInactive) === "true",
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.genericsCreate = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const displayName = req.body?.displayName != null ? String(req.body.displayName) : "";
    const row = await svc.createGeneric(userId, displayName);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.genericsGet = async (req: any, res: any) => {
  try {
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await prisma.medicineGeneric.findFirst({ where: { id, archivedAt: null } });
    if (!row) return err(res, 404, "Not found");
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.genericsPatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.patchGeneric(userId, id, {
      displayName: req.body?.displayName != null ? String(req.body.displayName) : undefined,
      isActive: req.body?.isActive,
      aliasesJson: req.body?.aliasesJson,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.genericsArchive = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.archiveGeneric(userId, id);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.dosageFormsList = async (req: any, res: any) => {
  try {
    const data = await svc.listDosageForms({
      search: req.query.search ? String(req.query.search) : undefined,
      page: asInt(req.query.page),
      limit: asInt(req.query.limit),
      includeInactive: String(req.query.includeInactive) === "1" || String(req.query.includeInactive) === "true",
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.dosageFormsCreate = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const row = await svc.createDosageForm(userId, String(req.body?.displayName || ""));
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.dosageFormsGet = async (req: any, res: any) => {
  try {
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await prisma.medicineDosageForm.findFirst({ where: { id, archivedAt: null } });
    if (!row) return err(res, 404, "Not found");
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.dosageFormsPatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.patchDosageForm(userId, id, {
      displayName: req.body?.displayName != null ? String(req.body.displayName) : undefined,
      isActive: req.body?.isActive,
      aliasesJson: req.body?.aliasesJson,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.dosageFormsArchive = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.archiveDosageForm(userId, id);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.manufacturersList = async (req: any, res: any) => {
  try {
    const data = await svc.listManufacturers({
      search: req.query.search ? String(req.query.search) : undefined,
      page: asInt(req.query.page),
      limit: asInt(req.query.limit),
      includeInactive: String(req.query.includeInactive) === "1" || String(req.query.includeInactive) === "true",
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.manufacturersCreate = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const row = await svc.createManufacturer(userId, String(req.body?.displayName || ""));
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.manufacturersGet = async (req: any, res: any) => {
  try {
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await prisma.medicineManufacturer.findFirst({ where: { id, archivedAt: null } });
    if (!row) return err(res, 404, "Not found");
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.manufacturersPatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.patchManufacturer(userId, id, {
      displayName: req.body?.displayName != null ? String(req.body.displayName) : undefined,
      isActive: req.body?.isActive,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.manufacturersArchive = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.archiveManufacturer(userId, id);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.brandsList = async (req: any, res: any) => {
  try {
    const data = await svc.listBrands({
      search: req.query.search ? String(req.query.search) : undefined,
      manufacturerId: asInt(req.query.manufacturerId),
      page: asInt(req.query.page),
      limit: asInt(req.query.limit),
      includeInactive: String(req.query.includeInactive) === "1" || String(req.query.includeInactive) === "true",
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.brandsCreate = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const manufacturerId = asInt(req.body?.manufacturerId);
    if (manufacturerId == null) return err(res, 400, "manufacturerId required");
    const row = await svc.createBrand(userId, manufacturerId, String(req.body?.displayName || ""));
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.brandsGet = async (req: any, res: any) => {
  try {
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await prisma.medicineBrand.findFirst({
      where: { id, archivedAt: null },
      include: { manufacturer: { select: { id: true, displayName: true } } },
    });
    if (!row) return err(res, 404, "Not found");
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.brandsPatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.patchBrand(userId, id, {
      displayName: req.body?.displayName != null ? String(req.body.displayName) : undefined,
      isActive: req.body?.isActive,
      aliasesJson: req.body?.aliasesJson,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.brandsArchive = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.archiveBrand(userId, id);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.presentationsList = async (req: any, res: any) => {
  try {
    const data = await svc.listPresentations({
      search: req.query.search ? String(req.query.search) : undefined,
      genericId: asInt(req.query.genericId),
      dosageFormId: asInt(req.query.dosageFormId),
      page: asInt(req.query.page),
      limit: asInt(req.query.limit),
      includeInactive: String(req.query.includeInactive) === "1" || String(req.query.includeInactive) === "true",
    });
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.presentationsCreate = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const genericId = asInt(req.body?.genericId);
    const dosageFormId = asInt(req.body?.dosageFormId);
    if (genericId == null || dosageFormId == null) return err(res, 400, "genericId and dosageFormId required");
    const row = await svc.createPresentation(userId, {
      genericId,
      dosageFormId,
      strengthDisplay: String(req.body?.strengthDisplay || ""),
      strengthNormalizedKey: req.body?.strengthNormalizedKey != null ? String(req.body.strengthNormalizedKey) : undefined,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.presentationsGet = async (req: any, res: any) => {
  try {
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await prisma.medicinePresentation.findFirst({
      where: { id, archivedAt: null },
      include: {
        generic: { select: { id: true, displayName: true } },
        dosageForm: { select: { id: true, displayName: true } },
      },
    });
    if (!row) return err(res, 404, "Not found");
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.presentationsPatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.patchPresentation(userId, id, {
      strengthDisplay: req.body?.strengthDisplay != null ? String(req.body.strengthDisplay) : undefined,
      strengthNormalizedKey: req.body?.strengthNormalizedKey != null ? String(req.body.strengthNormalizedKey) : undefined,
      isActive: req.body?.isActive,
    });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.presentationsArchive = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, "Unauthorized");
    const id = asInt(req.params.id);
    if (id == null) return err(res, 400, "Invalid id");
    const row = await svc.archivePresentation(userId, id);
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.countryCatalogSummary = async (req: any, res: any) => {
  try {
    const countryId = asInt(req.params.countryId);
    if (countryId == null) return err(res, 400, "Invalid country id");
    const data = await svc.countryCatalogSummary(countryId);
    if (!data) return err(res, 404, "Country not found");
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.settingsMeta = async (_req: any, res: any) => {
  try {
    const { MEDICINE_IMPORT_MAX_ROWS, MEDICINE_IMPORT_MAX_FILE_BYTES } = require("../../constants/medicineImportLimits");
    return res.json({
      success: true,
      data: {
        medicineImportMaxRows: MEDICINE_IMPORT_MAX_ROWS,
        medicineImportMaxFileBytes: MEDICINE_IMPORT_MAX_FILE_BYTES,
        permissions: [
          "medicine.master.read",
          "medicine.master.write",
          "medicine.catalog.listing.manage",
          "medicine.catalog.import",
          "medicine.catalog.export",
          "medicine.catalog.review",
          "medicine.catalog.governance",
        ],
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

export {};
