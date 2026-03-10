/**
 * POS branch isolation + permission guard.
 * Resolves branchId from req (params, body, query), verifies BranchMember + required POS permission.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");
const {
  BRANCH_ROLE_PERMISSIONS,
  BRANCH_DEFAULT_ROLE,
} = require("../../constants/branchRoles");

const POS_ERROR_CODES = {
  BRANCH_ACCESS_DENIED: "BRANCH_ACCESS_DENIED",
  UNAUTHORIZED: "UNAUTHORIZED",
};

function getBranchIdFromRequest(req: any): number | null {
  const fromParams = req.params?.branchId;
  const fromBody = req.body?.branchId;
  const fromQuery = req.query?.branchId;
  const raw = fromParams ?? fromBody ?? fromQuery;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? null : n;
}

function getPermissionsForRole(role: string): string[] {
  const key = String(role || "").toUpperCase();
  return (
    BRANCH_ROLE_PERMISSIONS[key] ??
    BRANCH_ROLE_PERMISSIONS[BRANCH_DEFAULT_ROLE] ??
    []
  );
}

/**
 * Middleware: require POS routes to have authenticated user, active BranchMember for branchId, and at least one of the given permissions.
 * Attaches req.posBranchId and req.posBranchMember for controllers.
 */
function requirePosPermission(...requiredPerms: string[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        code: POS_ERROR_CODES.UNAUTHORIZED,
      });
    }

    const branchId = getBranchIdFromRequest(req);
    if (branchId == null) {
      return res.status(400).json({
        success: false,
        message: "branchId is required (query, body, or params)",
        code: "VALIDATION_ERROR",
      });
    }

    const branchMember = await prisma.branchMember.findFirst({
      where: {
        userId: Number(userId),
        branchId: Number(branchId),
        status: "ACTIVE",
      },
      select: { id: true, branchId: true, role: true, userId: true },
    });

    if (!branchMember) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this branch",
        code: POS_ERROR_CODES.BRANCH_ACCESS_DENIED,
      });
    }

    const rolePerms = getPermissionsForRole(branchMember.role);
    const hasPermission =
      requiredPerms.length === 0 ||
      requiredPerms.some((p) => rolePerms.includes(p));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permission for this action",
        code: POS_ERROR_CODES.BRANCH_ACCESS_DENIED,
      });
    }

    req.posBranchId = branchMember.branchId;
    req.posBranchMember = branchMember;
    next();
  };
}

/**
 * For routes that have orderId but no branchId in path (e.g. GET /receipt/:orderId).
 * Resolves branchId from order, then checks user is BranchMember for that branch and has required permission.
 */
function requirePosPermissionForOrder(...requiredPerms: string[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        code: POS_ERROR_CODES.UNAUTHORIZED,
      });
    }

    const orderId = parseInt(req.params?.orderId, 10);
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
        code: "VALIDATION_ERROR",
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { branchId: true },
    });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
        code: "NOT_FOUND",
      });
    }

    const branchMember = await prisma.branchMember.findFirst({
      where: {
        userId: Number(userId),
        branchId: order.branchId,
        status: "ACTIVE",
      },
      select: { id: true, branchId: true, role: true, userId: true },
    });

    if (!branchMember) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this branch",
        code: POS_ERROR_CODES.BRANCH_ACCESS_DENIED,
      });
    }

    const rolePerms = getPermissionsForRole(branchMember.role);
    const hasPermission =
      requiredPerms.length === 0 ||
      requiredPerms.some((p) => rolePerms.includes(p));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permission for this action",
        code: POS_ERROR_CODES.BRANCH_ACCESS_DENIED,
      });
    }

    req.posBranchId = branchMember.branchId;
    req.posBranchMember = branchMember;
    req.posOrderId = orderId;
    next();
  };
}

module.exports = {
  requirePosPermission,
  requirePosPermissionForOrder,
  getBranchIdFromRequest,
  POS_ERROR_CODES,
};
