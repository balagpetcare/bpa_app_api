const prisma = require("@prisma/client");
const { requireBranchMemberRoles, isOrgOwner } = require("../../middlewares/membership");

function branchHasType(branch, code) {
  const links = branch?.types || [];
  return links.some((x) => String(x?.type?.code || "").toUpperCase() === String(code).toUpperCase());
}

/**
 * POST /api/v1/branches/:branchId/product-change-requests
 * Branch Manager / Delivery Manager creates a PENDING product request for Owner approval.
 */
exports.createProductChangeRequest = async (req, res) => {
  try {
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

    return res.status(201).json({ success: true, data: reqRow });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};
