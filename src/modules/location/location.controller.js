
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function searchFilter(q) {
  if (!q) return {};
  return {
    OR: [
      { nameEn: { contains: q, mode: "insensitive" } },
      { nameBn: { contains: q } },
    ],
  };
}

function pagination(page = 1, limit = 50) {
  page = Number(page) || 1;
  limit = Math.min(Number(limit) || 50, 100);
  return { skip: (page - 1) * limit, take: limit };
}

// 🔹 Dropdown-friendly
exports.dropdown = async (req, res) => {
  const { type, parentId } = req.query;
  let data = [];

  if (type === "division") {
    data = await prisma.bdDivision.findMany({
      select: { id: true, nameEn: true, nameBn: true },
      orderBy: { nameEn: "asc" },
    });
  }

  if (type === "district") {
    data = await prisma.bdDistrict.findMany({
      where: { divisionId: Number(parentId) },
      select: { id: true, nameEn: true, nameBn: true },
      orderBy: { nameEn: "asc" },
    });
  }

  if (type === "upazila") {
    data = await prisma.bdUpazila.findMany({
      where: { districtId: Number(parentId) },
      select: { id: true, nameEn: true, nameBn: true },
      orderBy: { nameEn: "asc" },
    });
  }

  res.json(
    data.map((d) => ({
      value: d.id,
      label: d.nameEn + (d.nameBn ? ` (${d.nameBn})` : ""),
    }))
  );
};

// 🔹 Geo hierarchy
exports.hierarchy = async (req, res) => {
  const divisions = await prisma.bdDivision.findMany({
    include: {
      districts: {
        include: {
          upazilas: true,
        },
      },
    },
  });
  res.json(divisions);
};

// 🔹 Admin seed sync
exports.syncSeed = async (req, res) => {
  await prisma.$executeRawUnsafe(`
    REFRESH MATERIALIZED VIEW CONCURRENTLY bd_divisions;
  `).catch(() => {});
  res.json({ status: "Location seed synced" });
};
