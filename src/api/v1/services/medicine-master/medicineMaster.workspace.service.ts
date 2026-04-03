/**
 * Admin Medicine Workspace — CRUD, dashboard, listings, exports (enterprise master data).
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { normalizeKey, normalizeDisplay } = require("../medicine-import/normalize");
const { buildImportFingerprint } = require("../medicine-import/fingerprint");
import type { NormalizedMedicineRow } from "../medicine-import/types";

function asPosInt(n: unknown, fallback: number) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

async function writeAudit(
  userId: number,
  entityType: string,
  entityId: number,
  action: string,
  before: unknown,
  after: unknown
) {
  await prisma.medicineMasterAuditLog.create({
    data: {
      entityType,
      entityId,
      action,
      beforeJson: before === undefined ? undefined : (before as object),
      afterJson: after === undefined ? undefined : (after as object),
      userId,
    },
  });
}

export async function listActiveCountries() {
  return prisma.country.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export async function getDashboardSummary() {
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stuckApplyBefore = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const [
    listingsActive,
    listingsInactive,
    listingsArchived,
    listingsImportedLineage,
    listingsManualApprox,
    listingsPrescriptionLinked,
    generics,
    brands,
    manufacturers,
    dosageForms,
    presentations,
    batchesRecent,
    reviewRows,
    failedBatches,
    partialAppliedLast7Days,
    batchesApplying,
    batchesApplyingStuck,
  ] = await Promise.all([
    prisma.countryMedicineBrand.count({ where: { isActive: true, archivedAt: null } }),
    prisma.countryMedicineBrand.count({ where: { isActive: false, archivedAt: null } }),
    prisma.countryMedicineBrand.count({ where: { archivedAt: { not: null } } }),
    prisma.countryMedicineBrand.count({
      where: { archivedAt: null, firstImportBatchId: { not: null } },
    }),
    prisma.countryMedicineBrand.count({
      where: { archivedAt: null, firstImportBatchId: null },
    }),
    prisma.countryMedicineBrand.count({
      where: { archivedAt: null, prescriptionItems: { some: {} } },
    }),
    prisma.medicineGeneric.count({ where: { archivedAt: null } }),
    prisma.medicineBrand.count({ where: { archivedAt: null } }),
    prisma.medicineManufacturer.count({ where: { archivedAt: null } }),
    prisma.medicineDosageForm.count({ where: { archivedAt: null } }),
    prisma.medicinePresentation.count({ where: { archivedAt: null } }),
    prisma.medicineImportBatch.findMany({
      where: { createdAt: { gte: since7 } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        status: true,
        filename: true,
        totalRows: true,
        createdAt: true,
        country: { select: { code: true, name: true } },
      },
    }),
    prisma.medicineImportRow.count({
      where: { classification: { in: ["NEEDS_REVIEW", "INVALID"] }, batch: { status: { in: ["PREVIEW_READY", "PARSED", "FAILED"] } } },
    }),
    prisma.medicineImportBatch.count({ where: { status: "FAILED", createdAt: { gte: since7 } } }),
    prisma.medicineImportBatch.count({
      where: { status: "PARTIALLY_APPLIED", appliedAt: { gte: since7 } },
    }),
    prisma.medicineImportBatch.count({ where: { status: "APPLYING" } }),
    prisma.medicineImportBatch.count({
      where: { status: "APPLYING", updatedAt: { lt: stuckApplyBefore } },
    }),
  ]);

  const queueInvalid = await prisma.medicineImportRow.count({
    where: { classification: "INVALID", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
  });
  const queueDup = await prisma.medicineImportRow.count({
    where: { classification: "DUPLICATE_IN_FILE", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
  });
  const queueExists = await prisma.medicineImportRow.count({
    where: { classification: "EXISTS_IN_DB", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
  });
  const queueReview = await prisma.medicineImportRow.count({
    where: { classification: "NEEDS_REVIEW", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
  });

  return {
    listings: {
      active: listingsActive,
      inactive: listingsInactive,
      archived: listingsArchived,
      importedLineage: listingsImportedLineage,
      manualApprox: listingsManualApprox,
      prescriptionLinked: listingsPrescriptionLinked,
      totalNonArchived: listingsActive + listingsInactive,
    },
    masters: { generics, brands, manufacturers, dosageForms, presentations },
    imports: {
      recentBatches: batchesRecent,
      failedLast7Days: failedBatches,
      partialAppliedLast7Days,
      batchesApplying,
      batchesApplyingStuck,
    },
    reviewQueues: {
      needsAttentionRows: reviewRows,
      invalid: queueInvalid,
      duplicateInFile: queueDup,
      existsInDb: queueExists,
      needsReview: queueReview,
    },
  };
}

export async function getReviewQueuesDetail() {
  const [invalid, duplicateInFile, existsInDb, needsReview] = await Promise.all([
    prisma.medicineImportRow.count({
      where: { classification: "INVALID", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
    }),
    prisma.medicineImportRow.count({
      where: { classification: "DUPLICATE_IN_FILE", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
    }),
    prisma.medicineImportRow.count({
      where: { classification: "EXISTS_IN_DB", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
    }),
    prisma.medicineImportRow.count({
      where: { classification: "NEEDS_REVIEW", batch: { status: { notIn: ["APPLIED", "CANCELLED"] } } },
    }),
  ]);
  return { invalid, duplicateInFile, existsInDb, needsReview };
}

const listingInclude = {
  country: { select: { id: true, code: true, name: true } },
  brand: { select: { id: true, displayName: true, manufacturer: { select: { id: true, displayName: true } } } },
  presentation: {
    select: {
      id: true,
      strengthDisplay: true,
      generic: { select: { id: true, displayName: true, normalizedKey: true } },
      dosageForm: { select: { id: true, displayName: true, normalizedKey: true } },
    },
  },
} as const;

export type CountryListingFilterParams = {
  countryId?: number;
  q?: string;
  isActive?: boolean;
  includeArchived?: boolean;
  hasPrescriptions?: boolean;
  brandQ?: string;
  genericQ?: string;
  dosageFormQ?: string;
  strengthQ?: string;
  manufacturerQ?: string;
  packageQ?: string;
  sourceType?: "imported" | "manual";
  importBatchId?: number;
  /** Exact master-data filters (country catalog scope). */
  genericId?: number;
  brandId?: number;
  dosageFormId?: number;
  manufacturerId?: number;
  /** ISO date (YYYY-MM-DD) — listing.createdAt */
  listingCreatedAtFrom?: string;
  listingCreatedAtTo?: string;
  /** ISO date — listing.updatedAt */
  listingUpdatedAtFrom?: string;
  listingUpdatedAtTo?: string;
  /** ISO date — first import batch createdAt */
  firstBatchCreatedAtFrom?: string;
  firstBatchCreatedAtTo?: string;
  /** Filter by first batch uploader */
  firstBatchUploadedByUserId?: number;
  /** Comma flags: genericFamily, brandVariants, dosageSiblings (requires countryId + anchor entity picks). */
  relatedExpand?: string;
};

function parseIsoDayStart(s: string | undefined): Date | undefined {
  if (!s || !String(s).trim()) return undefined;
  const d = new Date(String(s).trim());
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseIsoDayEnd(s: string | undefined): Date | undefined {
  if (!s || !String(s).trim()) return undefined;
  const d = new Date(String(s).trim());
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseRelatedExpandFlags(s: string | undefined): Set<string> {
  return new Set(
    String(s || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

/** Base filters excluding exact entity IDs (generic/brand/form/manufacturer). */
function buildCountryListingBaseAndArray(params: CountryListingFilterParams): object[] {
  const AND: object[] = [];
  if (params.countryId != null) AND.push({ countryId: params.countryId });
  if (params.isActive !== undefined) AND.push({ isActive: params.isActive });
  if (!params.includeArchived) AND.push({ archivedAt: null });
  const q = (params.q || "").trim();
  if (q.length >= 1) {
    AND.push({
      OR: [
        { packageMarkDisplay: { contains: q, mode: "insensitive" } },
        { packageMarkNormalized: { contains: q, mode: "insensitive" } },
        { importFingerprint: { contains: q } },
        { brand: { displayName: { contains: q, mode: "insensitive" } } },
        { presentation: { generic: { displayName: { contains: q, mode: "insensitive" } } } },
        { presentation: { strengthDisplay: { contains: q, mode: "insensitive" } } },
        { presentation: { dosageForm: { displayName: { contains: q, mode: "insensitive" } } } },
        { brand: { manufacturer: { displayName: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const fieldContains = (s: string | undefined, build: (t: string) => object) => {
    const t = (s || "").trim();
    if (t.length >= 1) AND.push(build(t));
  };
  fieldContains(params.brandQ, (t) => ({ brand: { displayName: { contains: t, mode: "insensitive" } } }));
  fieldContains(params.genericQ, (t) => ({
    presentation: { generic: { displayName: { contains: t, mode: "insensitive" } } },
  }));
  fieldContains(params.dosageFormQ, (t) => ({
    presentation: { dosageForm: { displayName: { contains: t, mode: "insensitive" } } },
  }));
  fieldContains(params.strengthQ, (t) => ({
    presentation: { strengthDisplay: { contains: t, mode: "insensitive" } },
  }));
  fieldContains(params.manufacturerQ, (t) => ({
    brand: { manufacturer: { displayName: { contains: t, mode: "insensitive" } } },
  }));
  fieldContains(params.packageQ, (t) => ({ packageMarkDisplay: { contains: t, mode: "insensitive" } }));

  if (params.sourceType === "imported") AND.push({ firstImportBatchId: { not: null } });
  if (params.sourceType === "manual") AND.push({ firstImportBatchId: null });

  if (params.importBatchId != null && Number.isFinite(params.importBatchId)) {
    const bid = Math.floor(params.importBatchId);
    AND.push({ OR: [{ firstImportBatchId: bid }, { lastImportBatchId: bid }] });
  }

  if (params.hasPrescriptions === true) AND.push({ prescriptionItems: { some: {} } });
  if (params.hasPrescriptions === false) AND.push({ prescriptionItems: { none: {} } });

  const cFrom = parseIsoDayStart(params.listingCreatedAtFrom);
  const cTo = parseIsoDayEnd(params.listingCreatedAtTo);
  if (cFrom || cTo) {
    AND.push({
      createdAt: {
        ...(cFrom ? { gte: cFrom } : {}),
        ...(cTo ? { lte: cTo } : {}),
      },
    });
  }
  const uFrom = parseIsoDayStart(params.listingUpdatedAtFrom);
  const uTo = parseIsoDayEnd(params.listingUpdatedAtTo);
  if (uFrom || uTo) {
    AND.push({
      updatedAt: {
        ...(uFrom ? { gte: uFrom } : {}),
        ...(uTo ? { lte: uTo } : {}),
      },
    });
  }

  if (params.firstBatchUploadedByUserId != null && Number.isFinite(params.firstBatchUploadedByUserId)) {
    AND.push({ firstBatch: { uploadedByUserId: Math.floor(params.firstBatchUploadedByUserId) } });
  }
  const fbFrom = parseIsoDayStart(params.firstBatchCreatedAtFrom);
  const fbTo = parseIsoDayEnd(params.firstBatchCreatedAtTo);
  if (fbFrom || fbTo) {
    AND.push({
      firstBatch: {
        createdAt: {
          ...(fbFrom ? { gte: fbFrom } : {}),
          ...(fbTo ? { lte: fbTo } : {}),
        },
      },
    });
  }

  return AND;
}

function buildCountryListingEntityAndArray(params: CountryListingFilterParams): object[] {
  const AND: object[] = [];
  if (params.genericId != null && Number.isFinite(params.genericId)) {
    AND.push({ presentation: { genericId: Math.floor(params.genericId) } });
  }
  if (params.brandId != null && Number.isFinite(params.brandId)) {
    AND.push({ brandId: Math.floor(params.brandId) });
  }
  if (params.dosageFormId != null && Number.isFinite(params.dosageFormId)) {
    AND.push({ presentation: { dosageFormId: Math.floor(params.dosageFormId) } });
  }
  if (params.manufacturerId != null && Number.isFinite(params.manufacturerId)) {
    AND.push({ brand: { manufacturerId: Math.floor(params.manufacturerId) } });
  }
  return AND;
}

async function listingRelatedExpansionOrs(
  countryId: number,
  params: CountryListingFilterParams,
  flags: Set<string>
): Promise<object[]> {
  const ors: object[] = [];
  const gid = params.genericId != null && Number.isFinite(params.genericId) ? Math.floor(params.genericId) : null;
  const bid = params.brandId != null && Number.isFinite(params.brandId) ? Math.floor(params.brandId) : null;
  const dfid = params.dosageFormId != null && Number.isFinite(params.dosageFormId) ? Math.floor(params.dosageFormId) : null;

  if (flags.has("genericFamily") && bid != null) {
    const rows = await prisma.countryMedicineBrand.findMany({
      where: { countryId, brandId: bid },
      select: { presentation: { select: { genericId: true } } },
    });
    const gids = [...new Set(rows.map((r: { presentation: { genericId: number } }) => r.presentation.genericId))];
    if (gids.length) ors.push({ countryId, presentation: { genericId: { in: gids } } });
  }
  if (flags.has("brandVariants") && gid != null) {
    const rows = await prisma.countryMedicineBrand.findMany({
      where: { countryId, presentation: { genericId: gid } },
      select: { brandId: true },
    });
    const bids = [...new Set(rows.map((r: { brandId: number }) => r.brandId))];
    if (bids.length) ors.push({ countryId, brandId: { in: bids } });
  }
  if (flags.has("dosageSiblings")) {
    if (gid != null) {
      const rows = await prisma.countryMedicineBrand.findMany({
        where: { countryId, presentation: { genericId: gid } },
        select: { presentation: { select: { dosageFormId: true } } },
      });
      const dfids = [...new Set(rows.map((r: { presentation: { dosageFormId: number } }) => r.presentation.dosageFormId))];
      if (dfids.length) ors.push({ countryId, presentation: { dosageFormId: { in: dfids } } });
    } else if (dfid != null) {
      ors.push({ countryId, presentation: { dosageFormId: dfid } });
    }
  }
  return ors;
}

/** Shared filters for listings list + CSV export (supports related OR expansion). */
async function buildCountryListingWhereResolved(params: CountryListingFilterParams): Promise<object> {
  const flags = parseRelatedExpandFlags(params.relatedExpand);
  const activeExpandFlags = new Set([...flags].filter((f) => f !== "indicationFamily"));
  const baseAnd = buildCountryListingBaseAndArray(params);
  const entityAnd = buildCountryListingEntityAndArray(params);
  const countryId = params.countryId != null && Number.isFinite(params.countryId) ? Math.floor(params.countryId) : null;

  const hasEntity = entityAnd.length > 0;
  const useExpand = activeExpandFlags.size > 0 && countryId != null && hasEntity;

  if (useExpand) {
    const expansions = await listingRelatedExpansionOrs(countryId, params, activeExpandFlags);
    const parts = [...baseAnd];
    if (expansions.length) {
      parts.push({
        OR: [{ AND: entityAnd }, ...expansions],
      });
    } else {
      parts.push(...entityAnd);
    }
    return parts.length ? { AND: parts } : {};
  }

  const AND = [...baseAnd, ...entityAnd];
  return AND.length ? { AND } : {};
}

export async function listCountryListings(
  params: CountryListingFilterParams & {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: string;
  }
) {
  const page = asPosInt(params.page, 1);
  const limit = Math.min(100, asPosInt(params.limit, 25));
  const skip = (page - 1) * limit;

  const where = await buildCountryListingWhereResolved({
    countryId: params.countryId,
    q: params.q,
    isActive: params.isActive,
    includeArchived: params.includeArchived,
    hasPrescriptions: params.hasPrescriptions,
    brandQ: params.brandQ,
    genericQ: params.genericQ,
    dosageFormQ: params.dosageFormQ,
    strengthQ: params.strengthQ,
    manufacturerQ: params.manufacturerQ,
    packageQ: params.packageQ,
    sourceType: params.sourceType,
    importBatchId: params.importBatchId,
    genericId: params.genericId,
    brandId: params.brandId,
    dosageFormId: params.dosageFormId,
    manufacturerId: params.manufacturerId,
    listingCreatedAtFrom: params.listingCreatedAtFrom,
    listingCreatedAtTo: params.listingCreatedAtTo,
    listingUpdatedAtFrom: params.listingUpdatedAtFrom,
    listingUpdatedAtTo: params.listingUpdatedAtTo,
    firstBatchCreatedAtFrom: params.firstBatchCreatedAtFrom,
    firstBatchCreatedAtTo: params.firstBatchCreatedAtTo,
    firstBatchUploadedByUserId: params.firstBatchUploadedByUserId,
    relatedExpand: params.relatedExpand,
  });

  const dir = params.sortDir === "asc" ? "asc" : "desc";
  let orderBy: object | object[] = { id: dir };
  const sb = (params.sortBy || "id").toLowerCase();
  if (sb === "createdat") orderBy = { createdAt: dir };
  else if (sb === "countryid") orderBy = { countryId: dir };
  else orderBy = { id: dir };

  const [rows, total] = await Promise.all([
    prisma.countryMedicineBrand.findMany({
      where,
      include: {
        ...listingInclude,
        _count: { select: { prescriptionItems: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.countryMedicineBrand.count({ where }),
  ]);

  return {
    items: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function listMedicineMasterAuditLogs(params: {
  entityType: string;
  entityId: number;
  page?: number;
  limit?: number;
}) {
  const page = asPosInt(params.page, 1);
  const limit = Math.min(100, asPosInt(params.limit, 30));
  const entityType = (params.entityType || "").trim();
  if (!entityType) throw new Error("entityType is required");
  if (params.entityId == null || !Number.isFinite(Number(params.entityId))) throw new Error("entityId is required");

  const where = { entityType, entityId: params.entityId };

  const [items, total] = await Promise.all([
    prisma.medicineMasterAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            auth: { select: { email: true } },
            profile: { select: { displayName: true } },
          },
        },
      },
    }),
    prisma.medicineMasterAuditLog.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

const relatedListingSelect = {
  id: true,
  isActive: true,
  archivedAt: true,
  packageMarkDisplay: true,
  importFingerprint: true,
  firstImportBatchId: true,
  brand: { select: { id: true, displayName: true } },
  presentation: {
    select: {
      id: true,
      strengthDisplay: true,
      generic: { select: { id: true, displayName: true } },
      dosageForm: { select: { id: true, displayName: true } },
    },
  },
  _count: { select: { prescriptionItems: true } },
} as const;

export async function getCountryListingById(id: number) {
  const row = await prisma.countryMedicineBrand.findUnique({
    where: { id },
    include: {
      ...listingInclude,
      firstBatch: { select: { id: true, filename: true, status: true } },
      lastBatch: { select: { id: true, filename: true, status: true } },
    },
  });
  if (!row) return null;
  const rxCount = await prisma.prescriptionItem.count({ where: { countryMedicineBrandId: id } });

  const genericId = row.presentation.generic.id;
  const dosageFormId = row.presentation.dosageForm.id;
  const brandId = row.brandId;
  const countryId = row.countryId;

  const relBase = { id: { not: id }, countryId };
  const [sameGeneric, sameBrand, sameDosageForm] = await Promise.all([
    prisma.countryMedicineBrand.findMany({
      where: { ...relBase, presentation: { genericId } },
      orderBy: { id: "asc" },
      take: 80,
      select: relatedListingSelect,
    }),
    prisma.countryMedicineBrand.findMany({
      where: { ...relBase, brandId },
      orderBy: { id: "asc" },
      take: 80,
      select: relatedListingSelect,
    }),
    prisma.countryMedicineBrand.findMany({
      where: { ...relBase, presentation: { dosageFormId } },
      orderBy: { id: "asc" },
      take: 80,
      select: relatedListingSelect,
    }),
  ]);

  return {
    ...row,
    prescriptionItemCount: rxCount,
    relatedMedicines: {
      sameGeneric,
      sameBrand,
      sameDosageForm,
      /** Reserved: master schema has no indication on presentations yet. */
      sameIndication: [] as never[],
    },
  };
}

async function buildNormalizedFromGraph(
  countryId: number,
  presentationId: number,
  brandId: number,
  packageMarkDisplay: string,
  packageMarkNormalized: string
): Promise<{ n: NormalizedMedicineRow; fingerprint: string }> {
  const pres = await prisma.medicinePresentation.findFirst({
    where: { id: presentationId, isActive: true, archivedAt: null },
    include: { generic: true, dosageForm: true },
  });
  const brand = await prisma.medicineBrand.findFirst({
    where: { id: brandId, isActive: true, archivedAt: null },
    include: { manufacturer: true },
  });
  if (!pres || !brand) throw new Error("Presentation or brand not found or inactive/archived");
  if (!pres.generic.isActive || pres.generic.archivedAt) throw new Error("Generic inactive or archived");
  if (!pres.dosageForm.isActive || pres.dosageForm.archivedAt) throw new Error("Dosage form inactive or archived");
  if (!brand.manufacturer.isActive || brand.manufacturer.archivedAt) throw new Error("Manufacturer inactive or archived");

  const n: NormalizedMedicineRow = {
    genericDisplay: normalizeDisplay(pres.generic.displayName),
    genericKey: pres.generic.normalizedKey,
    brandDisplay: normalizeDisplay(brand.displayName),
    brandKey: brand.normalizedKey,
    dosageFormDisplay: normalizeDisplay(pres.dosageForm.displayName),
    dosageFormKey: pres.dosageForm.normalizedKey,
    strengthDisplay: normalizeDisplay(pres.strengthDisplay),
    strengthKey: pres.strengthNormalizedKey,
    manufacturerDisplay: normalizeDisplay(brand.manufacturer.displayName),
    manufacturerKey: brand.manufacturer.normalizedKey,
    packageMarkDisplay: normalizeDisplay(packageMarkDisplay),
    packageKey: normalizeKey(packageMarkNormalized || packageMarkDisplay),
  };
  const fingerprint = buildImportFingerprint(countryId, n);
  return { n, fingerprint };
}

export async function previewCountryListing(body: {
  countryId: number;
  presentationId: number;
  brandId: number;
  packageMarkDisplay?: string;
  packageMarkNormalized?: string;
}) {
  const pkgDisp = body.packageMarkDisplay ?? "";
  const pkgNorm = body.packageMarkNormalized ?? normalizeKey(pkgDisp);
  const { n, fingerprint } = await buildNormalizedFromGraph(
    body.countryId,
    body.presentationId,
    body.brandId,
    pkgDisp,
    pkgNorm
  );
  const duplicate = await prisma.countryMedicineBrand.findUnique({
    where: { countryId_importFingerprint: { countryId: body.countryId, importFingerprint: fingerprint } },
    select: {
      id: true,
      packageMarkDisplay: true,
      isActive: true,
      brand: { select: { displayName: true } },
      presentation: {
        select: { strengthDisplay: true, generic: { select: { displayName: true } }, dosageForm: { select: { displayName: true } } },
      },
    },
  });
  return { fingerprint, normalizedPreview: n, duplicateListing: duplicate };
}

export async function createCountryListing(
  userId: number,
  body: {
    countryId: number;
    presentationId: number;
    brandId: number;
    packageMarkDisplay?: string;
    packageMarkNormalized?: string;
    isActive?: boolean;
    workspaceProfileJson?: object | null;
    reviewStatus?: string | null;
  }
) {
  const pkgDisp = body.packageMarkDisplay ?? "";
  const pkgNorm = body.packageMarkNormalized ?? normalizeKey(pkgDisp);
  const { fingerprint } = await buildNormalizedFromGraph(body.countryId, body.presentationId, body.brandId, pkgDisp, pkgNorm);

  const existing = await prisma.countryMedicineBrand.findUnique({
    where: { countryId_importFingerprint: { countryId: body.countryId, importFingerprint: fingerprint } },
  });
  if (existing) throw new Error("A catalog listing with this fingerprint already exists for this country");

  const row = await prisma.countryMedicineBrand.create({
    data: {
      countryId: body.countryId,
      presentationId: body.presentationId,
      brandId: body.brandId,
      packageMarkDisplay: normalizeDisplay(pkgDisp),
      packageMarkNormalized: pkgNorm,
      importFingerprint: fingerprint,
      isActive: body.isActive !== false,
      workspaceProfileJson: body.workspaceProfileJson === undefined ? undefined : (body.workspaceProfileJson as object | null),
      reviewStatus: body.reviewStatus != null ? String(body.reviewStatus).slice(0, 32) : undefined,
    },
    include: listingInclude,
  });
  await writeAudit(userId, "CountryMedicineBrand", row.id, "CREATE", undefined, row);
  return row;
}

export async function patchCountryListing(
  userId: number,
  id: number,
  body: {
    packageMarkDisplay?: string;
    packageMarkNormalized?: string;
    isActive?: boolean;
    deactivatedReason?: string | null;
    workspaceProfileJson?: object | null;
    reviewStatus?: string | null;
  }
) {
  const cur = await prisma.countryMedicineBrand.findUnique({ where: { id } });
  if (!cur || cur.archivedAt) throw new Error("Listing not found or archived");

  let data: Record<string, unknown> = {};
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.deactivatedReason !== undefined) data.deactivatedReason = body.deactivatedReason;
  if (body.workspaceProfileJson !== undefined) data.workspaceProfileJson = body.workspaceProfileJson;
  if (body.reviewStatus !== undefined) {
    data.reviewStatus = body.reviewStatus == null ? null : String(body.reviewStatus).slice(0, 32);
  }

  if (body.packageMarkDisplay !== undefined || body.packageMarkNormalized !== undefined) {
    const pkgDisp = body.packageMarkDisplay ?? cur.packageMarkDisplay;
    const pkgNorm = body.packageMarkNormalized ?? cur.packageMarkNormalized;
    const { fingerprint } = await buildNormalizedFromGraph(cur.countryId, cur.presentationId, cur.brandId, pkgDisp, pkgNorm);
    const clash = await prisma.countryMedicineBrand.findFirst({
      where: { countryId: cur.countryId, importFingerprint: fingerprint, NOT: { id } },
    });
    if (clash) throw new Error("Updated package would duplicate another listing fingerprint");
    data.packageMarkDisplay = normalizeDisplay(pkgDisp);
    data.packageMarkNormalized = pkgNorm;
    data.importFingerprint = fingerprint;
  }

  const row = await prisma.countryMedicineBrand.update({ where: { id }, data, include: listingInclude });
  await writeAudit(userId, "CountryMedicineBrand", id, "UPDATE", cur, row);
  return row;
}

export async function archiveCountryListing(userId: number, id: number, reason?: string) {
  const cur = await prisma.countryMedicineBrand.findUnique({ where: { id } });
  if (!cur) throw new Error("Not found");
  if (cur.archivedAt) return cur;
  const rx = await prisma.prescriptionItem.count({ where: { countryMedicineBrandId: id } });
  if (rx > 0) throw new Error("Cannot archive: prescription history references this listing");
  const row = await prisma.countryMedicineBrand.update({
    where: { id },
    data: { archivedAt: new Date(), archivedByUserId: userId, deactivatedReason: reason ?? "ARCHIVED", isActive: false },
    include: listingInclude,
  });
  await writeAudit(userId, "CountryMedicineBrand", id, "ARCHIVE", cur, row);
  return row;
}

export async function restoreCountryListing(userId: number, id: number) {
  const cur = await prisma.countryMedicineBrand.findUnique({ where: { id } });
  if (!cur) throw new Error("Not found");
  const row = await prisma.countryMedicineBrand.update({
    where: { id },
    data: { archivedAt: null, archivedByUserId: null, deactivatedReason: null },
    include: listingInclude,
  });
  await writeAudit(userId, "CountryMedicineBrand", id, "RESTORE", cur, row);
  return row;
}

const BULK_LISTING_MAX = 100;

export async function bulkMutateCountryListings(
  userId: number,
  body: { action: "deactivate" | "activate" | "archive"; ids: number[]; reason?: string }
) {
  const raw = Array.isArray(body.ids) ? body.ids : [];
  if (raw.length > BULK_LISTING_MAX) throw new Error(`Maximum ${BULK_LISTING_MAX} ids per bulk request`);
  const ids = [...new Set(raw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) throw new Error("At least one valid listing id is required");

  const failed: { id: number; message: string }[] = [];
  let ok = 0;

  for (const id of ids) {
    try {
      if (body.action === "deactivate") {
        await patchCountryListing(userId, id, {
          isActive: false,
          deactivatedReason: body.reason != null ? String(body.reason) : undefined,
        });
        ok += 1;
      } else if (body.action === "activate") {
        await patchCountryListing(userId, id, { isActive: true, deactivatedReason: null });
        ok += 1;
      } else if (body.action === "archive") {
        await archiveCountryListing(userId, id, body.reason != null ? String(body.reason) : "BULK_ARCHIVE");
        ok += 1;
      } else {
        throw new Error("Invalid action");
      }
    } catch (e: any) {
      failed.push({ id, message: String(e?.message || e || "Failed") });
    }
  }

  return { ok, failed, processed: ids.length };
}

/** Master entity list helpers */
export async function listGenerics(q: { search?: string; page?: number; limit?: number; includeInactive?: boolean }) {
  const page = asPosInt(q.page, 1);
  const limit = Math.min(100, asPosInt(q.limit, 30));
  const where: Record<string, unknown> = { archivedAt: null };
  if (!q.includeInactive) where.isActive = true;
  const s = (q.search || "").trim();
  if (s) {
    where.OR = [
      { displayName: { contains: s, mode: "insensitive" } },
      { normalizedKey: { contains: normalizeKey(s) } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.medicineGeneric.findMany({ where, orderBy: { displayName: "asc" }, skip: (page - 1) * limit, take: limit }),
    prisma.medicineGeneric.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

export async function createGeneric(userId: number, displayName: string) {
  const dn = normalizeDisplay(displayName);
  const nk = normalizeKey(dn);
  if (!nk) throw new Error("Display name required");
  const row = await prisma.medicineGeneric.create({ data: { displayName: dn, normalizedKey: nk } });
  await writeAudit(userId, "MedicineGeneric", row.id, "CREATE", undefined, row);
  return row;
}

export async function patchGeneric(userId: number, id: number, body: { displayName?: string; isActive?: boolean; aliasesJson?: object }) {
  const cur = await prisma.medicineGeneric.findUnique({ where: { id } });
  if (!cur || cur.archivedAt) throw new Error("Not found");
  const data: Record<string, unknown> = {};
  if (body.displayName !== undefined) {
    const dn = normalizeDisplay(body.displayName);
    data.displayName = dn;
    data.normalizedKey = normalizeKey(dn);
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.aliasesJson !== undefined) data.aliasesJson = body.aliasesJson as object;
  const row = await prisma.medicineGeneric.update({ where: { id }, data });
  await writeAudit(userId, "MedicineGeneric", id, "UPDATE", cur, row);
  return row;
}

export async function archiveGeneric(userId: number, id: number) {
  const cur = await prisma.medicineGeneric.findUnique({ where: { id } });
  if (!cur) throw new Error("Not found");
  const presCount = await prisma.medicinePresentation.count({ where: { genericId: id } });
  if (presCount > 0) throw new Error("Cannot archive generic with presentations");
  const row = await prisma.medicineGeneric.update({
    where: { id },
    data: { archivedAt: new Date(), archivedByUserId: userId, isActive: false },
  });
  await writeAudit(userId, "MedicineGeneric", id, "ARCHIVE", cur, row);
  return row;
}

export async function listDosageForms(q: { search?: string; page?: number; limit?: number; includeInactive?: boolean }) {
  const page = asPosInt(q.page, 1);
  const limit = Math.min(100, asPosInt(q.limit, 30));
  const where: Record<string, unknown> = { archivedAt: null };
  if (!q.includeInactive) where.isActive = true;
  const s = (q.search || "").trim();
  if (s) where.OR = [{ displayName: { contains: s, mode: "insensitive" } }, { normalizedKey: { contains: normalizeKey(s) } }];
  const [items, total] = await Promise.all([
    prisma.medicineDosageForm.findMany({ where, orderBy: { displayName: "asc" }, skip: (page - 1) * limit, take: limit }),
    prisma.medicineDosageForm.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

export async function createDosageForm(userId: number, displayName: string) {
  const dn = normalizeDisplay(displayName);
  const nk = normalizeKey(dn);
  const row = await prisma.medicineDosageForm.create({ data: { displayName: dn, normalizedKey: nk } });
  await writeAudit(userId, "MedicineDosageForm", row.id, "CREATE", undefined, row);
  return row;
}

export async function patchDosageForm(userId: number, id: number, body: { displayName?: string; isActive?: boolean; aliasesJson?: object }) {
  const cur = await prisma.medicineDosageForm.findUnique({ where: { id } });
  if (!cur || cur.archivedAt) throw new Error("Not found");
  const data: Record<string, unknown> = {};
  if (body.displayName !== undefined) {
    data.displayName = normalizeDisplay(body.displayName);
    data.normalizedKey = normalizeKey(String(data.displayName));
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.aliasesJson !== undefined) data.aliasesJson = body.aliasesJson as object;
  const row = await prisma.medicineDosageForm.update({ where: { id }, data });
  await writeAudit(userId, "MedicineDosageForm", id, "UPDATE", cur, row);
  return row;
}

export async function archiveDosageForm(userId: number, id: number) {
  const cur = await prisma.medicineDosageForm.findUnique({ where: { id } });
  if (!cur) throw new Error("Not found");
  const n = await prisma.medicinePresentation.count({ where: { dosageFormId: id } });
  if (n > 0) throw new Error("Cannot archive: presentations use this form");
  const row = await prisma.medicineDosageForm.update({
    where: { id },
    data: { archivedAt: new Date(), archivedByUserId: userId, isActive: false },
  });
  await writeAudit(userId, "MedicineDosageForm", id, "ARCHIVE", cur, row);
  return row;
}

export async function listManufacturers(q: { search?: string; page?: number; limit?: number; includeInactive?: boolean }) {
  const page = asPosInt(q.page, 1);
  const limit = Math.min(100, asPosInt(q.limit, 30));
  const where: Record<string, unknown> = { archivedAt: null };
  if (!q.includeInactive) where.isActive = true;
  const s = (q.search || "").trim();
  if (s) where.OR = [{ displayName: { contains: s, mode: "insensitive" } }, { normalizedKey: { contains: normalizeKey(s) } }];
  const [items, total] = await Promise.all([
    prisma.medicineManufacturer.findMany({ where, orderBy: { displayName: "asc" }, skip: (page - 1) * limit, take: limit }),
    prisma.medicineManufacturer.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

export async function createManufacturer(userId: number, displayName: string) {
  const dn = normalizeDisplay(displayName);
  const nk = normalizeKey(dn);
  const row = await prisma.medicineManufacturer.create({ data: { displayName: dn, normalizedKey: nk, isSystem: false } });
  await writeAudit(userId, "MedicineManufacturer", row.id, "CREATE", undefined, row);
  return row;
}

export async function patchManufacturer(userId: number, id: number, body: { displayName?: string; isActive?: boolean }) {
  const cur = await prisma.medicineManufacturer.findUnique({ where: { id } });
  if (!cur || cur.archivedAt) throw new Error("Not found");
  if (cur.isSystem && body.displayName !== undefined) throw new Error("Cannot rename system manufacturer");
  const data: Record<string, unknown> = {};
  if (body.displayName !== undefined) {
    data.displayName = normalizeDisplay(body.displayName);
    data.normalizedKey = normalizeKey(String(data.displayName));
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  const row = await prisma.medicineManufacturer.update({ where: { id }, data });
  await writeAudit(userId, "MedicineManufacturer", id, "UPDATE", cur, row);
  return row;
}

export async function archiveManufacturer(userId: number, id: number) {
  const cur = await prisma.medicineManufacturer.findUnique({ where: { id } });
  if (!cur) throw new Error("Not found");
  if (cur.isSystem) throw new Error("Cannot archive system manufacturer");
  const n = await prisma.medicineBrand.count({ where: { manufacturerId: id } });
  if (n > 0) throw new Error("Cannot archive: brands reference this manufacturer");
  const row = await prisma.medicineManufacturer.update({
    where: { id },
    data: { archivedAt: new Date(), archivedByUserId: userId, isActive: false },
  });
  await writeAudit(userId, "MedicineManufacturer", id, "ARCHIVE", cur, row);
  return row;
}

export async function listBrands(q: { search?: string; manufacturerId?: number; page?: number; limit?: number; includeInactive?: boolean }) {
  const page = asPosInt(q.page, 1);
  const limit = Math.min(100, asPosInt(q.limit, 30));
  const where: Record<string, unknown> = { archivedAt: null };
  if (!q.includeInactive) where.isActive = true;
  if (q.manufacturerId != null) where.manufacturerId = q.manufacturerId;
  const s = (q.search || "").trim();
  if (s) where.OR = [{ displayName: { contains: s, mode: "insensitive" } }, { normalizedKey: { contains: normalizeKey(s) } }];
  const [items, total] = await Promise.all([
    prisma.medicineBrand.findMany({
      where,
      include: { manufacturer: { select: { id: true, displayName: true } } },
      orderBy: { displayName: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.medicineBrand.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

export async function createBrand(userId: number, manufacturerId: number, displayName: string) {
  const dn = normalizeDisplay(displayName);
  const nk = normalizeKey(dn);
  const row = await prisma.medicineBrand.create({ data: { manufacturerId, displayName: dn, normalizedKey: nk } });
  await writeAudit(userId, "MedicineBrand", row.id, "CREATE", undefined, row);
  return row;
}

export async function patchBrand(userId: number, id: number, body: { displayName?: string; isActive?: boolean; aliasesJson?: object }) {
  const cur = await prisma.medicineBrand.findUnique({ where: { id } });
  if (!cur || cur.archivedAt) throw new Error("Not found");
  const data: Record<string, unknown> = {};
  if (body.displayName !== undefined) {
    data.displayName = normalizeDisplay(body.displayName);
    data.normalizedKey = normalizeKey(String(data.displayName));
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.aliasesJson !== undefined) data.aliasesJson = body.aliasesJson as object;
  const row = await prisma.medicineBrand.update({ where: { id }, data });
  await writeAudit(userId, "MedicineBrand", id, "UPDATE", cur, row);
  return row;
}

export async function archiveBrand(userId: number, id: number) {
  const cur = await prisma.medicineBrand.findUnique({ where: { id } });
  if (!cur) throw new Error("Not found");
  const n = await prisma.countryMedicineBrand.count({ where: { brandId: id } });
  if (n > 0) throw new Error("Cannot archive: country listings reference this brand");
  const row = await prisma.medicineBrand.update({
    where: { id },
    data: { archivedAt: new Date(), archivedByUserId: userId, isActive: false },
  });
  await writeAudit(userId, "MedicineBrand", id, "ARCHIVE", cur, row);
  return row;
}

export async function listPresentations(q: {
  search?: string;
  genericId?: number;
  dosageFormId?: number;
  page?: number;
  limit?: number;
  includeInactive?: boolean;
}) {
  const page = asPosInt(q.page, 1);
  const limit = Math.min(100, asPosInt(q.limit, 30));
  const where: Record<string, unknown> = { archivedAt: null };
  if (!q.includeInactive) where.isActive = true;
  if (q.genericId != null) where.genericId = q.genericId;
  if (q.dosageFormId != null) where.dosageFormId = q.dosageFormId;
  const s = (q.search || "").trim();
  if (s) where.OR = [{ strengthDisplay: { contains: s, mode: "insensitive" } }, { strengthNormalizedKey: { contains: normalizeKey(s) } }];
  const [items, total] = await Promise.all([
    prisma.medicinePresentation.findMany({
      where,
      include: {
        generic: { select: { id: true, displayName: true } },
        dosageForm: { select: { id: true, displayName: true } },
      },
      orderBy: [{ genericId: "asc" }, { strengthDisplay: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.medicinePresentation.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

export async function createPresentation(
  userId: number,
  body: { genericId: number; dosageFormId: number; strengthDisplay: string; strengthNormalizedKey?: string }
) {
  const sd = normalizeDisplay(body.strengthDisplay);
  const sk = body.strengthNormalizedKey ? normalizeKey(body.strengthNormalizedKey) : normalizeKey(sd);
  const row = await prisma.medicinePresentation.create({
    data: { genericId: body.genericId, dosageFormId: body.dosageFormId, strengthDisplay: sd, strengthNormalizedKey: sk },
  });
  await writeAudit(userId, "MedicinePresentation", row.id, "CREATE", undefined, row);
  return row;
}

export async function patchPresentation(userId: number, id: number, body: { strengthDisplay?: string; strengthNormalizedKey?: string; isActive?: boolean }) {
  const cur = await prisma.medicinePresentation.findUnique({ where: { id } });
  if (!cur || cur.archivedAt) throw new Error("Not found");
  const data: Record<string, unknown> = {};
  if (body.strengthDisplay !== undefined) data.strengthDisplay = normalizeDisplay(body.strengthDisplay);
  if (body.strengthNormalizedKey !== undefined) data.strengthNormalizedKey = normalizeKey(body.strengthNormalizedKey);
  if (body.strengthDisplay !== undefined && body.strengthNormalizedKey === undefined) {
    data.strengthNormalizedKey = normalizeKey(String(data.strengthDisplay));
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  const row = await prisma.medicinePresentation.update({ where: { id }, data });
  await writeAudit(userId, "MedicinePresentation", id, "UPDATE", cur, row);
  return row;
}

export async function archivePresentation(userId: number, id: number) {
  const cur = await prisma.medicinePresentation.findUnique({ where: { id } });
  if (!cur) throw new Error("Not found");
  const n = await prisma.countryMedicineBrand.count({ where: { presentationId: id } });
  if (n > 0) throw new Error("Cannot archive: country listings use this presentation");
  const row = await prisma.medicinePresentation.update({
    where: { id },
    data: { archivedAt: new Date(), archivedByUserId: userId, isActive: false },
  });
  await writeAudit(userId, "MedicinePresentation", id, "ARCHIVE", cur, row);
  return row;
}

export async function countryCatalogSummary(countryId: number) {
  const country = await prisma.country.findUnique({ where: { id: countryId }, select: { id: true, code: true, name: true, isActive: true } });
  if (!country) return null;
  const [active, inactive, archived] = await Promise.all([
    prisma.countryMedicineBrand.count({ where: { countryId, isActive: true, archivedAt: null } }),
    prisma.countryMedicineBrand.count({ where: { countryId, isActive: false, archivedAt: null } }),
    prisma.countryMedicineBrand.count({ where: { countryId, archivedAt: { not: null } } }),
  ]);
  return { country, listings: { active, inactive, archived } };
}

export async function exportListingsCsv(params: CountryListingFilterParams) {
  const where = await buildCountryListingWhereResolved({
    countryId: params.countryId,
    q: params.q,
    isActive: params.isActive,
    includeArchived: params.includeArchived,
    hasPrescriptions: params.hasPrescriptions,
    brandQ: params.brandQ,
    genericQ: params.genericQ,
    dosageFormQ: params.dosageFormQ,
    strengthQ: params.strengthQ,
    manufacturerQ: params.manufacturerQ,
    packageQ: params.packageQ,
    sourceType: params.sourceType,
    importBatchId: params.importBatchId,
    genericId: params.genericId,
    brandId: params.brandId,
    dosageFormId: params.dosageFormId,
    manufacturerId: params.manufacturerId,
    listingCreatedAtFrom: params.listingCreatedAtFrom,
    listingCreatedAtTo: params.listingCreatedAtTo,
    listingUpdatedAtFrom: params.listingUpdatedAtFrom,
    listingUpdatedAtTo: params.listingUpdatedAtTo,
    firstBatchCreatedAtFrom: params.firstBatchCreatedAtFrom,
    firstBatchCreatedAtTo: params.firstBatchCreatedAtTo,
    firstBatchUploadedByUserId: params.firstBatchUploadedByUserId,
    relatedExpand: params.relatedExpand,
  });
  const rows = await prisma.countryMedicineBrand.findMany({
    where,
    take: 50_000,
    orderBy: { id: "asc" },
    include: {
      country: { select: { code: true } },
      brand: { select: { displayName: true, manufacturer: { select: { displayName: true } } } },
      presentation: {
        select: {
          strengthDisplay: true,
          generic: { select: { displayName: true } },
          dosageForm: { select: { displayName: true } },
        },
      },
    },
  });
  const headers = [
    "countryCode",
    "genericName",
    "brandName",
    "dosageType",
    "strength",
    "manufacturer",
    "packageMark",
    "isActive",
    "archived",
    "fingerprint",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    lines.push(
      [
        esc(r.country.code),
        esc(r.presentation.generic.displayName),
        esc(r.brand.displayName),
        esc(r.presentation.dosageForm.displayName),
        esc(r.presentation.strengthDisplay),
        esc(r.brand.manufacturer.displayName),
        esc(r.packageMarkDisplay || ""),
        r.isActive ? "1" : "0",
        r.archivedAt ? "1" : "0",
        esc(r.importFingerprint),
      ].join(",")
    );
  }
  return lines.join("\n");
}
