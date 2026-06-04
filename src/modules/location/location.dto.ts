import { asIntOrNull, normalizeLocale, normalizeQuery } from "./location.validators";

export function toHierarchyListDto(query: any) {
  return {
    q: normalizeQuery(query?.q),
    page: query?.page,
    pageSize: query?.pageSize || query?.limit,
    locale: normalizeLocale(query?.locale),
    divisionId: asIntOrNull(query?.divisionId),
    districtId: asIntOrNull(query?.districtId),
    upazilaId: asIntOrNull(query?.upazilaId),
    unionId: asIntOrNull(query?.unionId),
  };
}

export function toSearchDto(query: any) {
  return {
    ...toHierarchyListDto(query),
    level: String(query?.level || "ALL").toUpperCase(),
  };
}

export function toSelectionDto(body: any) {
  return {
    divisionId: asIntOrNull(body?.divisionId),
    districtId: asIntOrNull(body?.districtId),
    upazilaId: asIntOrNull(body?.upazilaId),
    unionId: asIntOrNull(body?.unionId),
    areaId: asIntOrNull(body?.areaId ?? body?.bdAreaId),
  };
}

export function toCoverageReplaceDto(params: any, body: any) {
  return {
    entityType: String(params?.entityType || "").toUpperCase(),
    entityId: asIntOrNull(params?.entityId),
    rows: Array.isArray(body?.rows) ? body.rows : [],
  };
}

module.exports = {
  toHierarchyListDto,
  toSearchDto,
  toSelectionDto,
  toCoverageReplaceDto,
};
