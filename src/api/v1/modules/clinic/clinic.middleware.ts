/**
 * Clinic branch isolation + permission guard.
 * Resolves branchId from req.params.branchId, verifies branch is CLINIC type and user has required permission via BranchAccessProfile.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");
const { resolveBranchAccessProfile } = require("../../services/branchAccessPermission.service");
const { sendClinicError, CLINIC_ERROR_CODES } = require("./clinic.responses");

const CLINIC_TYPE_CODE = "CLINIC";

function getBranchIdFromRequest(req: any): number | null {
  const raw = req.params?.branchId ?? req.body?.branchId ?? req.query?.branchId;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Middleware: require clinic routes to have authenticated user, branch must be clinic type,
 * user must have APPROVED BranchAccessPermission and at least one of the given permissions.
 * Attaches req.clinicBranchId, req.clinicBranch, req.clinicProfile for controllers.
 */
function requireClinicPermission(...requiredPerms: string[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) {
      return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    }

    const branchId = getBranchIdFromRequest(req);
    if (branchId == null) {
      return sendClinicError(res, 400, "branchId is required (params, body, or query)", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }

    const branch = await prisma.branch.findFirst({
      where: {
        id: Number(branchId),
        types: {
          some: {
            type: { code: CLINIC_TYPE_CODE },
          },
        },
      },
      select: { id: true, orgId: true, name: true, featuresJson: true },
    });

    if (!branch) {
      return sendClinicError(res, 404, "Branch not found or is not a clinic branch", CLINIC_ERROR_CODES.NOT_A_CLINIC_BRANCH);
    }

    const features = branch.featuresJson && typeof branch.featuresJson === "object" ? (branch.featuresJson as Record<string, unknown>) : {};
    if (features.clinicEnabled !== true) {
      return sendClinicError(
        res,
        403,
        "Clinic module is disabled for this branch. Owner can enable it in branch settings.",
        CLINIC_ERROR_CODES.CLINIC_MODULE_DISABLED
      );
    }

    const profile = await resolveBranchAccessProfile(Number(userId), Number(branchId));
    if (!profile) {
      return sendClinicError(res, 403, "You don't have access to this branch", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
    }

    const hasPermission =
      requiredPerms.length === 0 ||
      requiredPerms.some((p) => profile.permissions.includes(p));

    if (!hasPermission) {
      const requiredPermission = requiredPerms[0] || "clinic.appointments.read";
      return sendClinicError(res, 403, "Insufficient permission for this action", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED, {
        requiredPermission,
      });
    }

    req.clinicBranchId = branch.id;
    req.clinicBranch = { id: branch.id, orgId: branch.orgId, name: branch.name };
    req.clinicProfile = profile;
    next();
  };
}

/**
 * After requireClinicPermission: only veterinarians (ClinicStaffProfile.staffType === DOCTOR) may mutate prescriptions.
 * Sets req.clinicDoctorBranchMemberId to BranchMember.id for the current user on this branch.
 */
function requireClinicDoctorStaffForPrescriptionAuthoring() {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    const branchId = req.clinicBranchId;
    if (!userId || branchId == null) {
      return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    }

    const member = await prisma.branchMember.findFirst({
      where: { branchId: Number(branchId), userId: Number(userId), status: "ACTIVE" },
      include: { clinicStaffProfile: { select: { staffType: true } } },
    });

    const isDoctor = member?.clinicStaffProfile?.staffType === "DOCTOR";
    if (!member || !isDoctor) {
      return sendClinicError(
        res,
        403,
        "Only veterinarians may create or modify prescriptions",
        CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN
      );
    }

    req.clinicDoctorBranchMemberId = member.id;
    next();
  };
}

/**
 * Optional: validate kiosk/screen read-only token for waiting screen (branch-scoped).
 * For now returns 401 if no valid token; can be extended to accept a short-lived token in header or query.
 */
function requireClinicKioskToken() {
  return async (req: any, res: any, next: any) => {
    const token = req.headers["x-clinic-screen-token"] ?? req.query?.screenToken;
    if (!token || typeof token !== "string") {
      return sendClinicError(res, 401, "Screen token required", CLINIC_ERROR_CODES.UNAUTHORIZED);
    }
    const branchId = getBranchIdFromRequest(req);
    if (branchId == null) {
      return sendClinicError(res, 400, "branchId required with screen token", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const branch = await prisma.branch.findFirst({
      where: {
        id: Number(branchId),
        types: { some: { type: { code: CLINIC_TYPE_CODE } } },
      },
      select: { id: true, featuresJson: true },
    });
    if (!branch) {
      return sendClinicError(res, 404, "Branch not found or is not a clinic branch", CLINIC_ERROR_CODES.NOT_A_CLINIC_BRANCH);
    }
    const features = branch.featuresJson && typeof branch.featuresJson === "object" ? (branch.featuresJson as Record<string, unknown>) : {};
    if (features.clinicEnabled !== true) {
      return sendClinicError(
        res,
        403,
        "Clinic module is disabled for this branch.",
        CLINIC_ERROR_CODES.CLINIC_MODULE_DISABLED
      );
    }
    req.clinicScreenBranchId = branchId;
    next();
  };
}

module.exports = {
  requireClinicPermission,
  requireClinicDoctorStaffForPrescriptionAuthoring,
  requireClinicKioskToken,
  getBranchIdFromRequest,
  CLINIC_TYPE_CODE,
};
