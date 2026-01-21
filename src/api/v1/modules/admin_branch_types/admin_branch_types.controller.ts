const prisma = require("../../../../infrastructure/db/prismaClient");

// GET /api/v1/admin/branch-types
exports.list = async (req, res) => {
  try {
    const rows = await prisma.branchType.findMany({
      orderBy: [{ isActive: "desc" }, { id: "asc" }],
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("admin_branch_types.list error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// POST /api/v1/admin/branch-types
exports.upsert = async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    const nameEn = String(req.body?.nameEn || "").trim();
    const nameBn = req.body?.nameBn ? String(req.body.nameBn).trim() : null;
    const description = req.body?.description ? String(req.body.description).trim() : null;
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);

    if (!code) return res.status(400).json({ success: false, message: "code is required" });
    if (!nameEn) return res.status(400).json({ success: false, message: "nameEn is required" });

    const row = await prisma.branchType.upsert({
      where: { code },
      update: { nameEn, nameBn, description, isActive },
      create: { code, nameEn, nameBn, description, isActive },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error("admin_branch_types.upsert error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// PATCH /api/v1/admin/branch-types/:id
exports.updateById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    // Keep the update payload explicitly typed so TS doesn't infer `{}`.
    // Prisma accepts partial update fields.
    const data: {
      nameEn?: string;
      nameBn?: string | null;
      description?: string | null;
      isActive?: boolean;
    } = {};
    if (req.body?.nameEn !== undefined) data.nameEn = String(req.body.nameEn || "").trim();
    if (req.body?.nameBn !== undefined) data.nameBn = req.body.nameBn ? String(req.body.nameBn).trim() : null;
    if (req.body?.description !== undefined) data.description = req.body.description ? String(req.body.description).trim() : null;
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    const row = await prisma.branchType.update({ where: { id }, data });
    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("admin_branch_types.updateById error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
