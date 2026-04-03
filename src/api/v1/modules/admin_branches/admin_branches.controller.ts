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
  const skip = toInt(req.query?.skip) ?? 0;
  const take = toInt(req.query?.take) ?? 300;

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
    const orClauses: Prisma.BranchWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { org: { name: { contains: q, mode: "insensitive" } } },
    ];

    // If code exists and q looks like a code, search by code
    if (q) {
      orClauses.push({ code: { contains: q, mode: "insensitive" } });
    }

    // If q is numeric, also search by id
    const numericId = toInt(q);
    if (numericId !== null) {
      orClauses.push({ id: numericId });
    }

    where.OR = orClauses;
  }

  const rows = await prisma.branch.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      orgId: true,
      name: true,
      code: true,
      status: true,
      verificationStatus: true,
      capabilitiesJson: true,
      featuresJson: true,
      location: true,
      addressJson: true,
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
    skip,
    take: Math.min(take, 500),
  });

  return res.json({ success: true, data: rows });
};

// POST /api/v1/admin/branches
exports.create = async (req, res) => {
  const orgId = toInt(req.body?.orgId);
  const name = req.body?.name ? String(req.body.name).trim() : "";
  const code = req.body?.code ? String(req.body.code).trim() : null;

  if (orgId === null)
    return res.status(400).json({ success: false, message: "orgId is required" });
  if (!name)
    return res.status(400).json({ success: false, message: "name is required" });

  const status = parseBranchStatus(req.body?.status);
  const verificationStatus = parseVerificationStatus(req.body?.verificationStatus);

  // Normalize address: accept either plain string or addressJson
  let addressJson = req.body?.addressJson ?? null;
  if (!addressJson && req.body?.address && typeof req.body.address === "string") {
    addressJson = req.body.address;
  }

  // Normalize capabilities: accept array of strings or capabilitiesJson object
  let capabilitiesJson = req.body?.capabilitiesJson ?? {};
  if (!req.body?.capabilitiesJson && req.body?.capabilities) {
    if (Array.isArray(req.body.capabilities)) {
      // Convert array to object map
      capabilitiesJson = {};
      req.body.capabilities.forEach((cap: any) => {
        const key = typeof cap === "string" ? cap : cap?.capability;
        if (key) capabilitiesJson[key] = true;
      });
    }
  }

  try {
    const branch = await prisma.branch.create({
      data: {
        name,
        code,
        addressJson,
        capabilitiesJson,
        featuresJson: req.body?.featuresJson ?? {},
        ...(status ? { status } : {}),
        ...(verificationStatus ? { verificationStatus } : {}),
        org: { connect: { id: orgId } },
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
  } catch (e: any) {
    // Handle unique constraint violation for code
    if (e.code === "P2002" && e.meta?.target?.includes("code")) {
      return res.status(409).json({
        success: false,
        message: "Branch code already exists in this organization"
      });
    }
    throw e;
  }
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
      members: {
        include: {
          user: {
            select: {
              id: true,
              auth: { select: { email: true, phone: true } },
              profile: { select: { displayName: true } },
            },
          },
          roles: { include: { role: { select: { key: true, label: true } } } },
        },
      },
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

  if (req.body?.code !== undefined) {
    data.code = req.body.code ? String(req.body.code).trim() : null;
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

  // Normalize address
  if (req.body?.addressJson !== undefined) {
    data.addressJson = req.body.addressJson;
  } else if (req.body?.address !== undefined && typeof req.body.address === "string") {
    data.addressJson = req.body.address;
  }

  // Normalize capabilities
  if (req.body?.capabilitiesJson !== undefined) {
    data.capabilitiesJson = req.body.capabilitiesJson;
  } else if (req.body?.capabilities !== undefined && Array.isArray(req.body.capabilities)) {
    const capabilitiesJson: Record<string, boolean> = {};
    req.body.capabilities.forEach((cap: any) => {
      const key = typeof cap === "string" ? cap : cap?.capability;
      if (key) capabilitiesJson[key] = true;
    });
    data.capabilitiesJson = capabilitiesJson;
  }

  if (req.body?.featuresJson !== undefined) data.featuresJson = req.body.featuresJson;

  try {
    await prisma.branch.update({ where: { id }, data });

    const row = await prisma.branch.findUnique({
      where: { id },
      include: { org: true, typeLinks: { include: { branchType: true } } },
    });

    return res.json({ success: true, data: row });
  } catch (e: any) {
    // Handle unique constraint violation for code
    if (e.code === "P2002" && e.meta?.target?.includes("code")) {
      return res.status(409).json({
        success: false,
        message: "Branch code already exists in this organization"
      });
    }
    throw e;
  }
};
