/**
 * Country-scoped medicine reference catalog (imported CountryMedicineBrand listings).
 * Separate from org inventory (ProductVariant) and clinic pharmacy (ClinicalItemVariant).
 */
const prisma = require("../../../infrastructure/db/prismaClient").default ?? require("../../../infrastructure/db/prismaClient");

const MIN_QUERY_LEN = 2;
const MAX_LIMIT = 50;

function buildTextSearchOr(term: string) {
  const or: Record<string, unknown>[] = [
    { brand: { displayName: { contains: term, mode: "insensitive" } } },
    { brand: { manufacturer: { displayName: { contains: term, mode: "insensitive" } } } },
    { presentation: { generic: { displayName: { contains: term, mode: "insensitive" } } } },
    { presentation: { strengthDisplay: { contains: term, mode: "insensitive" } } },
    { presentation: { dosageForm: { displayName: { contains: term, mode: "insensitive" } } } },
    { packageMarkDisplay: { contains: term, mode: "insensitive" } },
  ];
  return or;
}

export type BranchMedicineCatalogContext = {
  branch: { orgId: number };
  countryId: number | null;
  countryCode: string | null;
  countryName: string | null;
  catalogAvailable: boolean;
  catalogBlockMessage: string | null;
};

/**
 * Branch → org → Country. Catalog is available only when org has a country and that country row is active.
 * Bangladesh (or any) listings are returned only when `countryId` matches that country — never cross-leaked via branch context.
 */
async function resolveMedicineCatalogContextForBranch(branchId: number): Promise<BranchMedicineCatalogContext | null> {
  const b = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true, org: { select: { countryId: true } } },
  });
  if (!b) return null;
  const base = {
    branch: { orgId: b.orgId },
    countryId: null as number | null,
    countryCode: null as string | null,
    countryName: null as string | null,
    catalogAvailable: false,
    catalogBlockMessage: null as string | null,
  };
  if (b.org.countryId == null) {
    return {
      ...base,
      catalogBlockMessage:
        "This clinic’s organization has no country assigned. Set the organization country in the owner panel so the correct national medicine catalog (e.g. Bangladesh) can be used.",
    };
  }
  const c = await prisma.country.findUnique({
    where: { id: b.org.countryId },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!c || !c.isActive) {
    return {
      ...base,
      catalogBlockMessage:
        "The organization’s country is inactive in the system; the national medicine catalog cannot be used until the country is active again.",
    };
  }
  return {
    branch: { orgId: b.orgId },
    countryId: c.id,
    countryCode: c.code,
    countryName: c.name,
    catalogAvailable: true,
    catalogBlockMessage: null,
  };
}

/** @deprecated Prefer resolveMedicineCatalogContextForBranch for notices and inactive-country handling. */
async function resolveCountryIdFromBranchId(branchId: number): Promise<{ countryId: number | null; orgId: number } | null> {
  const ctx = await resolveMedicineCatalogContextForBranch(branchId);
  if (!ctx) return null;
  return { countryId: ctx.catalogAvailable ? ctx.countryId : null, orgId: ctx.branch.orgId };
}

async function resolveCountryIdByAdminParams(params: { countryId?: number; countryCode?: string }): Promise<number | null> {
  if (params.countryId != null && Number.isFinite(Number(params.countryId))) {
    const id = Number(params.countryId);
    const row = await prisma.country.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!row?.isActive) return null;
    return row.id;
  }
  const code = params.countryCode != null ? String(params.countryCode).trim().toUpperCase() : "";
  if (!code) return null;
  const row = await prisma.country.findFirst({
    where: { code },
    select: { id: true, isActive: true },
  });
  if (!row || !row.isActive) return null;
  return row.id;
}

async function searchCountryMedicineCatalog(opts: {
  countryId: number;
  q: string;
  genericId?: number;
  manufacturerId?: number;
  dosageFormId?: number;
  strength?: string;
  page?: number;
  limit?: number;
}) {
  const term = (opts.q || "").trim();
  if (term.length < MIN_QUERY_LEN) {
    return { items: [], pagination: { page: 1, limit: opts.limit ?? 20, total: 0, totalPages: 0 } };
  }
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? 20));
  const skip = (page - 1) * limit;

  const AND: Record<string, unknown>[] = [
    { countryId: opts.countryId },
    { isActive: true },
    { archivedAt: null },
    {
      presentation: {
        isActive: true,
        archivedAt: null,
        generic: { isActive: true, archivedAt: null },
        dosageForm: { isActive: true, archivedAt: null },
      },
    },
    { brand: { isActive: true, archivedAt: null, manufacturer: { isActive: true, archivedAt: null } } },
    { OR: buildTextSearchOr(term) },
  ];
  if (opts.genericId != null && Number.isFinite(opts.genericId)) {
    AND.push({ presentation: { genericId: opts.genericId } });
  }
  if (opts.manufacturerId != null && Number.isFinite(opts.manufacturerId)) {
    AND.push({ brand: { manufacturerId: opts.manufacturerId } });
  }
  if (opts.dosageFormId != null && Number.isFinite(opts.dosageFormId)) {
    AND.push({ presentation: { dosageFormId: opts.dosageFormId } });
  }
  if (opts.strength && String(opts.strength).trim()) {
    AND.push({
      presentation: { strengthDisplay: { contains: String(opts.strength).trim(), mode: "insensitive" } },
    });
  }

  const where = { AND };

  const [rows, total] = await Promise.all([
    prisma.countryMedicineBrand.findMany({
      where,
      select: {
        id: true,
        countryId: true,
        packageMarkDisplay: true,
        isActive: true,
        brand: { select: { displayName: true, manufacturer: { select: { displayName: true } } } },
        presentation: {
          select: {
            strengthDisplay: true,
            generic: { select: { displayName: true } },
            dosageForm: { select: { displayName: true } },
          },
        },
      },
      orderBy: [{ brand: { displayName: "asc" } }, { id: "asc" }],
      skip,
      take: limit,
    }),
    prisma.countryMedicineBrand.count({ where }),
  ]);

  const items = rows.map((r) => ({
    countryMedicineBrandId: r.id,
    source: "IMPORTED_CATALOG",
    countryId: r.countryId,
    brandName: r.brand.displayName,
    manufacturerName: r.brand.manufacturer.displayName,
    genericName: r.presentation.generic.displayName,
    strengthDisplay: r.presentation.strengthDisplay,
    dosageForm: r.presentation.dosageForm.displayName,
    packageMarkDisplay: r.packageMarkDisplay || null,
    isActive: r.isActive,
  }));

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function getCountryMedicineBrandDetail(countryId: number, brandListingId: number) {
  const row = await prisma.countryMedicineBrand.findFirst({
    where: { id: brandListingId, countryId, isActive: true, archivedAt: null },
    select: {
      id: true,
      countryId: true,
      presentationId: true,
      brandId: true,
      packageMarkDisplay: true,
      importFingerprint: true,
      country: { select: { code: true, name: true, isActive: true } },
      brand: {
        select: {
          id: true,
          displayName: true,
          manufacturerId: true,
          manufacturer: { select: { id: true, displayName: true } },
        },
      },
      presentation: {
        select: {
          id: true,
          strengthDisplay: true,
          generic: { select: { id: true, displayName: true } },
          dosageForm: { select: { id: true, displayName: true } },
        },
      },
    },
  });
  if (!row) return null;
  if (!row.country?.isActive) return null;
  return {
    countryMedicineBrandId: row.id,
    source: "IMPORTED_CATALOG",
    countryId: row.countryId,
    countryCode: row.country?.code ?? null,
    countryName: row.country?.name ?? null,
    brandName: row.brand.displayName,
    brandId: row.brandId,
    manufacturerName: row.brand.manufacturer.displayName,
    manufacturerId: row.brand.manufacturer.id,
    genericName: row.presentation.generic.displayName,
    genericId: row.presentation.generic.id,
    strengthDisplay: row.presentation.strengthDisplay,
    dosageForm: row.presentation.dosageForm.displayName,
    dosageFormId: row.presentation.dosageForm.id,
    presentationId: row.presentationId,
    packageMarkDisplay: row.packageMarkDisplay || null,
    importFingerprint: row.importFingerprint,
  };
}

/**
 * @returns Error message or null when all optional catalog refs are valid for the branch org country.
 */
async function validatePrescriptionItemsForBranch(
  branchId: number,
  items: Array<{ countryMedicineBrandId?: number | null }>
): Promise<string | null> {
  const ctx = await resolveMedicineCatalogContextForBranch(branchId);
  if (!ctx) return "Branch not found.";
  const anyCatalog = items.some((it) => it.countryMedicineBrandId != null);
  if (anyCatalog && !ctx.catalogAvailable) {
    return ctx.catalogBlockMessage || "The national medicine catalog is not available for this clinic.";
  }
  if (!ctx.catalogAvailable || ctx.countryId == null) return null;

  const parsed: number[] = [];
  for (const it of items) {
    if (it.countryMedicineBrandId == null) continue;
    const id = Number(it.countryMedicineBrandId);
    if (!Number.isFinite(id)) return "Invalid catalog medicine reference.";
    parsed.push(id);
  }
  const uniqueIds = [...new Set(parsed)];
  if (uniqueIds.length === 0) return null;
  const found = await prisma.countryMedicineBrand.findMany({
    where: { id: { in: uniqueIds }, countryId: ctx.countryId, isActive: true, archivedAt: null },
    select: { id: true },
  });
  if (found.length !== uniqueIds.length) {
    return "One or more medicines are not in this branch country’s catalog, are inactive, or do not match the organization’s country.";
  }
  return null;
}

async function assertDoctorBranchCatalogAccess(userId: number, branchId: number): Promise<boolean> {
  const n = await prisma.clinicStaffProfile.count({
    where: { staffType: "DOCTOR", branchMember: { userId, branchId } },
  });
  return n > 0;
}

async function getCountryDisplayMeta(countryId: number): Promise<{ code: string | null; name: string | null }> {
  const c = await prisma.country.findUnique({
    where: { id: countryId },
    select: { code: true, name: true },
  });
  return { code: c?.code ?? null, name: c?.name ?? null };
}

function rxCatalogValidationError(message: string) {
  const e: Error & { code?: string } = new Error(message);
  e.code = "RX_CATALOG_VALIDATION";
  return e;
}

function visitNotFoundError() {
  const e: Error & { code?: string } = new Error("Visit not found");
  e.code = "VISIT_NOT_FOUND";
  return e;
}

module.exports = {
  MIN_QUERY_LEN,
  MAX_LIMIT,
  resolveCountryIdFromBranchId,
  resolveMedicineCatalogContextForBranch,
  resolveCountryIdByAdminParams,
  searchCountryMedicineCatalog,
  getCountryMedicineBrandDetail,
  getCountryDisplayMeta,
  validatePrescriptionItemsForBranch,
  assertDoctorBranchCatalogAccess,
  rxCatalogValidationError,
  visitNotFoundError,
};

export {};
