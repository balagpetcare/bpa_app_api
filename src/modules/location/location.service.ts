import { cached, clearLocationCacheByPrefix } from "./location.cache";
import {
  getSelectionNodes,
  listAreasRepo,
  listDistrictsRepo,
  listDivisionsRepo,
  listUnionsRepo,
  listUpazilasRepo,
  searchLocationRepo,
} from "./location.repository";
import { asIntOrNull, buildPageMeta, normalizeLocale } from "./location.validators";

function label(row: any, locale: "en" | "bn") {
  if (!row) return null;
  return locale === "bn" ? row.nameBn || row.nameEn : row.nameEn || row.nameBn;
}

function withLabel(rows: any[], locale: "en" | "bn") {
  return (rows || []).map((row) => ({ ...row, label: label(row, locale) }));
}

function cacheKey(prefix: string, input: any) {
  return `location:${prefix}:${JSON.stringify(input || {})}`;
}

export async function listDivisions(prisma: any, input: any = {}) {
  const locale = normalizeLocale(input.locale);
  const data = await cached(cacheKey("divisions", { ...input, locale }), 300, async () => {
    const result = await listDivisionsRepo(prisma, input);
    return {
      data: withLabel(result.items, locale),
      meta: buildPageMeta(result.page, result.pageSize, result.total),
    };
  });
  return data;
}

export async function listDistricts(prisma: any, input: any = {}) {
  const locale = normalizeLocale(input.locale);
  const data = await cached(cacheKey("districts", { ...input, locale }), 300, async () => {
    const result = await listDistrictsRepo(prisma, input);
    return {
      data: withLabel(result.items, locale),
      meta: buildPageMeta(result.page, result.pageSize, result.total),
    };
  });
  return data;
}

export async function listUpazilas(prisma: any, input: any = {}) {
  const locale = normalizeLocale(input.locale);
  const data = await cached(cacheKey("upazilas", { ...input, locale }), 300, async () => {
    const result = await listUpazilasRepo(prisma, input);
    return {
      data: withLabel(result.items, locale),
      meta: buildPageMeta(result.page, result.pageSize, result.total),
    };
  });
  return data;
}

export async function listUnions(prisma: any, input: any = {}) {
  const locale = normalizeLocale(input.locale);
  const data = await cached(cacheKey("unions", { ...input, locale }), 300, async () => {
    const result = await listUnionsRepo(prisma, input);
    return {
      data: withLabel(result.items, locale),
      meta: buildPageMeta(result.page, result.pageSize, result.total),
    };
  });
  return data;
}

export async function listAreas(prisma: any, input: any = {}) {
  const locale = normalizeLocale(input.locale);
  const data = await cached(cacheKey("areas", { ...input, locale }), 300, async () => {
    const result = await listAreasRepo(prisma, input);
    return {
      data: withLabel(result.items, locale),
      meta: buildPageMeta(result.page, result.pageSize, result.total),
    };
  });
  return data;
}

export async function searchLocations(prisma: any, input: any = {}) {
  const locale = normalizeLocale(input.locale);
  const key = cacheKey("search", { ...input, locale });
  const data = await cached(key, 120, async () => {
    const result = await searchLocationRepo(prisma, input);
    return {
      data: withLabel(result.items, locale),
      meta: buildPageMeta(result.page, result.pageSize, result.total),
    };
  });
  return data;
}

function hasBdUnionModel(prisma: any) {
  return prisma && prisma.bdUnion && typeof prisma.bdUnion.findUnique === "function";
}

async function tryResolveUnionFromAreaCode(prisma: any, area: any) {
  if (!area || !hasBdUnionModel(prisma)) return null;
  if (area.unionId) {
    return prisma.bdUnion.findUnique({ where: { id: area.unionId } });
  }
  if (String(area.type || "").toUpperCase() !== "UNION") return null;
  return prisma.bdUnion.findFirst({
    where: { code: area.code },
  });
}

function validationError(code: string, message: string) {
  return { ok: false, errorCode: code, message };
}

export async function validateSelection(prisma: any, input: any) {
  const nodes = await getSelectionNodes(prisma, input || {});
  const area = nodes.area;
  let union = nodes.union;
  let unionId = nodes.unionId;
  let upazilaId = nodes.upazilaId;
  let districtId = nodes.districtId;
  let divisionId = nodes.divisionId;
  const areaId = nodes.areaId;

  if (nodes.divisionId && !nodes.division) return validationError("LOCATION_ID_NOT_FOUND", "Invalid divisionId");
  if (nodes.districtId && !nodes.district) return validationError("LOCATION_ID_NOT_FOUND", "Invalid districtId");
  if (nodes.upazilaId && !nodes.upazila) return validationError("LOCATION_ID_NOT_FOUND", "Invalid upazilaId");
  if (nodes.unionId && !nodes.union) return validationError("LOCATION_ID_NOT_FOUND", "Invalid unionId");
  if (nodes.areaId && !nodes.area) return validationError("LOCATION_ID_NOT_FOUND", "Invalid areaId");

  if (!union && area) {
    union = await tryResolveUnionFromAreaCode(prisma, area);
    unionId = asIntOrNull(union?.id);
  }

  if (!upazilaId && union?.upazilaId) upazilaId = asIntOrNull(union.upazilaId);
  if (!upazilaId && area?.upazilaId) upazilaId = asIntOrNull(area.upazilaId);

  let upazila = nodes.upazila;
  if (!upazila && upazilaId) {
    upazila = await prisma.bdUpazila.findUnique({ where: { id: upazilaId } });
    if (!upazila) return validationError("LOCATION_ID_NOT_FOUND", "Invalid upazilaId");
  }

  if (!districtId && upazila?.districtId) districtId = asIntOrNull(upazila.districtId);
  if (!districtId && area?.districtId) districtId = asIntOrNull(area.districtId);

  let district = nodes.district;
  if (!district && districtId) {
    district = await prisma.bdDistrict.findUnique({ where: { id: districtId } });
    if (!district) return validationError("LOCATION_ID_NOT_FOUND", "Invalid districtId");
  }

  if (!divisionId && district?.divisionId) divisionId = asIntOrNull(district.divisionId);

  let division = nodes.division;
  if (!division && divisionId) {
    division = await prisma.bdDivision.findUnique({ where: { id: divisionId } });
    if (!division) return validationError("LOCATION_ID_NOT_FOUND", "Invalid divisionId");
  }

  if (district && divisionId && district.divisionId !== divisionId) {
    return validationError("DISTRICT_DIVISION_MISMATCH", "District does not belong to selected division");
  }
  if (upazila && districtId && upazila.districtId !== districtId) {
    return validationError("UPAZILA_DISTRICT_MISMATCH", "Upazila does not belong to selected district");
  }
  if (union && upazilaId && union.upazilaId !== upazilaId) {
    return validationError("UNION_UPAZILA_MISMATCH", "Union does not belong to selected upazila");
  }
  if (area && unionId && area.unionId && area.unionId !== unionId) {
    return validationError("AREA_UNION_MISMATCH", "Area does not belong to selected union");
  }

  const normalized = {
    divisionId: divisionId || null,
    districtId: districtId || null,
    upazilaId: upazilaId || null,
    unionId: unionId || null,
    areaId: areaId || null,
  };

  const areaLabelEn = area ? area.nameEn || area.nameBn : null;
  const areaLabelBn = area ? area.nameBn || area.nameEn : null;
  const pathEn = [division?.nameEn, district?.nameEn, upazila?.nameEn, union?.nameEn, areaLabelEn].filter(Boolean).join(" > ");
  const pathBn = [division?.nameBn || division?.nameEn, district?.nameBn || district?.nameEn, upazila?.nameBn || upazila?.nameEn, union?.nameBn || union?.nameEn, areaLabelBn].filter(Boolean).join(" > ");

  return {
    ok: true,
    normalized,
    pathEn,
    pathBn,
  };
}

export async function listCoverage(prisma: any, entityType: string, entityId: number) {
  const rows = await prisma.locationCoverageAssignment.findMany({
    where: {
      entityType: String(entityType || "").toUpperCase(),
      entityId: Number(entityId),
      isActive: true,
    },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });
  return rows;
}

export async function replaceCoverage(prisma: any, entityType: string, entityId: number, rows: any[]) {
  const normalizedType = String(entityType || "").toUpperCase();
  const payload = Array.isArray(rows) ? rows : [];
  const validatedRows: any[] = [];

  for (let i = 0; i < payload.length; i += 1) {
    const row = payload[i] || {};
    const validated: any = await validateSelection(prisma, row);
    if (!validated?.ok) {
      return {
        ok: false,
        errorCode: validated?.errorCode,
        message: `Coverage row ${i + 1}: ${validated?.message || "Invalid location selection"}`,
      };
    }
    validatedRows.push({
      entityType: normalizedType,
      entityId: Number(entityId),
      divisionId: validated.normalized.divisionId,
      districtId: validated.normalized.districtId,
      upazilaId: validated.normalized.upazilaId,
      unionId: validated.normalized.unionId,
      areaId: validated.normalized.areaId,
      priority: Number(row.priority) || 0,
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : null,
      isActive: true,
    });
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.locationCoverageAssignment.deleteMany({
      where: { entityType: normalizedType, entityId: Number(entityId) },
    });
    if (validatedRows.length > 0) {
      await tx.locationCoverageAssignment.createMany({
        data: validatedRows,
      });
    }
  });

  clearLocationCacheByPrefix("location:");
  return { ok: true };
}

module.exports = {
  listDivisions,
  listDistricts,
  listUpazilas,
  listUnions,
  listAreas,
  searchLocations,
  validateSelection,
  listCoverage,
  replaceCoverage,
};
