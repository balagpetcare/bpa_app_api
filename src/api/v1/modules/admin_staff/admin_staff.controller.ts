const prisma = require("../../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");
import { Prisma, MemberRole, MemberStatus } from "@prisma/client";

function normalizeEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  return s || null;
}

function normalizePhone(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (!digits) return null;
  // For BD numbers keep last 11 digits (supports +880...)
  return digits.length > 11 ? digits.slice(-11) : digits;
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickSearchWhere(q) {
  const query = String(q || "").trim();
  if (!query) return undefined;

  const maybeId = Number(query);
  const email = normalizeEmail(query);
  const phone = normalizePhone(query);

  const ors = [];
  if (Number.isFinite(maybeId) && maybeId > 0) {
    ors.push({ user: { id: maybeId } });
  }
  if (email && email.includes("@")) {
    ors.push({ user: { auth: { is: { email: { contains: email, mode: "insensitive" } } } } });
  }
  if (phone) {
    ors.push({ user: { auth: { is: { phone: { contains: phone } } } } });
  }
  ors.push({ user: { profile: { is: { username: { contains: query, mode: "insensitive" } } } } });
  ors.push({ user: { profile: { is: { displayName: { contains: query, mode: "insensitive" } } } } });

  return { OR: ors };
}

// GET /api/v1/admin/staff
exports.list = async (req, res) => {
  try {
    const q = req.query?.q;
    const orgId = toInt(req.query?.orgId);
    const branchId = toInt(req.query?.branchId);
    const role = req.query?.role;
    const status = req.query?.status;
    const createdSince = parseInt(req.query?.createdSince, 10);

    const where: Prisma.BranchMemberWhereInput = {};
    const searchWhere = pickSearchWhere(q);
    if (searchWhere) where.OR = searchWhere.OR;

    if (orgId) where.orgId = orgId;
    if (branchId) where.branchId = branchId;
    if (role && ["OWNER", "ORG_ADMIN", "BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "DELIVERY_MANAGER", "DELIVERY_STAFF"].includes(String(role).toUpperCase())) {
      where.role = String(role).toUpperCase() as MemberRole;
    }
    if (status && ["INVITED", "ACTIVE", "SUSPENDED"].includes(String(status).toUpperCase())) {
      where.status = String(status).toUpperCase() as MemberStatus;
    }
    if (Number.isFinite(createdSince) && createdSince > 0) {
      where.createdAt = { gte: new Date(Date.now() - createdSince * 24 * 60 * 60 * 1000) };
    }

    const rows = await prisma.branchMember.findMany({
      where,
      include: {
        org: { select: { id: true, name: true, status: true } },
        branch: { select: { id: true, name: true, status: true } },
        user: {
          select: {
            id: true,
            status: true,
            auth: { select: { email: true, phone: true, provider: true, createdAt: true } },
            profile: { select: { displayName: true, username: true } },
          },
        },
        roles: {
          include: {
            role: { select: { id: true, key: true, label: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const data = rows.map((m) => ({
      id: m.id,
      orgId: m.orgId,
      branchId: m.branchId,
      userId: m.userId,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      org: m.org ? { id: m.org.id, name: m.org.name, status: m.org.status } : null,
      branch: m.branch ? { id: m.branch.id, name: m.branch.name, status: m.branch.status } : null,
      user: m.user
        ? {
            id: m.user.id,
            status: m.user.status,
            email: m.user.auth?.email || null,
            phone: m.user.auth?.phone || null,
            provider: m.user.auth?.provider || null,
            displayName: m.user.profile?.displayName || null,
            username: m.user.profile?.username || null,
          }
        : null,
      roles: m.roles?.map((r) => ({ id: r.role.id, key: r.role.key, label: r.role.label })) || [],
    }));

    return res.json({ success: true, data });
  } catch (e) {
    console.error("admin_staff.list error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// GET /api/v1/admin/staff/:id
exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const member = await prisma.branchMember.findUnique({
      where: { id },
      include: {
        org: { select: { id: true, name: true, status: true, ownerUserId: true } },
        branch: { select: { id: true, name: true, status: true } },
        user: {
          select: {
            id: true,
            status: true,
            auth: { select: { email: true, phone: true, provider: true, createdAt: true } },
            profile: { select: { displayName: true, username: true } },
          },
        },
        roles: {
          include: {
            role: { select: { id: true, key: true, label: true, scope: true } },
          },
        },
      },
    });
    if (!member) return res.status(404).json({ success: false, message: "Not found" });

    const data = {
      id: member.id,
      orgId: member.orgId,
      branchId: member.branchId,
      userId: member.userId,
      role: member.role,
      status: member.status,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      org: member.org ? { id: member.org.id, name: member.org.name, status: member.org.status, ownerUserId: member.org.ownerUserId } : null,
      branch: member.branch ? { id: member.branch.id, name: member.branch.name, status: member.branch.status } : null,
      user: member.user
        ? {
            id: member.user.id,
            status: member.user.status,
            email: member.user.auth?.email || null,
            phone: member.user.auth?.phone || null,
            provider: member.user.auth?.provider || null,
            displayName: member.user.profile?.displayName || null,
            username: member.user.profile?.username || null,
          }
        : null,
      roles: member.roles?.map((r) => ({ id: r.role.id, key: r.role.key, label: r.role.label, scope: r.role.scope })) || [],
    };
    return res.json({ success: true, data });
  } catch (e) {
    console.error("admin_staff.getById error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// POST /api/v1/admin/staff
exports.create = async (req, res) => {
  try {
    const branchId = toInt(req.body?.branchId);
    const userId = toInt(req.body?.userId);
    const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : null;
    const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : null;
    const displayName = String(req.body?.displayName || "").trim() || "New Staff";
    const role = req.body?.role ? String(req.body.role).toUpperCase() : null;
    const password = String(req.body?.password || "");

    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }
    if (!role || !["OWNER", "ORG_ADMIN", "BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "DELIVERY_MANAGER", "DELIVERY_STAFF"].includes(role)) {
      return res.status(400).json({ success: false, message: "Valid role is required" });
    }

    // Verify branch exists and get orgId
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true },
    });
    if (!branch) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    let targetUserId = userId;

    // If userId not provided, create user from email/phone
    if (!targetUserId) {
      if (!email && !phone) {
        return res.status(400).json({ success: false, message: "userId or (email/phone) is required" });
      }
      if (email && !email.includes("@")) {
        return res.status(400).json({ success: false, message: "Invalid email" });
      }
      if (phone && phone.length < 10) {
        return res.status(400).json({ success: false, message: "Invalid phone" });
      }

      // Check if user already exists
      const existingAuth = await prisma.userAuth.findFirst({
        where: {
          OR: [
            email ? { email: { equals: email, mode: "insensitive" } } : undefined,
            phone ? { phone } : undefined,
          ].filter(Boolean),
        },
        select: { userId: true },
      });

      if (existingAuth) {
        targetUserId = existingAuth.userId;
      } else {
        // Create new user
        if (!password || password.length < 4) {
          return res.status(400).json({ success: false, message: "password is required (min 4 chars) when creating new user" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const username = `staff_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const newUser = await prisma.user.create({
          data: {
            status: "ACTIVE",
            auth: {
              create: {
                provider: "LOCAL",
                email,
                phone,
                passwordHash,
              },
            },
            profile: {
              create: {
                displayName,
                username,
              },
            },
            wallet: {
              create: {
                balance: 0.0,
                points: 0,
                tier: "Bronze",
                currency: "BDT",
              },
            },
          },
        });
        targetUserId = newUser.id;
      }
    }

    // Check if branch member already exists
    const existingMember = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: targetUserId } },
      select: { id: true },
    });

    if (existingMember) {
      return res.status(409).json({ success: false, message: "Staff member already exists for this branch" });
    }

    // Create branch member
    const member = await prisma.branchMember.create({
      data: {
        orgId: branch.orgId,
        branchId,
        userId: targetUserId,
        role,
        status: "ACTIVE",
      },
      include: {
        org: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            auth: { select: { email: true, phone: true } },
            profile: { select: { displayName: true, username: true } },
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        id: member.id,
        orgId: member.orgId,
        branchId: member.branchId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        org: member.org ? { id: member.org.id, name: member.org.name } : null,
        branch: member.branch ? { id: member.branch.id, name: member.branch.name } : null,
        user: member.user
          ? {
              id: member.user.id,
              email: member.user.auth?.email || null,
              phone: member.user.auth?.phone || null,
              displayName: member.user.profile?.displayName || null,
              username: member.user.profile?.username || null,
            }
          : null,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ success: false, message: "Staff member already exists" });
    }
    console.error("admin_staff.create error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// NOTE:
// Branch Manager–driven staff creation, invitation, and branch assignment
// flows are implemented via existing admin/staff endpoints plus the
// BranchAccessPermission service:
//
// - Manager creates or assigns a staff member to a branch using this controller.
// - Branch access approval / revocation is handled via:
//     - POST /api/v1/branch-access/request         (staff request)
//     - GET  /api/v1/branch-access/pending        (manager inbox)
//     - POST /api/v1/branch-access/:id/approve    (manager/owner approves)
//     - POST /api/v1/branch-access/:id/revoke     (manager/owner revokes)
//
// For Branch Manager Dashboard, the new branch_manager controller exposes:
//     - GET /api/v1/branches/managed                      (list managed branches)
//     - GET /api/v1/branches/:branchId/manager/staff      (staff overview + access)
//     - GET /api/v1/branches/:branchId/manager/kpis       (branch KPIs)
//
// Together these APIs allow a manager to:
//  - See all staff in their branch, with role + access status
//  - Create new staff or assign existing users via admin/staff endpoints
//  - Manage branch access lifecycle via branch-access endpoints

// PATCH /api/v1/admin/staff/:id
exports.updateById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const role = req.body?.role !== undefined ? String(req.body.role).toUpperCase() : undefined;
    const status = req.body?.status !== undefined ? String(req.body.status).toUpperCase() : undefined;
    const branchId = toInt(req.body?.branchId);

    if (role && !["OWNER", "ORG_ADMIN", "BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "DELIVERY_MANAGER", "DELIVERY_STAFF"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }
    if (status && !["INVITED", "ACTIVE", "SUSPENDED"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const updateData: Record<string, any> = {};
    if (role) updateData.role = role as MemberRole;
    if (status) updateData.status = status as MemberStatus;
    if (branchId) {
      // Verify branch exists and get orgId
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { id: true, orgId: true },
      });
      if (!branch) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
      // Direct assignment works in Prisma runtime
      updateData.branchId = branchId;
      updateData.orgId = branch.orgId;
    }

    const updated = await prisma.branchMember.update({
      where: { id },
      data: updateData,
      include: {
        org: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            auth: { select: { email: true, phone: true } },
            profile: { select: { displayName: true, username: true } },
          },
        },
      },
    });

    return res.json({
      success: true,
      data: {
        id: updated.id,
        orgId: updated.orgId,
        branchId: updated.branchId,
        userId: updated.userId,
        role: updated.role,
        status: updated.status,
        org: updated.org ? { id: updated.org.id, name: updated.org.name } : null,
        branch: updated.branch ? { id: updated.branch.id, name: updated.branch.name } : null,
        user: updated.user
          ? {
              id: updated.user.id,
              email: updated.user.auth?.email || null,
              phone: updated.user.auth?.phone || null,
              displayName: updated.user.profile?.displayName || null,
              username: updated.user.profile?.username || null,
            }
          : null,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ success: false, message: "Conflict: Staff member already exists for this branch" });
    }
    console.error("admin_staff.updateById error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// POST /api/v1/admin/staff/:id/roles
exports.assignRole = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(toInt).filter(Boolean) : [];
    if (roleIds.length === 0) {
      return res.status(400).json({ success: false, message: "roleIds array is required" });
    }

    // Verify member exists
    const member = await prisma.branchMember.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!member) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }

    // Verify all roles exist
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true },
    });
    if (roles.length !== roleIds.length) {
      return res.status(400).json({ success: false, message: "One or more roles not found" });
    }

    // Replace existing roles
    await prisma.$transaction([
      prisma.branchMemberRole.deleteMany({ where: { branchMemberId: id } }),
      ...roleIds.map((roleId) =>
        prisma.branchMemberRole.create({
          data: { branchMemberId: id, roleId },
        })
      ),
    ]);

    const updated = await prisma.branchMember.findUnique({
      where: { id },
      include: {
        roles: {
          include: {
            role: { select: { id: true, key: true, label: true } },
          },
        },
      },
    });

    return res.json({
      success: true,
      data: {
        id: updated.id,
        roles: updated.roles?.map((r) => ({ id: r.role.id, key: r.role.key, label: r.role.label })) || [],
      },
    });
  } catch (e) {
    console.error("admin_staff.assignRole error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// POST /api/v1/admin/staff/:id/branches
exports.assignBranch = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const branchId = toInt(req.body?.branchId);
    const role = req.body?.role ? String(req.body.role).toUpperCase() : null;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }
    if (!role || !["OWNER", "ORG_ADMIN", "BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "DELIVERY_MANAGER", "DELIVERY_STAFF"].includes(role)) {
      return res.status(400).json({ success: false, message: "Valid role is required" });
    }

    // Get existing member to get userId and orgId
    const existingMember = await prisma.branchMember.findUnique({
      where: { id },
      select: { id: true, userId: true, orgId: true },
    });
    if (!existingMember) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }

    // Verify branch exists and belongs to same org
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true },
    });
    if (!branch) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }
    if (branch.orgId !== existingMember.orgId) {
      return res.status(400).json({ success: false, message: "Branch must belong to the same organization" });
    }

    // Check if member already exists for this branch
    const existingBranchMember = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: existingMember.userId } },
      select: { id: true },
    });

    if (existingBranchMember) {
      // Update existing
      const updated = await prisma.branchMember.update({
        where: { id: existingBranchMember.id },
        data: { role },
        include: {
          branch: { select: { id: true, name: true } },
        },
      });
      return res.json({
        success: true,
        data: {
          id: updated.id,
          branchId: updated.branchId,
          role: updated.role,
          branch: updated.branch ? { id: updated.branch.id, name: updated.branch.name } : null,
        },
      });
    } else {
      // Create new branch assignment
      const newMember = await prisma.branchMember.create({
        data: {
          orgId: branch.orgId,
          branchId,
          userId: existingMember.userId,
          role,
          status: "ACTIVE",
        },
        include: {
          branch: { select: { id: true, name: true } },
        },
      });
      return res.status(201).json({
        success: true,
        data: {
          id: newMember.id,
          branchId: newMember.branchId,
          role: newMember.role,
          branch: newMember.branch ? { id: newMember.branch.id, name: newMember.branch.name } : null,
        },
      });
    }
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ success: false, message: "Staff member already exists for this branch" });
    }
    console.error("admin_staff.assignBranch error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
