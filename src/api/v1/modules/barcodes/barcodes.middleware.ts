/**
 * Barcode APIs: branch access via OrgMember (owner) or BranchMember with pos.view / inventory.read.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");
const {
  BRANCH_ROLE_PERMISSIONS,
  BRANCH_DEFAULT_ROLE,
} = require("../../constants/branchRoles");

function getBranchIdFromRequest(req: any): number | null {
  const fromParams = req.params?.branchId;
  const fromBody = req.body?.branchId;
  const fromQuery = req.query?.branchId;
  const raw = fromParams ?? fromBody ?? fromQuery;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? null : n;
}

function rolePermissions(role: string): string[] {
  const key = String(role || "").toUpperCase();
  return BRANCH_ROLE_PERMISSIONS[key] ?? BRANCH_ROLE_PERMISSIONS[BRANCH_DEFAULT_ROLE] ?? [];
}

async function requireBranchBarcodeAccess(req: any, res: any, next: any) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const branchId = getBranchIdFromRequest(req);
    if (branchId == null) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true },
    });
    if (!branch) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    const orgMember = await prisma.orgMember.findFirst({
      where: { userId: Number(userId), orgId: branch.orgId, status: "ACTIVE" },
      select: { id: true },
    });
    if (orgMember) {
      req.barcodeBranchId = branchId;
      req.barcodeOrgId = branch.orgId;
      return next();
    }

    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: Number(userId), branchId, status: "ACTIVE" },
      select: { id: true, role: true },
    });
    if (!branchMember) {
      return res.status(403).json({ success: false, message: "You don't have access to this branch" });
    }
    const perms = rolePermissions(branchMember.role);
    if (!perms.includes("pos.view") && !perms.includes("inventory.read")) {
      return res.status(403).json({ success: false, message: "Insufficient permission for barcode actions" });
    }

    req.barcodeBranchId = branchId;
    req.barcodeOrgId = branch.orgId;
    return next();
  } catch (e: any) {
    console.error("requireBranchBarcodeAccess", e);
    return res.status(500).json({ success: false, message: e?.message || "Access check failed" });
  }
}

async function requireBranchLabelMutate(req: any, res: any, next: any) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const branchId = getBranchIdFromRequest(req);
    if (branchId == null) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true },
    });
    if (!branch) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    const orgMember = await prisma.orgMember.findFirst({
      where: { userId: Number(userId), orgId: branch.orgId, status: "ACTIVE" },
      select: { id: true },
    });
    if (orgMember) {
      req.barcodeBranchId = branchId;
      req.barcodeOrgId = branch.orgId;
      return next();
    }

    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: Number(userId), branchId, status: "ACTIVE" },
      select: { id: true, role: true },
    });
    if (!branchMember) {
      return res.status(403).json({ success: false, message: "You don't have access to this branch" });
    }
    const perms = rolePermissions(branchMember.role);
    if (!perms.includes("inventory.adjust")) {
      return res.status(403).json({ success: false, message: "inventory.adjust required to set label barcodes" });
    }
    req.barcodeBranchId = branchId;
    req.barcodeOrgId = branch.orgId;
    return next();
  } catch (e: any) {
    console.error("requireBranchLabelMutate", e);
    return res.status(500).json({ success: false, message: e?.message || "Access check failed" });
  }
}

module.exports = {
  requireBranchBarcodeAccess,
  requireBranchLabelMutate,
  getBranchIdFromRequest,
};
