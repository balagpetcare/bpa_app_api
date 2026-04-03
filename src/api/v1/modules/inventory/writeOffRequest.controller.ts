/**
 * WriteOff Request Controller
 * Handles HTTP requests for write-off approval workflow
 */

const service = require("./writeOffRequest.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * POST /api/v1/inventory/write-off-requests
 * Create a new write-off request
 */
exports.createWriteOffRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { orgId, locationId, reason, note, lines } = req.body;

    if (!orgId || !locationId || !reason || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "orgId, locationId, reason, and lines are required",
      });
    }

    const validReasons = ["DAMAGE", "THEFT", "OBSOLETE", "SAMPLE", "OTHER"];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        message: `Invalid reason. Must be one of: ${validReasons.join(", ")}`,
      });
    }

    // Verify user has access to org
    const isOwner = await prisma.organization.findFirst({
      where: { id: parseInt(orgId), ownerUserId: userId },
      select: { id: true },
    });
    const isMember = await prisma.orgMember.findFirst({
      where: { userId, orgId: parseInt(orgId), status: "ACTIVE" },
      select: { id: true },
    });

    if (!isOwner && !isMember) {
      return res.status(403).json({
        success: false,
        message: "Not authorized for this organization",
      });
    }

    const request = await service.createWriteOffRequest({
      orgId: parseInt(orgId),
      locationId: parseInt(locationId),
      reason,
      note,
      lines: lines.map((l) => ({
        variantId: parseInt(l.variantId),
        lotId: l.lotId ? parseInt(l.lotId) : undefined,
        quantity: parseInt(l.quantity),
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        note: l.note,
      })),
      requestedByUserId: userId,
    });

    const message = request.status === "POSTED" 
      ? "Write-off request created and auto-approved (under threshold)"
      : "Write-off request created and pending approval";

    return res.status(201).json({ success: true, data: request, message });
  } catch (error) {
    console.error("createWriteOffRequest error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create write-off request",
    });
  }
};

/**
 * GET /api/v1/inventory/write-off-requests
 * List write-off requests
 */
exports.listWriteOffRequests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { orgId, locationId, status, page, limit } = req.query;

    // If orgId specified, verify access
    if (orgId) {
      const isOwner = await prisma.organization.findFirst({
        where: { id: parseInt(orgId), ownerUserId: userId },
        select: { id: true },
      });
      const isMember = await prisma.orgMember.findFirst({
        where: { userId, orgId: parseInt(orgId), status: "ACTIVE" },
        select: { id: true },
      });

      if (!isOwner && !isMember) {
        return res.status(403).json({
          success: false,
          message: "Not authorized for this organization",
        });
      }
    } else {
      // Get user's orgs
      const ownedOrgs = await prisma.organization.findMany({
        where: { ownerUserId: userId },
        select: { id: true },
      });
      const memberOrgs = await prisma.orgMember.findMany({
        where: { userId, status: "ACTIVE" },
        select: { orgId: true },
      });
      const accessibleOrgIds = [
        ...ownedOrgs.map((o) => o.id),
        ...memberOrgs.map((m) => m.orgId),
      ];

      if (accessibleOrgIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        });
      }
    }

    const result = await service.listWriteOffRequests({
      orgId: orgId ? parseInt(orgId) : undefined,
      locationId: locationId ? parseInt(locationId) : undefined,
      status: status as any,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("listWriteOffRequests error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list write-off requests",
    });
  }
};

/**
 * GET /api/v1/inventory/write-off-requests/:id
 * Get write-off request detail
 */
exports.getWriteOffRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const request = await service.getWriteOffRequest(id);

    // Verify access
    const isOwner = await prisma.organization.findFirst({
      where: { id: request.orgId, ownerUserId: userId },
      select: { id: true },
    });
    const isMember = await prisma.orgMember.findFirst({
      where: { userId, orgId: request.orgId, status: "ACTIVE" },
      select: { id: true },
    });

    if (!isOwner && !isMember) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this request",
      });
    }

    return res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error("getWriteOffRequest error:", error);
    const status = error.message?.includes("not found") ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get write-off request",
    });
  }
};

/**
 * POST /api/v1/inventory/write-off-requests/:id/approve
 * Approve a pending write-off request
 */
exports.approveWriteOffRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const request = await service.getWriteOffRequest(id);

    // Verify approval permission (owner or warehouse manager)
    const isOwner = await prisma.organization.findFirst({
      where: { id: request.orgId, ownerUserId: userId },
      select: { id: true },
    });
    const hasPermission = await prisma.branchAccessPermission.findFirst({
      where: {
        userId,
        isActive: true,
        role: { in: ["WAREHOUSE_MANAGER", "OWNER"] },
      },
      select: { id: true },
    });

    if (!isOwner && !hasPermission) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to approve write-off requests",
      });
    }

    const updated = await service.approveWriteOffRequest(
      id,
      userId,
      req.body.rejectionNote
    );

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Write-off request approved",
    });
  } catch (error) {
    console.error("approveWriteOffRequest error:", error);
    const status = error.message?.includes("not found") ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to approve write-off request",
    });
  }
};

/**
 * POST /api/v1/inventory/write-off-requests/:id/reject
 * Reject a pending write-off request
 */
exports.rejectWriteOffRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const request = await service.getWriteOffRequest(id);

    // Verify approval permission (owner or warehouse manager)
    const isOwner = await prisma.organization.findFirst({
      where: { id: request.orgId, ownerUserId: userId },
      select: { id: true },
    });
    const hasPermission = await prisma.branchAccessPermission.findFirst({
      where: {
        userId,
        isActive: true,
        role: { in: ["WAREHOUSE_MANAGER", "OWNER"] },
      },
      select: { id: true },
    });

    if (!isOwner && !hasPermission) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to reject write-off requests",
      });
    }

    const updated = await service.rejectWriteOffRequest(
      id,
      userId,
      req.body.rejectionNote
    );

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Write-off request rejected",
    });
  } catch (error) {
    console.error("rejectWriteOffRequest error:", error);
    const status = error.message?.includes("not found") ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to reject write-off request",
    });
  }
};

/**
 * POST /api/v1/inventory/write-off-requests/:id/post
 * Post approved write-off to ledger
 */
exports.postWriteOffRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const request = await service.getWriteOffRequest(id);

    // Verify posting permission (owner or warehouse manager)
    const isOwner = await prisma.organization.findFirst({
      where: { id: request.orgId, ownerUserId: userId },
      select: { id: true },
    });
    const hasPermission = await prisma.branchAccessPermission.findFirst({
      where: {
        userId,
        isActive: true,
        role: { in: ["WAREHOUSE_MANAGER", "OWNER"] },
      },
      select: { id: true },
    });

    if (!isOwner && !hasPermission) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to post write-off requests",
      });
    }

    const updated = await service.postWriteOffRequest(id, userId);

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Write-off posted to ledger successfully",
    });
  } catch (error) {
    console.error("postWriteOffRequest error:", error);
    const status = error.message?.includes("not found") ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to post write-off request",
    });
  }
};

/**
 * GET /api/v1/inventory/write-off-requests/auto-approve-thresholds
 * Get auto-approve threshold configuration
 */
exports.getAutoApproveThresholds = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: service.AUTO_APPROVE_THRESHOLDS,
    });
  } catch (error) {
    console.error("getAutoApproveThresholds error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get thresholds",
    });
  }
};
