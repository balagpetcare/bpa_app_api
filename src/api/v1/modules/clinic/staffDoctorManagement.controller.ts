/**
 * Staff Doctor Management controller.
 * Handles all /api/v1/clinic/branches/:branchId/doctors/* and doctors/:memberId/* routes.
 */
const staffDoctorService = require("../../services/staffDoctorManagement.service");
const { sendClinicSuccess, sendClinicError, CLINIC_ERROR_CODES } = require("./clinic.responses");

function getBranchId(req: any): number {
  return Number(req.clinicBranchId ?? req.params.branchId);
}

function getMemberId(req: any): number {
  return Number(req.params.memberId);
}

function getUserId(req: any): number {
  return Number(req.user?.id ?? 0);
}

exports.getDoctorsSummary = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getDoctorsSummary(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get doctors summary", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorsAlerts = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getOperationalAlerts(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get alerts", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorsEnriched = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const filters = {
      search: req.query.search,
      speciality: req.query.speciality,
      status: req.query.status,
      verification: req.query.verification,
      dutyStatus: req.query.dutyStatus,
      bookingAvailability: req.query.bookingAvailability,
      joiningType: req.query.joiningType,
      packageAssigned: req.query.packageAssigned,
      serviceAssigned: req.query.serviceAssigned,
      feeConfigured: req.query.feeConfigured,
      limit: req.query.limit,
      offset: req.query.offset,
    };
    const data = await staffDoctorService.listDoctorsEnriched(branchId, filters);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list doctors", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorsInvite = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const userId = getUserId(req);
    const result = await staffDoctorService.inviteDoctor(branchId, req.body || {}, userId);
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to invite doctor", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorsAssignExisting = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const userId = getUserId(req);
    const result = await staffDoctorService.assignExistingDoctor(branchId, req.body || {}, userId);
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to assign doctor", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorsInviteSearch = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const query = req.query.q ?? req.query.query ?? "";
    const data = await staffDoctorService.inviteSearchDoctors(branchId, String(query));
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to search", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchInvitations = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const filters = {
      status: req.query.status,
      inviteAsDoctor: req.query.inviteAsDoctor === "true" ? true : req.query.inviteAsDoctor === "false" ? false : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };
    const data = await staffDoctorService.listBranchDoctorInvitations(branchId, filters);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list invitations", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.resendDoctorInvitation = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const inviteId = Number(req.params.inviteId);
    const userId = getUserId(req);
    if (!Number.isFinite(inviteId)) return sendClinicError(res, 400, "Invalid invite id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const { resendStaffInviteForBranch } = require("../../services/staffInvite.service");
    const data = await resendStaffInviteForBranch(prisma, branchId, inviteId, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to resend invitation", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.cancelDoctorInvitation = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const inviteId = Number(req.params.inviteId);
    const userId = getUserId(req);
    if (!Number.isFinite(inviteId)) return sendClinicError(res, 400, "Invalid invite id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const { cancelStaffInviteForBranch } = require("../../services/staffInvite.service");
    const data = await cancelStaffInviteForBranch(prisma, branchId, inviteId, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to cancel invitation", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getScheduleBoard = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const filters = {
      from: req.query.from,
      to: req.query.to,
      doctorIds: req.query.doctorIds ? (Array.isArray(req.query.doctorIds) ? req.query.doctorIds : [req.query.doctorIds]).map(Number) : undefined,
      roomId: req.query.roomId ? Number(req.query.roomId) : undefined,
    };
    const data = await staffDoctorService.getScheduleBoard(branchId, filters);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get schedule board", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getServiceMatrix = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getServiceAssignmentMatrix(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get service matrix", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.putServiceMatrix = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const userId = getUserId(req);
    const body = req.body || {};
    if (body.bulkAssign && Array.isArray(body.assignments)) {
      for (const a of body.assignments) {
        await staffDoctorService.upsertDoctorServiceMapping(branchId, a.memberId, a, userId);
      }
    }
    const data = await staffDoctorService.getServiceAssignmentMatrix(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update service matrix", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPackageMatrix = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getPackageAssignmentMatrix(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get package matrix", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getCredentialsQueue = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getCredentialsQueue(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get credentials queue", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getCertificationsBoard = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getCertificationsBoard(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get certifications board", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getLicensesBoard = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getLicensesBoard(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get licenses board", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAvailabilityBoard = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getAvailabilityBoard(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get availability board", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPendingApprovals = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const data = await staffDoctorService.getPendingApprovalsQueue(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get pending approvals", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPerformanceSummary = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const filters = {
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };
    const data = await staffDoctorService.getBranchDoctorPerformanceSummary(branchId, filters);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get performance summary", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAuditLogs = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const filters = {
      memberId: req.query.memberId ? Number(req.query.memberId) : undefined,
      action: req.query.action,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };
    const data = await staffDoctorService.getBranchDoctorAuditLogs(branchId, filters);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get audit logs", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postApprovalAction = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const requestId = Number(req.params.requestId);
    const userId = getUserId(req);
    if (!Number.isFinite(requestId)) return sendClinicError(res, 400, "Invalid request id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const decision = body.decision === "APPROVED" || body.decision === "REJECTED" ? body.decision : null;
    if (!decision) return sendClinicError(res, 400, "decision required: APPROVED or REJECTED", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const row = await prisma.clinicApprovalRequest.findUnique({
      where: { id: requestId },
      select: { id: true, branchId: true, status: true },
    });
    if (!row) return sendClinicError(res, 404, "Approval request not found", CLINIC_ERROR_CODES.NOT_FOUND);
    if (row.branchId !== branchId) return sendClinicError(res, 403, "Request does not belong to this branch", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
    if (row.status !== "PENDING") return sendClinicError(res, 400, "Request already resolved", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await staffDoctorService.approveOrRejectDoctorApprovalRequest(requestId, branchId, decision, userId, body.rejectReason);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to process approval action", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorProfile = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctorProfile(branchId, memberId);
    if (!data) return sendClinicError(res, 404, "Doctor not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get profile", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctor360Summary = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctor360Summary(branchId, memberId);
    if (!data?.profile) return sendClinicError(res, 404, "Doctor not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get 360 summary", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.patchDoctorStatus = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const status = body.status === "ACTIVE" || body.status === "INACTIVE" ? body.status : undefined;
    if (!status) return sendClinicError(res, 400, "status required: ACTIVE or INACTIVE", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await staffDoctorService.updateDoctorStatus(branchId, memberId, { status }, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update status", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorCredentials = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctorCredentials(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get credentials", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorCredential = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const data = await staffDoctorService.createOrUpdateDoctorCredential(branchId, memberId, req.body || {}, userId);
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to save credential", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.patchDoctorCredential = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const credentialId = Number(req.params.credentialId);
    const userId = getUserId(req);
    if (!Number.isFinite(credentialId)) return sendClinicError(res, 400, "Invalid credential id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await staffDoctorService.patchDoctorCredentialStatus(branchId, memberId, credentialId, req.body || {}, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update credential", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorCredentialSubmitApproval = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const credentialId = Number(req.params.credentialId);
    const userId = getUserId(req);
    if (!Number.isFinite(credentialId)) return sendClinicError(res, 400, "Invalid credential id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await staffDoctorService.submitDoctorCredentialForApproval(branchId, memberId, credentialId, userId);
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to submit for approval", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorServices = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctorServiceMappings(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get services", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.putDoctorServices = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const body = req.body || {};
    if (Array.isArray(body)) {
      for (const item of body) {
        await staffDoctorService.upsertDoctorServiceMapping(branchId, memberId, item, userId);
      }
    } else if (body.serviceId != null) {
      await staffDoctorService.upsertDoctorServiceMapping(branchId, memberId, body, userId);
    }
    const data = await staffDoctorService.getDoctorServiceMappings(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update services", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.deleteDoctorServiceMappingById = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const mappingId = Number(req.params.mappingId);
    const userId = getUserId(req);
    if (!Number.isFinite(mappingId)) return sendClinicError(res, 400, "Invalid mapping id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    await staffDoctorService.deleteDoctorServiceMapping(branchId, memberId, mappingId, userId);
    return sendClinicSuccess(res, 200, { deleted: true });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to delete service mapping", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorPackages = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctorPackageMappings(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get packages", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.putDoctorPackages = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const body = req.body || {};
    if (Array.isArray(body)) {
      for (const item of body) {
        await staffDoctorService.upsertDoctorPackageMapping(branchId, memberId, item, userId);
      }
    } else if (body.surgeryPackageId != null) {
      await staffDoctorService.upsertDoctorPackageMapping(branchId, memberId, body, userId);
    }
    const data = await staffDoctorService.getDoctorPackageMappings(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update packages", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.deleteDoctorPackageMappingById = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const mappingId = Number(req.params.mappingId);
    const userId = getUserId(req);
    if (!Number.isFinite(mappingId)) return sendClinicError(res, 400, "Invalid mapping id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    await staffDoctorService.deleteDoctorPackageMapping(branchId, memberId, mappingId, userId);
    return sendClinicSuccess(res, 200, { deleted: true });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to delete package mapping", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorSchedule = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const dateRange = { from: req.query.from, to: req.query.to };
    const data = await staffDoctorService.getDoctorSchedule(branchId, memberId, dateRange);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get schedule", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorSchedule = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const data = await staffDoctorService.createDoctorSchedule(branchId, memberId, req.body || {}, userId);
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create schedule", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.putDoctorScheduleById = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const scheduleId = Number(req.params.scheduleId);
    const userId = getUserId(req);
    const data = await staffDoctorService.updateDoctorSchedule(branchId, memberId, scheduleId, req.body || {}, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update schedule", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.deleteDoctorScheduleById = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const scheduleId = Number(req.params.scheduleId);
    const userId = getUserId(req);
    await staffDoctorService.deleteDoctorSchedule(branchId, memberId, scheduleId, userId);
    return sendClinicSuccess(res, 200, { deleted: true });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to delete schedule", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorScheduleException = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const data = await staffDoctorService.createDoctorScheduleException(branchId, memberId, req.body || {}, userId);
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create schedule exception", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.putDoctorScheduleExceptionById = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const exceptionId = Number(req.params.exceptionId);
    const userId = getUserId(req);
    const data = await staffDoctorService.updateDoctorScheduleException(branchId, memberId, exceptionId, req.body || {}, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update schedule exception", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.deleteDoctorScheduleExceptionById = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const exceptionId = Number(req.params.exceptionId);
    const userId = getUserId(req);
    await staffDoctorService.deleteDoctorScheduleException(branchId, memberId, exceptionId, userId);
    return sendClinicSuccess(res, 200, { deleted: true });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to delete schedule exception", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorFees = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctorFees(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get fees", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorFeesPropose = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const result = await staffDoctorService.proposeDoctorFeeChange(branchId, memberId, req.body || {}, userId);
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to propose fee change", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorPerformance = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const dateRange = { from: req.query.from, to: req.query.to };
    const data = await staffDoctorService.getDoctorPerformance(branchId, memberId, dateRange);
    if (!data) return sendClinicError(res, 404, "Doctor not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get performance", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorLeave = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctorLeave(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get leave", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postDoctorLeave = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const userId = getUserId(req);
    const data = await staffDoctorService.createDoctorLeaveRequest(branchId, memberId, req.body || {}, userId);
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create leave request", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorApprovals = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const data = await staffDoctorService.getDoctorApprovalHistory(branchId, memberId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get approval history", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorAuditLog = async (req: any, res: any) => {
  try {
    const branchId = getBranchId(req);
    const memberId = getMemberId(req);
    const pagination = { limit: req.query.limit, offset: req.query.offset };
    const data = await staffDoctorService.getDoctorAuditLog(branchId, memberId, pagination);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get audit log", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};
