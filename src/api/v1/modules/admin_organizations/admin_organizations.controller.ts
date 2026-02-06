import type { Request, Response } from "express";
import { Prisma, PartnerStatus } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePartnerStatus(v: any): PartnerStatus | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  return Object.values(PartnerStatus).includes(s as PartnerStatus)
    ? (s as PartnerStatus)
    : null;
}

async function resolveRequestCountryId(req: Request): Promise<number | null> {
  const ctx = (req as any).countryContext || {};
  if (ctx.countryId) return ctx.countryId;
  const code = String(ctx.countryCode || req.headers["x-country-code"] || "BD")
    .toUpperCase()
    .trim();
  const country = await prisma.country.findUnique({ where: { code }, select: { id: true } });
  return country?.id ?? null;
}

// GET /api/v1/admin/organizations
export const list = async (req: Request, res: Response) => {
  try {
    const statusRaw = req.query?.status ? String(req.query.status) : "";
    const q = req.query?.q ? String(req.query.q) : "";
    const ownerUserId = toInt(req.query?.ownerUserId);

    const where: Prisma.OrganizationWhereInput = {};

    if (statusRaw) {
      const st = parsePartnerStatus(statusRaw);
      if (!st) return res.status(400).json({ success: false, message: "Invalid status" });
      where.status = st;
    }

    if (ownerUserId !== null) where.ownerUserId = ownerUserId;

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { supportPhone: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.organization.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        ownerUserId: true,
        status: true,
        name: true,
        supportPhone: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { branches: true } },
      },
      take: 200,
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/v1/admin/organizations
export const create = async (req: Request, res: Response) => {
  try {
    const ownerUserId = toInt(req.body?.ownerUserId);
    const name = req.body?.name ? String(req.body.name).trim() : "";

    if (ownerUserId === null)
      return res.status(400).json({ success: false, message: "ownerUserId required" });
    if (!name)
      return res.status(400).json({ success: false, message: "name required" });

    const status = parsePartnerStatus(req.body?.status);

    const countryId = await resolveRequestCountryId(req);
    if (!countryId) {
      return res.status(400).json({ success: false, message: "Country not resolved for organization" });
    }

    const row = await prisma.organization.create({
      data: {
        ownerUserId, // ✅ ONLY THIS (no ownerUser)
        name,
        supportPhone: req.body?.supportPhone ?? null,
        addressJson: req.body?.addressJson ?? null,
        countryId,
        ...(status ? { status } : {}),
      },
    });

    res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/v1/admin/organizations/:id
export const getById = async (req: Request, res: Response) => {
  const id = toInt(req.params?.id);
  if (id === null) return res.status(400).json({ success: false, message: "Invalid id" });

  const row = await prisma.organization.findUnique({
    where: { id },
    include: {
      branches: {
        select: { id: true, name: true, status: true, verificationStatus: true },
      },
      legalProfile: true,
    },
  });

  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
};

// PATCH /api/v1/admin/organizations/:id
export const updateById = async (req: Request, res: Response) => {
  const id = toInt(req.params?.id);
  if (id === null) return res.status(400).json({ success: false, message: "Invalid id" });

  const data: Prisma.OrganizationUpdateInput = {};

  if (req.body?.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body?.supportPhone !== undefined) data.supportPhone = req.body.supportPhone;
  if (req.body?.addressJson !== undefined) data.addressJson = req.body.addressJson;

  if (req.body?.status !== undefined) {
    const st = parsePartnerStatus(req.body.status);
    if (!st) return res.status(400).json({ success: false, message: "Invalid status" });
    data.status = st;
  }

  const row = await prisma.organization.update({ where: { id }, data });
  res.json({ success: true, data: row });
};
