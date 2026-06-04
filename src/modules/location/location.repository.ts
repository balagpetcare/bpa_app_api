import { asIntOrNull, normalizePagination, normalizeQuery } from "./location.validators";

function qWhere(q: string) {
  if (!q) return {};
  return {
    OR: [
      { nameEn: { contains: q, mode: "insensitive" as const } },
      { nameBn: { contains: q, mode: "insensitive" as const } },
      { code: { contains: q, mode: "insensitive" as const } },
    ],
  };
}

function hasBdUnionModel(prisma: any) {
  return prisma && prisma.bdUnion && typeof prisma.bdUnion.findMany === "function";
}

export async function listDivisionsRepo(prisma: any, input: any = {}) {
  const q = normalizeQuery(input.q);
  const { page, pageSize, skip, take } = normalizePagination(input);
  const where = qWhere(q);
  const [items, total] = await Promise.all([
    prisma.bdDivision.findMany({
      where,
      orderBy: [{ nameEn: "asc" }],
      skip,
      take,
      select: { id: true, code: true, nameEn: true, nameBn: true },
    }),
    prisma.bdDivision.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listDistrictsRepo(prisma: any, input: any = {}) {
  const q = normalizeQuery(input.q);
  const divisionId = asIntOrNull(input.divisionId);
  const { page, pageSize, skip, take } = normalizePagination(input);
  const where = {
    ...(divisionId ? { divisionId } : {}),
    ...qWhere(q),
  };
  const [items, total] = await Promise.all([
    prisma.bdDistrict.findMany({
      where,
      orderBy: [{ nameEn: "asc" }],
      skip,
      take,
      select: { id: true, code: true, nameEn: true, nameBn: true, divisionId: true },
    }),
    prisma.bdDistrict.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listUpazilasRepo(prisma: any, input: any = {}) {
  const q = normalizeQuery(input.q);
  const districtId = asIntOrNull(input.districtId);
  const { page, pageSize, skip, take } = normalizePagination(input);
  const where = {
    ...(districtId ? { districtId } : {}),
    ...qWhere(q),
  };
  const [items, total] = await Promise.all([
    prisma.bdUpazila.findMany({
      where,
      orderBy: [{ nameEn: "asc" }],
      skip,
      take,
      select: { id: true, code: true, nameEn: true, nameBn: true, districtId: true },
    }),
    prisma.bdUpazila.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listUnionsRepo(prisma: any, input: any = {}) {
  const q = normalizeQuery(input.q);
  const upazilaId = asIntOrNull(input.upazilaId);
  const { page, pageSize, skip, take } = normalizePagination(input);

  if (hasBdUnionModel(prisma)) {
    const where = {
      ...(upazilaId ? { upazilaId } : {}),
      ...qWhere(q),
    };
    const [items, total] = await Promise.all([
      prisma.bdUnion.findMany({
        where,
        orderBy: [{ nameEn: "asc" }],
        skip,
        take,
        select: { id: true, code: true, nameEn: true, nameBn: true, upazilaId: true },
      }),
      prisma.bdUnion.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // Fallback for environments where BdUnion is not yet migrated/generated.
  const where = {
    type: "UNION",
    ...(upazilaId ? { upazilaId } : {}),
    ...qWhere(q),
  };
  const [items, total] = await Promise.all([
    prisma.bdArea.findMany({
      where,
      orderBy: [{ nameEn: "asc" }],
      skip,
      take,
      select: { id: true, code: true, nameEn: true, nameBn: true, upazilaId: true },
    }),
    prisma.bdArea.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listAreasRepo(prisma: any, input: any = {}) {
  const q = normalizeQuery(input.q);
  const unionId = asIntOrNull(input.unionId);
  const upazilaId = asIntOrNull(input.upazilaId);
  const { page, pageSize, skip, take } = normalizePagination(input);
  const where: any = {
    ...(q ? qWhere(q) : {}),
  };
  if (unionId) where.unionId = unionId;
  if (!unionId && upazilaId) where.upazilaId = upazilaId;

  const [items, total] = await Promise.all([
    prisma.bdArea.findMany({
      where,
      orderBy: [{ nameEn: "asc" }],
      skip,
      take,
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameBn: true,
        type: true,
        unionId: true,
        upazilaId: true,
        districtId: true,
      },
    }),
    prisma.bdArea.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function searchLocationRepo(prisma: any, input: any) {
  const level = String(input.level || "ALL").toUpperCase();
  const q = normalizeQuery(input.q);
  const pagination = normalizePagination(input);
  if (!q) return { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize };

  if (level === "DIVISION") return listDivisionsRepo(prisma, input);
  if (level === "DISTRICT") return listDistrictsRepo(prisma, input);
  if (level === "UPAZILA") return listUpazilasRepo(prisma, input);
  if (level === "UNION") return listUnionsRepo(prisma, input);
  if (level === "AREA") return listAreasRepo(prisma, input);

  // ALL levels: gather a bounded result and paginate in-memory.
  const gatherSize = Math.min(500, pagination.pageSize * Math.max(3, pagination.page));
  const [divs, dists, upzs, unions, areas] = await Promise.all([
    prisma.bdDivision.findMany({
      where: qWhere(q),
      take: gatherSize,
      orderBy: [{ nameEn: "asc" }],
      select: { id: true, code: true, nameEn: true, nameBn: true },
    }),
    prisma.bdDistrict.findMany({
      where: qWhere(q),
      take: gatherSize,
      orderBy: [{ nameEn: "asc" }],
      select: { id: true, code: true, nameEn: true, nameBn: true, divisionId: true },
    }),
    prisma.bdUpazila.findMany({
      where: qWhere(q),
      take: gatherSize,
      orderBy: [{ nameEn: "asc" }],
      select: { id: true, code: true, nameEn: true, nameBn: true, districtId: true },
    }),
    hasBdUnionModel(prisma)
      ? prisma.bdUnion.findMany({
          where: qWhere(q),
          take: gatherSize,
          orderBy: [{ nameEn: "asc" }],
          select: { id: true, code: true, nameEn: true, nameBn: true, upazilaId: true },
        })
      : prisma.bdArea.findMany({
          where: { type: "UNION", ...qWhere(q) },
          take: gatherSize,
          orderBy: [{ nameEn: "asc" }],
          select: { id: true, code: true, nameEn: true, nameBn: true, upazilaId: true },
        }),
    prisma.bdArea.findMany({
      where: qWhere(q),
      take: gatherSize,
      orderBy: [{ nameEn: "asc" }],
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameBn: true,
        type: true,
        unionId: true,
        upazilaId: true,
        districtId: true,
      },
    }),
  ]);

  const merged = [
    ...divs.map((x: any) => ({ ...x, level: "DIVISION" })),
    ...dists.map((x: any) => ({ ...x, level: "DISTRICT" })),
    ...upzs.map((x: any) => ({ ...x, level: "UPAZILA" })),
    ...unions.map((x: any) => ({ ...x, level: "UNION" })),
    ...areas.map((x: any) => ({ ...x, level: "AREA" })),
  ].sort((a, b) => String(a.nameEn || "").localeCompare(String(b.nameEn || "")));

  const total = merged.length;
  const items = merged.slice(pagination.skip, pagination.skip + pagination.take);
  return { items, total, page: pagination.page, pageSize: pagination.pageSize };
}

export async function getSelectionNodes(prisma: any, input: any) {
  const divisionId = asIntOrNull(input.divisionId);
  const districtId = asIntOrNull(input.districtId);
  const upazilaId = asIntOrNull(input.upazilaId);
  const unionId = asIntOrNull(input.unionId);
  const areaId = asIntOrNull(input.areaId);

  const [division, district, upazila, union, area] = await Promise.all([
    divisionId ? prisma.bdDivision.findUnique({ where: { id: divisionId } }) : null,
    districtId ? prisma.bdDistrict.findUnique({ where: { id: districtId } }) : null,
    upazilaId ? prisma.bdUpazila.findUnique({ where: { id: upazilaId } }) : null,
    hasBdUnionModel(prisma) && unionId ? prisma.bdUnion.findUnique({ where: { id: unionId } }) : null,
    areaId ? prisma.bdArea.findUnique({ where: { id: areaId } }) : null,
  ]);

  return { divisionId, districtId, upazilaId, unionId, areaId, division, district, upazila, union, area };
}

module.exports = {
  listDivisionsRepo,
  listDistrictsRepo,
  listUpazilasRepo,
  listUnionsRepo,
  listAreasRepo,
  searchLocationRepo,
  getSelectionNodes,
};
