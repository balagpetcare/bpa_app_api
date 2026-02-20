import { Prisma } from "@prisma/client";
const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeAudit } = require("../../../../middlewares/auditWriter");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeCode(v) {
  return String(v || "").toUpperCase().trim();
}

exports.list = async (req, res) => {
  try {
    const countryId = toInt(req.query?.countryId);
    const q = req.query?.q ? String(req.query.q).trim() : "";
    const where: Prisma.StateWhereInput = {};
    if (countryId) where.countryId = countryId;
    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.state.findMany({
      where,
      orderBy: [{ name: "asc" }, { code: "asc" }],
      include: { country: { select: { id: true, code: true, name: true } } },
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("admin_states.list error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const countryId = toInt(req.body?.countryId);
    const code = normalizeCode(req.body?.code);
    const name = String(req.body?.name || "").trim();
    if (!countryId) return res.status(400).json({ success: false, message: "countryId is required" });
    if (!code) return res.status(400).json({ success: false, message: "code is required" });
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const row = await prisma.state.create({
      data: {
        countryId,
        code,
        name,
        isActive: req.body?.isActive !== undefined ? !!req.body.isActive : true,
      },
    });

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "STATE_CREATE",
      entityType: "STATE",
      entityId: row.id,
      before: null,
      after: row,
    });

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error("admin_states.create error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = toInt(req.params?.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid state id" });

    const data: Prisma.StateUpdateInput = {};
    if (req.body?.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body?.isActive !== undefined) data.isActive = !!req.body.isActive;

    const row = await prisma.state.update({ where: { id }, data });
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "STATE_UPDATE",
      entityType: "STATE",
      entityId: row.id,
      before: null,
      after: row,
    });
    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("admin_states.update error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};

