import { Prisma } from "@prisma/client";
const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeAudit } = require("../../../../middlewares/auditWriter");

function normalizeCode(v) {
  return String(v || "").toUpperCase().trim().slice(0, 2);
}

exports.list = async (req, res) => {
  try {
    const q = req.query?.q ? String(req.query.q).trim() : "";
    const isActiveRaw = req.query?.isActive;
    const where: Prisma.CountryWhereInput = {};
    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }
    if (isActiveRaw !== undefined) {
      const v = String(isActiveRaw).toLowerCase();
      where.isActive = v === "true" || v === "1";
    }

    const rows = await prisma.country.findMany({
      where,
      orderBy: [{ name: "asc" }, { code: "asc" }],
      include: {
        policies: {
          where: { status: "ACTIVE" },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { id: true, name: true, status: true, effectiveFrom: true },
        },
      },
    });

    const data = rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      currencyCode: c.currencyCode,
      timezoneDefault: c.timezoneDefault,
      isActive: c.isActive,
      activePolicy: c.policies?.[0] || null,
    }));

    return res.json({ success: true, data });
  } catch (e) {
    console.error("admin_countries.list error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    const name = String(req.body?.name || "").trim();
    if (!code) return res.status(400).json({ success: false, message: "code is required" });
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const existing = await prisma.country.findUnique({ where: { code } });
    if (existing) {
      return res.status(409).json({ success: false, message: "Country code already exists" });
    }

    const row = await prisma.country.create({
      data: {
        code,
        name,
        currencyCode: req.body?.currencyCode || null,
        timezoneDefault: req.body?.timezoneDefault || null,
        isActive: req.body?.isActive !== undefined ? !!req.body.isActive : true,
      },
    });

    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_CREATE",
      entityType: "COUNTRY",
      entityId: row.id,
      before: null,
      after: row,
    });

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error("admin_countries.create error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params?.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid country id" });
    }

    const data: Prisma.CountryUpdateInput = {};
    if (req.body?.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body?.currencyCode !== undefined) data.currencyCode = req.body.currencyCode || null;
    if (req.body?.timezoneDefault !== undefined) data.timezoneDefault = req.body.timezoneDefault || null;
    if (req.body?.isActive !== undefined) data.isActive = !!req.body.isActive;

    const row = await prisma.country.update({ where: { id }, data });
    await writeAudit({
      prisma: req.prisma,
      req,
      action: "COUNTRY_UPDATE",
      entityType: "COUNTRY",
      entityId: row.id,
      before: null,
      after: row,
    });
    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("admin_countries.update error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};

