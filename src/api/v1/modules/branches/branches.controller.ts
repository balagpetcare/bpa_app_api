const { requireBranchMemberRoles, isOrgOwner } = require("../../middlewares/membership");
const { resolveBranchAccessProfile } = require("../../services/branchAccessPermission.service");
const { createNotification } = require("../../services/notification.service");
const { createStaffInvite, getInviteableRolesForInviter } = require("../../services/staffInvite.service");

function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

function branchHasType(branch, code) {
  const links = branch?.types || [];
  return links.some((x) => String(x?.type?.code || "").toUpperCase() === String(code).toUpperCase());
}

function asIntId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return n;
}

/**
 * GET /api/v1/branches/:branchId/members/invite-allowed-roles
 * Returns roles the current user can invite for this branch (for role dropdown).
 * Branch manager gets only [BRANCH_STAFF, SELLER] (or DELIVERY_STAFF for delivery hubs); owner gets all allowed for branch type.
 */
exports.getBranchInviteAllowedRoles = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const branchId = Number(req.params.branchId);
    const userId = asIntId(req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true, types: { select: { type: { select: { code: true } } } } },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });

    const ownerByOrg = await isOrgOwner(branch.orgId, userId);
    const member = await prisma.branchMember.findFirst({
      where: { branchId, userId, status: "ACTIVE" },
      select: { role: true },
    });
    const isDeliveryHub = branchHasType(branch, "DELIVERY_HUB") || branchHasType(branch, "DELIVERY") || branchHasType(branch, "HUB");
    const managerRole = isDeliveryHub ? "DELIVERY_MANAGER" : "BRANCH_MANAGER";
    const canInvite = ownerByOrg || (member && member.role === managerRole);
    if (!canInvite) {
      return res.status(403).json({ success: false, message: "Forbidden: only owner or branch manager can invite" });
    }

    const inviterRole = ownerByOrg ? "OWNER" : (member?.role ?? managerRole);
    const allowedRoles = getInviteableRolesForInviter(inviterRole, branch);

    return res.json({ success: true, data: { allowedRoles } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

/**
 * POST /api/v1/branches/:branchId/members/invite
 * Invite staff to branch (owner or branch manager). Creates StaffInvite, sends email/SMS, notifies org owner.
 * Body: { email?, phone?, displayName?, role, permissions?, name?, message? }
 */
exports.inviteBranchMember = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const branchId = Number(req.params.branchId);
    const userId = asIntId(req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true, types: { select: { type: { select: { code: true } } } } },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });

    const ownerByOrg = await isOrgOwner(branch.orgId, userId);
    const member = await prisma.branchMember.findFirst({
      where: { branchId, userId, status: "ACTIVE" },
      select: { role: true },
    });
    const isDeliveryHub = branchHasType(branch, "DELIVERY_HUB") || branchHasType(branch, "DELIVERY") || branchHasType(branch, "HUB");
    const managerRole = isDeliveryHub ? "DELIVERY_MANAGER" : "BRANCH_MANAGER";
    const canInvite = ownerByOrg || (member && member.role === managerRole);
    if (!canInvite) {
      return res.status(403).json({ success: false, message: "Forbidden: only owner or branch manager can invite" });
    }

    const inviterRole = ownerByOrg ? "OWNER" : (member?.role ?? managerRole);
    const { invite, rawToken } = await createStaffInvite(prisma, branchId, req.body || {}, userId, inviterRole);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

    return res.status(201).json({
      success: true,
      ok: true,
      invitationId: invite.id,
      status: invite.status,
      data: {
        inviteId: invite.id,
        orgId: invite.orgId,
        branchId: invite.branchId,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        ...(isProd ? {} : { devInviteToken: rawToken }),
      },
    });
  } catch (e) {
    if (e?.message === "role is required" || e?.message === "phone or email is required" || e?.message === "Invalid role for this branch type") {
      return res.status(400).json({ success: false, message: e.message });
    }
    if (e?.message?.includes("Branch manager cannot invite")) {
      return res.status(403).json({ success: false, message: e.message });
    }
    if (e?.message === "Only owner or branch manager can invite staff") {
      return res.status(403).json({ success: false, message: e.message });
    }
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    if (String(e?.code) === "P2002") return res.status(409).json({ success: false, message: "Conflict" });
    return res.status(500).json({ success: false, message: isProd ? "Server error" : (e?.message || "Server error") });
  }
};

/**
 * POST /api/v1/branches/:branchId/product-change-requests
 * Branch Manager / Delivery Manager creates a PENDING product request for Owner approval.
 *
 * This is the canonical example of the \"Manager decision → Owner approval → state change\"
 * workflow for branch-level decisions. It is reused conceptually by the Branch Manager
 * Dashboard to submit structured change requests that owners can review and approve.
 */
exports.createProductChangeRequest = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const branchId = Number(req.params.branchId);
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        orgId: true,
        types: { select: { type: { select: { code: true } } } },
      },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });

    // Validate role vs branch type
    const isDeliveryHub = branchHasType(branch, "DELIVERY_HUB") || branchHasType(branch, "DELIVERY") || branchHasType(branch, "HUB");
    const member = await prisma.branchMember.findFirst({
      where: { branchId, userId: req.user.id, status: "ACTIVE" },
      select: { role: true, orgId: true },
    });

    const ownerByOrg = await isOrgOwner(branch.orgId, req.user.id);
    if (!member && !ownerByOrg) {
      return res.status(403).json({ success: false, message: "Forbidden: not a branch member" });
    }

    if (!ownerByOrg) {
      const allowed = isDeliveryHub ? ["DELIVERY_MANAGER"] : ["BRANCH_MANAGER"];
      if (!allowed.includes(member.role)) {
        return res.status(403).json({ success: false, message: "Forbidden: insufficient role for this branch type" });
      }
    }

    const { type, payload } = req.body || {};
    if (!type || !payload) {
      return res.status(400).json({ success: false, message: "type and payload are required" });
    }

    // type whitelist (MVP)
    const allowedTypes = ["CREATE_PRODUCT", "CREATE_VARIANT", "EDIT_PRODUCT"];
    if (!allowedTypes.includes(String(type))) {
      return res.status(400).json({ success: false, message: "Invalid type" });
    }

    const reqRow = await prisma.productChangeRequest.create({
      data: {
        orgId: branch.orgId,
        type,
        status: "PENDING",
        requestedByUserId: req.user.id,
        requestedFromBranchId: branchId,
        payload,
      },
    });

    try {
      const org = await prisma.organization.findUnique({
        where: { id: branch.orgId },
        select: { ownerUserId: true },
      });
      if (org?.ownerUserId) {
        await createNotification({
          userId: org.ownerUserId,
          type: "SYSTEM",
          title: "New product change request",
          message: `Product change request #${reqRow.id} (${type}) is pending your approval.`,
          actionUrl: `/owner/product-requests/${reqRow.id}`,
          dedupeKey: `product-change-request:${reqRow.id}`,
        });
      }
    } catch (notifErr) {
      console.warn("createProductChangeRequest notification", notifErr?.message);
    }

    return res.status(201).json({ success: true, data: reqRow });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/v1/branches/:id
 * Get branch details - accessible by staff members of the branch or owners of the organization
 */
exports.getBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = asIntId(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const branchId = asIntId(req.params.id);
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Invalid branch id' });
    }

    // Check if user is a branch member or organization owner
    const branchMember = await prisma.branchMember.findFirst({
      where: {
        branchId,
        userId,
        status: 'ACTIVE',
      },
      select: { id: true, role: true, orgId: true },
    });

    const branch = await prisma.branch.findFirst({
      where: { id: branchId },
      select: { id: true, orgId: true, name: true },
    });

    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    // Check if user is organization owner
    const isOwner = await isOrgOwner(branch.orgId, userId);

    // If user is neither a member nor an owner, deny access
    if (!branchMember && !isOwner) {
      return res.status(403).json({ success: false, message: 'Forbidden: not a branch member or organization owner' });
    }

    // Fetch full branch details
    const branchDetails = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            status: true,
            ownerUserId: true,
            supportPhone: true,
            addressJson: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        types: {
          include: {
            type: true,
          },
        },
        profileDetails: {
          include: {
            documents: {
              include: {
                media: true,
              },
              orderBy: { id: 'desc' },
            },
          },
        },
      },
    });

    if (!branchDetails) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    return res.json({ success: true, data: branchDetails });
  } catch (e) {
    console.error('[getBranch] Error:', e);
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/branches/:id/me
 * Branch-scoped "me": branch details + myAccess (role, permissions, scopes). 403 when no APPROVED access.
 */
exports.getBranchMe = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = asIntId(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const branchId = asIntId(req.params.id);
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Invalid branch id' });
    }

    const profile = await resolveBranchAccessProfile(userId, branchId);
    if (!profile) {
      return res.status(403).json({ success: false, message: 'Forbidden: no approved access to this branch' });
    }

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        org: { select: { id: true, name: true, status: true, ownerUserId: true } },
        types: { include: { type: true } },
      },
    });

    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    const featuresJson = branch.featuresJson && typeof branch.featuresJson === 'object' ? branch.featuresJson : {};
    const clinicEnabled = featuresJson.clinicEnabled === true;
    const typeFromTypes = branch.types?.[0]?.type?.code ?? null;
    const type = typeFromTypes ?? (clinicEnabled ? 'CLINIC' : null);

    const branchPayload = {
      id: branch.id,
      name: branch.name,
      orgId: branch.orgId,
      type,
      address: branch.addressJson ?? branch.address,
      lat: branch.lat ?? branch.latitude,
      lng: branch.lng ?? branch.longitude,
      org: branch.org,
      types: branch.types,
      clinicEnabled,
      ...branch,
    };

    const myAccess = {
      role: profile.role,
      permissions: profile.permissions,
      scopes: profile.scopes,
    };

    return res.json({
      success: true,
      data: {
        branch: branchPayload,
        myAccess,
      },
    });
  } catch (e) {
    console.error('[getBranchMe] Error:', e);
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};
