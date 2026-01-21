import { prisma } from "../../../../lib/prisma";
import { BranchStatus, VerificationStatus, Prisma } from "@prisma/client";

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBranchStatus(v: any): BranchStatus | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();

  const map: Record<string, BranchStatus> = {
    DRAFT: BranchStatus.DRAFT,
    PENDING_REVIEW: BranchStatus.PENDING_REVIEW,
    ACTIVE: BranchStatus.ACTIVE,
    INACTIVE: BranchStatus.INACTIVE,
    BLOCKED: BranchStatus.BLOCKED,
    APPROVED: BranchStatus.ACTIVE,   // backward compat
    REJECTED: BranchStatus.BLOCKED,  // backward compat
  };

  return map[s] ?? null;
}

function parseVerificationStatus(v: any): VerificationStatus | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  return Object.values(VerificationStatus).includes(s as VerificationStatus)
    ? (s as VerificationStatus)
    : null;
}

// GET /api/v1/admin/branches
exports.list = async (req, res) => {
  const statusRaw = req.query?.status;
  const orgId = toInt(req.query?.orgId);
  const q = req.query?.q ? String(req.query.q).trim() : "";

  const where: Prisma.BranchWhereInput = {};

  if (statusRaw) {
    const st = parseBranchStatus(statusRaw);
    if (!st) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    where.status = st;
  }

  if (orgId !== null) where.orgId = orgId;

  if (q) {
    where.OR = [{ name: { contains: q, mode: "insensitive" } }];
  }

  const rows = await prisma.branch.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      orgId: true,
      name: true,
      status: true,
      verificationStatus: true,
      createdAt: true,
      updatedAt: true,
      org: { select: { id: true, name: true, ownerUserId: true, status: true } },
      typeLinks: {
        select: {
          isPrimary: true,
          branchType: { select: { id: true, code: true, nameEn: true, nameBn: true } },
        },
      },
    },
    take: 300,
  });

  return res.json({ success: true, data: rows });
};

// POST /api/v1/admin/branches
exports.create = async (req, res) => {
  const orgId = toInt(req.body?.orgId);
  const name = req.body?.name ? String(req.body.name).trim() : "";

  if (orgId === null)
    return res.status(400).json({ success: false, message: "orgId is required" });
  if (!name)
    return res.status(400).json({ success: false, message: "name is required" });

  const status = parseBranchStatus(req.body?.status);
  const verificationStatus = parseVerificationStatus(req.body?.verificationStatus);

  const branch = await prisma.branch.create({
    data: {
      name,
      addressJson: req.body?.addressJson ?? null,
      capabilitiesJson: req.body?.capabilitiesJson ?? {},
      featuresJson: req.body?.featuresJson ?? {},
      ...(status ? { status } : {}),
      ...(verificationStatus ? { verificationStatus } : {}),
      org: { connect: { id: orgId } }, // ✅ correct relation create
    },
  });

  const typeCodes = Array.isArray(req.body?.typeCodes)
    ? req.body.typeCodes.map((x) => String(x).trim()).filter(Boolean)
    : [];

  if (typeCodes.length) {
    const types = await prisma.branchType.findMany({
      where: { code: { in: typeCodes } },
      select: { id: true },
    });

    await prisma.branchTypeOnBranch.createMany({
      data: types.map((t, idx) => ({
        branchId: branch.id,
        branchTypeId: t.id,
        isPrimary: idx === 0,
      })),
      skipDuplicates: true,
    });
  }

  const row = await prisma.branch.findUnique({
    where: { id: branch.id },
    include: { org: true, typeLinks: { include: { branchType: true } } },
  });

  return res.status(201).json({ success: true, data: row });
};

// GET /api/v1/admin/branches/:id
exports.getById = async (req, res) => {
  const id = toInt(req.params?.id);
  if (id === null)
    return res.status(400).json({ success: false, message: "Invalid id" });

  const row = await prisma.branch.findUnique({
    where: { id },
    include: {
      org: true,
      typeLinks: { include: { branchType: true } },
      profileDetails: { include: { documents: { include: { media: true } } } },
      publishRequests: { orderBy: { id: "desc" } },
    },
  });

  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  return res.json({ success: true, data: row });
};

// PATCH /api/v1/admin/branches/:id
exports.updateById = async (req, res) => {
  const id = toInt(req.params?.id);
  if (id === null)
    return res.status(400).json({ success: false, message: "Invalid id" });

  const data: Prisma.BranchUpdateInput = {};

  if (req.body?.name !== undefined) {
    data.name = String(req.body.name || "").trim();
    if (data.name === "")
      return res.status(400).json({ success: false, message: "name cannot be empty" });
  }

  if (req.body?.status !== undefined) {
    const st = parseBranchStatus(req.body.status);
    if (!st)
      return res.status(400).json({ success: false, message: "Invalid status" });
    data.status = st;
  }

  if (req.body?.verificationStatus !== undefined) {
    const vs = parseVerificationStatus(req.body.verificationStatus);
    if (!vs)
      return res.status(400).json({ success: false, message: "Invalid verificationStatus" });
    data.verificationStatus = vs;
  }

  if (req.body?.addressJson !== undefined) data.addressJson = req.body.addressJson;
  if (req.body?.capabilitiesJson !== undefined) data.capabilitiesJson = req.body.capabilitiesJson;
  if (req.body?.featuresJson !== undefined) data.featuresJson = req.body.featuresJson;

  await prisma.branch.update({ where: { id }, data });

  const row = await prisma.branch.findUnique({
    where: { id },
    include: { org: true, typeLinks: { include: { branchType: true } } },
  });

  return res.json({ success: true, data: row });
};
