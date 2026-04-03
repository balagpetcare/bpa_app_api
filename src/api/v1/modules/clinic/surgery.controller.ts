/**
 * Enterprise Surgery Module: HTTP handlers for surgery case CRUD, status, staff.
 * All routes are under /api/v1/clinic/branches/:branchId/surgeries and use requireClinicPermission.
 */
const surgeryService = require("./surgery.service");
const { sendClinicError, sendClinicSuccess, CLINIC_ERROR_CODES } = require("./clinic.responses");

exports.listSurgeries = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const { dateFrom, dateTo, status, primaryDoctorId, serviceId, petId, limit, offset } = req.query;
    const result = await surgeryService.list(branchId, {
      dateFrom: dateFrom ? String(dateFrom) : undefined,
      dateTo: dateTo ? String(dateTo) : undefined,
      status: status ? String(status) : undefined,
      primaryDoctorId: primaryDoctorId ? Number(primaryDoctorId) : undefined,
      serviceId: serviceId ? Number(serviceId) : undefined,
      petId: petId != null && petId !== "" ? Number(petId) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    const code = e?.message === "SURGERY_CASE_NOT_FOUND" ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR;
    return sendClinicError(res, e?.message === "SURGERY_CASE_NOT_FOUND" ? 404 : 500, e?.message || "Failed to list surgeries", code);
  }
};

exports.getSurgeryById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const row = await surgeryService.getById(branchId, id);
    return sendClinicSuccess(res, 200, row);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to get surgery", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createSurgery = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const orgId = req.clinicBranch?.orgId ?? req.clinicProfile?.orgId;
    const userId = req.user?.id;
    if (!orgId || !userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);

    const body = req.body || {};
    const {
      appointmentId,
      visitId,
      clinicalCaseId,
      patientId,
      petId,
      serviceId,
      surgeryPackageId,
      roomId,
      primaryDoctorId,
      surgeryType,
      priority,
      scheduledStartAt,
      scheduledEndAt,
      estimatedAmount,
      advancePaid,
      pricingSnapshotJson,
      feeRuleSnapshotJson,
    } = body;

    if (!patientId || !petId || !serviceId || !primaryDoctorId) {
      return sendClinicError(res, 400, "patientId, petId, serviceId, primaryDoctorId are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }

    const created = await surgeryService.create(branchId, orgId, userId, {
      appointmentId: appointmentId != null ? Number(appointmentId) : undefined,
      visitId: visitId != null ? Number(visitId) : undefined,
      clinicalCaseId: clinicalCaseId != null ? Number(clinicalCaseId) : undefined,
      patientId: Number(patientId),
      petId: Number(petId),
      serviceId: Number(serviceId),
      surgeryPackageId: surgeryPackageId != null ? Number(surgeryPackageId) : undefined,
      roomId: roomId != null ? Number(roomId) : undefined,
      primaryDoctorId: Number(primaryDoctorId),
      surgeryType: surgeryType ? String(surgeryType) : undefined,
      priority: priority ? String(priority) : undefined,
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : undefined,
      scheduledEndAt: scheduledEndAt ? new Date(scheduledEndAt) : undefined,
      estimatedAmount: estimatedAmount != null ? Number(estimatedAmount) : undefined,
      advancePaid: advancePaid != null ? Number(advancePaid) : undefined,
      pricingSnapshotJson: pricingSnapshotJson ?? undefined,
      feeRuleSnapshotJson: feeRuleSnapshotJson ?? undefined,
    });
    return sendClinicSuccess(res, 201, created);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create surgery case", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateSurgery = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);

    const body = req.body || {};
    const updated = await surgeryService.update(branchId, id, userId, {
      surgeryType: body.surgeryType,
      priority: body.priority,
      roomId: body.roomId != null ? Number(body.roomId) : undefined,
      scheduledStartAt: body.scheduledStartAt != null ? new Date(body.scheduledStartAt) : undefined,
      scheduledEndAt: body.scheduledEndAt != null ? new Date(body.scheduledEndAt) : undefined,
      preopNotes: body.preopNotes,
      operativeNotes: body.operativeNotes,
      postopNotes: body.postopNotes,
      complicationNotes: body.complicationNotes,
      dischargeNotes: body.dischargeNotes,
      followUpDate: body.followUpDate != null ? new Date(body.followUpDate) : undefined,
      estimatedAmount: body.estimatedAmount != null ? Number(body.estimatedAmount) : undefined,
      advancePaid: body.advancePaid != null ? Number(body.advancePaid) : undefined,
    });
    return sendClinicSuccess(res, 200, updated);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to update surgery", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.surgeryStatus = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);

    const { toStatus, reason } = req.body || {};
    if (!toStatus) return sendClinicError(res, 400, "toStatus is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);

    const updated = await surgeryService.transitionStatus(branchId, id, String(toStatus), userId, reason);
    return sendClinicSuccess(res, 200, updated);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    const isInvalidTransition = e?.message === "INVALID_STATUS_TRANSITION";
    const code = isInvalidTransition ? CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION : (isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicError(res, isInvalidTransition ? 400 : (isNotFound ? 404 : 500), e?.message || "Status update failed", code);
  }
};

exports.addSurgeryStaff = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const surgeryCaseId = Number(req.params.id);
    const { branchMemberId, role, feeType, feeValue, notes } = req.body || {};
    if (!branchMemberId || !role) {
      return sendClinicError(res, 400, "branchMemberId and role are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const updated = await surgeryService.addStaff(branchId, surgeryCaseId, {
      branchMemberId: Number(branchMemberId),
      role: String(role),
      feeType: feeType != null ? String(feeType) : undefined,
      feeValue: feeValue != null ? Number(feeValue) : undefined,
      notes: notes != null ? String(notes) : undefined,
    });
    return sendClinicSuccess(res, 200, updated);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to add staff", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateSurgeryStaff = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const surgeryCaseId = Number(req.params.id);
    const staffId = Number(req.params.staffId);
    const body = req.body || {};
    const updated = await surgeryService.updateStaff(branchId, surgeryCaseId, staffId, {
      role: body.role,
      feeType: body.feeType,
      feeValue: body.feeValue != null ? Number(body.feeValue) : undefined,
      notes: body.notes,
    });
    return sendClinicSuccess(res, 200, updated);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to update staff", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.removeSurgeryStaff = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const surgeryCaseId = Number(req.params.id);
    const staffId = Number(req.params.staffId);
    const updated = await surgeryService.removeStaff(branchId, surgeryCaseId, staffId);
    return sendClinicSuccess(res, 200, updated);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to remove staff", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Checklist (Phase 2) ---
exports.getChecklist = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const phase = req.query.phase ? String(req.query.phase) : undefined;
    const result = await surgeryService.getChecklist(branchId, id, phase);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to get checklist", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addChecklistItem = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const body = req.body || {};
    const item = await surgeryService.addChecklistItem(branchId, id, {
      phase: body.phase,
      itemLabel: body.itemLabel,
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : undefined,
    });
    return sendClinicSuccess(res, 201, item);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to add checklist item", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateChecklistItem = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const surgeryCaseId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const userId = req.user?.id;
    const body = req.body || {};
    const updated = await surgeryService.updateChecklistItem(branchId, surgeryCaseId, itemId, {
      isCompleted: body.isCompleted !== undefined ? Boolean(body.isCompleted) : undefined,
      completedByUserId: userId != null ? userId : undefined,
      notes: body.notes,
    });
    return sendClinicSuccess(res, 200, updated);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to update checklist item", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- OT room conflict (Phase 2) ---
exports.checkRoomConflict = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const { roomId, startAt, endAt, excludeSurgeryCaseId } = req.query;
    if (!roomId || !startAt || !endAt) {
      return sendClinicError(res, 400, "roomId, startAt, endAt are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const result = await surgeryService.checkRoomConflict(
      branchId,
      Number(roomId),
      new Date(startAt),
      new Date(endAt),
      excludeSurgeryCaseId != null ? Number(excludeSurgeryCaseId) : undefined
    );
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to check room conflict", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Consumables (Phase 2) ---
exports.listConsumables = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const result = await surgeryService.listConsumables(branchId, id);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to list consumables", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.planConsumables = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const body = req.body || {};
    const created = await surgeryService.planConsumables(branchId, id, { items: body.items ?? [] });
    return sendClinicSuccess(res, 201, created);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 400, e?.message || "Failed to plan consumables", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Billing (Phase 3) ---
exports.getBilling = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const result = await surgeryService.getBillingSummary(branchId, id);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to get billing", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createEstimate = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    const body = req.body || {};
    const result = await surgeryService.createEstimate(branchId, id, userId, body);
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    const isAlready = e?.message === "SURGERY_ALREADY_HAS_BILL";
    return sendClinicError(res, isNotFound ? 404 : isAlready ? 400 : 500, e?.message || "Failed to create estimate", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.finalizeBill = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const result = await surgeryService.finalizeBill(branchId, id);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    const noBill = e?.message === "SURGERY_NO_BILL";
    return sendClinicError(res, isNotFound ? 404 : noBill ? 400 : 500, e?.message || "Failed to finalize bill", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Payouts (Phase 3) ---
exports.listPayouts = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const id = Number(req.params.id);
    const result = await surgeryService.listPayouts(branchId, id);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    const isNotFound = e?.message === "SURGERY_CASE_NOT_FOUND";
    return sendClinicError(res, isNotFound ? 404 : 500, e?.message || "Failed to list payouts", isNotFound ? CLINIC_ERROR_CODES.NOT_FOUND : CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};
