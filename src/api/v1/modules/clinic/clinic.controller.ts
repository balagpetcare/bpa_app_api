/**
 * Clinic (staff) controller: appointment + queue actions.
 * All routes are under /api/v1/clinic/branches/:branchId/ and use requireClinicPermission.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const appointmentService = require("./appointment.service");
const queueService = require("./queue.service");
const patientService = require("./patient.service");
const servicesService = require("../services/services.service");
const emrService = require("./emr.service");
const consultationService = require("./consultation.service");
const prescriptionService = require("./prescription.service");
const billingService = require("./billing.service");
const vaccinationService = require("./vaccination.service");
const labService = require("./lab.service");
const procedureService = require("./procedure.service");
const clinicReportsService = require("./clinicReports.service");
const intakeService = require("./intake.service");
const medicinePolicyService = require("./medicinePolicy.service");
const dispenseControlService = require("./dispenseControl.service");
const openVialService = require("./openVial.service");
const doseConsumptionService = require("./doseConsumption.service");
const treatmentCourseService = require("./treatmentCourse.service");
const returnAuditService = require("./returnAudit.service");
const auditBinService = require("./auditBin.service");
const auditIntelligenceService = require("./auditIntelligence.service");
const { sendClinicError, sendClinicSuccess, CLINIC_ERROR_CODES } = require("./clinic.responses");
const { writeClinicAudit, CLINIC_AUDIT_ACTIONS } = require("./clinic.audit");
const { emitQueueUpdated, emitNowServingChanged } = require("../../../../realtime/socketio.gateway");

function emitQueueRealtime(req: any, orgId: number, branchId: number, payload?: any) {
  try {
    emitQueueUpdated(orgId, branchId, payload || {});
  } catch (_) {}
}

exports.getSlots = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { doctorId, serviceId, date } = req.query;
    if (!date) return sendClinicError(res, 400, "date is required (YYYY-MM-DD)", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const slots = await appointmentService.getAvailableSlots(Number(branchId), {
      doctorId: doctorId ? Number(doctorId) : undefined,
      serviceId: serviceId ? Number(serviceId) : undefined,
      date: String(date),
    });
    return sendClinicSuccess(res, 200, { slots });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get slots", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

function parseQueryArray(q: any, key: string): number[] | undefined {
  const raw = q[key];
  if (raw == null) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const nums = arr.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  return nums.length ? nums : undefined;
}

function parseQueryStringArray(q: any, key: string): string[] | undefined {
  const raw = q[key];
  if (raw == null) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const strs = arr.map((x) => String(x).trim()).filter(Boolean);
  return strs.length ? strs : undefined;
}

exports.listAppointments = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const result = await appointmentService.listAppointments(Number(branchId), {
      date: q.date ? String(q.date) : undefined,
      fromDate: q.fromDate ? String(q.fromDate) : undefined,
      toDate: q.toDate ? String(q.toDate) : undefined,
      datePreset: q.datePreset ? String(q.datePreset) : undefined,
      doctorId: q.doctorId ? Number(q.doctorId) : undefined,
      doctorIds: parseQueryArray(q, "doctorId") ?? parseQueryArray(q, "doctorIds"),
      status: q.status && !Array.isArray(q.status) ? String(q.status) : undefined,
      statuses: parseQueryStringArray(q, "status") ?? parseQueryStringArray(q, "statuses"),
      serviceId: q.serviceId ? Number(q.serviceId) : undefined,
      source: q.source ? String(q.source) : undefined,
      channel: q.channel ? String(q.channel) : undefined,
      paymentStatus: q.paymentStatus ? String(q.paymentStatus) : undefined,
      visitType: q.visitType ? String(q.visitType) : undefined,
      priority: q.priority ? String(q.priority) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      sortBy: q.sortBy ? String(q.sortBy) : undefined,
      sortOrder: q.sortOrder === "desc" ? "desc" : "asc",
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list appointments", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAppointmentStats = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const result = await appointmentService.getAppointmentStats(Number(branchId), {
      date: q.date ? String(q.date) : undefined,
      fromDate: q.fromDate ? String(q.fromDate) : undefined,
      toDate: q.toDate ? String(q.toDate) : undefined,
      datePreset: q.datePreset ? String(q.datePreset) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get appointment stats", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAppointmentDoctorStats = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const result = await appointmentService.getAppointmentDoctorStats(Number(branchId), {
      date: q.date ? String(q.date) : undefined,
      fromDate: q.fromDate ? String(q.fromDate) : undefined,
      toDate: q.toDate ? String(q.toDate) : undefined,
      datePreset: q.datePreset ? String(q.datePreset) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get doctor stats", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAppointmentServiceStats = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const result = await appointmentService.getAppointmentServiceStats(Number(branchId), {
      date: q.date ? String(q.date) : undefined,
      fromDate: q.fromDate ? String(q.fromDate) : undefined,
      toDate: q.toDate ? String(q.toDate) : undefined,
      datePreset: q.datePreset ? String(q.datePreset) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get service stats", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.checkAppointmentConflict = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const doctorId = q.doctorId ? Number(q.doctorId) : undefined;
    const scheduledStartAt = q.scheduledStartAt ? new Date(q.scheduledStartAt) : undefined;
    const scheduledEndAt = q.scheduledEndAt ? new Date(q.scheduledEndAt) : undefined;
    if (doctorId == null || !scheduledStartAt || !scheduledEndAt) {
      return sendClinicError(res, 400, "doctorId, scheduledStartAt, scheduledEndAt required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const result = await appointmentService.checkAppointmentConflict(Number(branchId), {
      doctorId,
      scheduledStartAt,
      scheduledEndAt,
      excludeAppointmentId: q.excludeAppointmentId ? Number(q.excludeAppointmentId) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to check conflict", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.exportAppointments = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const filters = {
      date: q.date ? String(q.date) : undefined,
      fromDate: q.fromDate ? String(q.fromDate) : undefined,
      toDate: q.toDate ? String(q.toDate) : undefined,
      datePreset: q.datePreset ? String(q.datePreset) : undefined,
      doctorId: q.doctorId ? Number(q.doctorId) : undefined,
      doctorIds: parseQueryArray(q, "doctorId") ?? parseQueryArray(q, "doctorIds"),
      status: q.status && !Array.isArray(q.status) ? String(q.status) : undefined,
      statuses: parseQueryStringArray(q, "status") ?? parseQueryStringArray(q, "statuses"),
      serviceId: q.serviceId ? Number(q.serviceId) : undefined,
      channel: q.channel ? String(q.channel) : undefined,
      paymentStatus: q.paymentStatus ? String(q.paymentStatus) : undefined,
      visitType: q.visitType ? String(q.visitType) : undefined,
      priority: q.priority ? String(q.priority) : undefined,
    };
    const csv = await appointmentService.exportAppointments(Number(branchId), filters);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=appointments.csv");
    return res.send(csv);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to export appointments", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const userId = req.user?.id;
    const body = req.body;
    const doctorId =
      body.doctorId === "" || body.doctorId === null || body.doctorId === undefined || String(body.doctorId).toLowerCase() === "any"
        ? null
        : Number(body.doctorId);
    const appointment = await appointmentService.createAppointment(
      {
        orgId: branch.orgId,
        branchId: Number(branchId),
        patientId: Number(body.patientId),
        petId: body.petId ? Number(body.petId) : undefined,
        doctorId,
        serviceId: Number(body.serviceId),
        scheduledStartAt: new Date(body.scheduledStartAt),
        scheduledEndAt: new Date(body.scheduledEndAt),
        source: body.source || "STAFF",
        priority: body.priority || "NORMAL",
        notes: body.notes,
        idempotencyKey: body.idempotencyKey,
        visitType: body.visitType || "WALK_IN",
        isInstant: !!body.isInstant,
        isAnyDoctor: body.isAnyDoctor ?? (doctorId == null),
        channel: body.channel || "COUNTER",
        paymentStatus: body.paymentStatus,
        paymentMethod: body.paymentMethod,
        paidAmount: body.paidAmount != null ? Number(body.paidAmount) : undefined,
        paidAt: body.paidAt ? new Date(body.paidAt) : undefined,
        paidByUserId: body.paidByUserId ? Number(body.paidByUserId) : undefined,
        tokenNo: body.tokenNo,
      },
      userId
    );
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.APPOINTMENT_CREATED,
      entityType: "APPOINTMENT",
      entityId: appointment.id,
      after: { appointmentId: appointment.id },
    });
    return sendClinicSuccess(res, 201, appointment, "Appointment created");
  } catch (e: any) {
    const code =
      e?.message === CLINIC_ERROR_CODES.DOUBLE_BOOKING
        ? CLINIC_ERROR_CODES.DOUBLE_BOOKING
        : e?.message === CLINIC_ERROR_CODES.PAST_DATETIME_NOT_ALLOWED
          ? CLINIC_ERROR_CODES.PAST_DATETIME_NOT_ALLOWED
          : e?.message === CLINIC_ERROR_CODES.ADVANCE_BOOKING_LIMIT_EXCEEDED
            ? CLINIC_ERROR_CODES.ADVANCE_BOOKING_LIMIT_EXCEEDED
            : CLINIC_ERROR_CODES.VALIDATION_ERROR;
    return sendClinicError(res, 400, e?.message || "Failed to create appointment", code);
  }
};

exports.createQuickAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const userId = req.user?.id;
    const body = req.body;
    const doctorId =
      body.doctorId === "" || body.doctorId === null || body.doctorId === undefined || String(body.doctorId).toLowerCase() === "any"
        ? null
        : body.doctorId != null ? Number(body.doctorId) : null;
    const appointment = await appointmentService.createQuickAppointment(
      {
        orgId: branch.orgId,
        branchId: Number(branchId),
        patientId: body.patientId != null ? Number(body.patientId) : null,
        petId: body.petId != null && body.petId !== "" ? Number(body.petId) : null,
        doctorId,
        serviceId: Number(body.serviceId),
        scheduledStartAt: new Date(body.scheduledStartAt),
        scheduledEndAt: new Date(body.scheduledEndAt),
        status: body.status === "DRAFT" ? "DRAFT" : "PRE_BOOKED",
        ownerNameSnapshot: body.ownerNameSnapshot ?? null,
        mobileSnapshot: body.mobileSnapshot ?? null,
        petNameSnapshot: body.petNameSnapshot ?? null,
        petTypeSnapshot: body.petTypeSnapshot ?? null,
        priority: body.priority || "NORMAL",
        notes: body.notes ?? null,
      },
      userId
    );
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.APPOINTMENT_CREATED,
      entityType: "APPOINTMENT",
      entityId: appointment.id,
      after: { appointmentId: appointment.id, mode: "QUICK_CALL" },
    });
    return sendClinicSuccess(res, 201, appointment, "Quick appointment created");
  } catch (e: any) {
    const code =
      e?.message?.includes(CLINIC_ERROR_CODES.DOUBLE_BOOKING) ? CLINIC_ERROR_CODES.DOUBLE_BOOKING
        : e?.message?.includes(CLINIC_ERROR_CODES.PAST_DATETIME_NOT_ALLOWED) ? CLINIC_ERROR_CODES.PAST_DATETIME_NOT_ALLOWED
          : e?.message?.includes(CLINIC_ERROR_CODES.ADVANCE_BOOKING_LIMIT_EXCEEDED) ? CLINIC_ERROR_CODES.ADVANCE_BOOKING_LIMIT_EXCEEDED
            : CLINIC_ERROR_CODES.VALIDATION_ERROR;
    return sendClinicError(res, 400, e?.message || "Failed to create quick appointment", code);
  }
};

exports.promoteQuickAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const body = req.body;
    if (!body.patientId) return sendClinicError(res, 400, "patientId is required to promote", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const updated = await appointmentService.promoteQuickAppointment(
      appointmentId,
      {
        patientId: Number(body.patientId),
        petId: body.petId != null && body.petId !== "" ? Number(body.petId) : null,
        doctorId: body.doctorId != null && body.doctorId !== "" ? Number(body.doctorId) : undefined,
        notes: body.notes ?? undefined,
      },
      userId!,
      { orgId: branch.orgId, branchId: Number(branchId) }
    );
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.APPOINTMENT_CREATED,
      entityType: "APPOINTMENT",
      entityId: appointmentId,
      after: { promotedToBooked: true },
    });
    return sendClinicSuccess(res, 200, updated, "Appointment promoted to booked");
  } catch (e: any) {
    if (e?.statusCode === 404) return sendClinicError(res, 404, e?.message || "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    if (e?.statusCode === 409) return sendClinicError(res, 409, e?.message || "Invalid transition", CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);
    return sendClinicError(res, 400, e?.message || "Promote failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.checkDuplicateAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { mobile, petName, date } = req.query;
    const result = await appointmentService.checkDuplicateAppointment(Number(branchId), {
      mobile: String(mobile || ""),
      petName: petName != null ? String(petName) : null,
      date: String(date || ""),
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Check failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.checkInAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const ticket = await queueService.checkInAndIssueTicket(branch.orgId, Number(branchId), appointmentId, userId!);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.APPOINTMENT_CHECKED_IN,
      entityType: "APPOINTMENT",
      entityId: appointmentId,
      after: { appointmentId, ticketId: ticket.id, tokenNo: ticket.tokenNo },
    });
    emitQueueRealtime(req, branch.orgId, Number(branchId));
    return sendClinicSuccess(res, 200, { appointmentId, ticket }, "Checked in");
  } catch (e: any) {
    if (e?.statusCode === 404) return sendClinicError(res, 404, e?.message || "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    if (e?.statusCode === 409) return sendClinicError(res, 409, e?.message || "Invalid transition", CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);
    return sendClinicError(res, 400, e?.message || "Check-in failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.cancelAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const reason = req.body?.reason ?? "Cancelled by staff";
    const updated = await appointmentService.cancelAppointment(appointmentId, reason, userId!, { orgId: branch.orgId, branchId: Number(branchId) });
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
      entityType: "APPOINTMENT",
      entityId: appointmentId,
      after: { reason },
    });
    return sendClinicSuccess(res, 200, updated, "Cancelled");
  } catch (e: any) {
    if (e?.statusCode === 404) return sendClinicError(res, 404, e?.message || "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    if (e?.statusCode === 409) return sendClinicError(res, 409, e?.message || "Invalid transition", CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);
    return sendClinicError(res, 400, e?.message || "Cancel failed", CLINIC_ERROR_CODES.APPOINTMENT_ALREADY_CANCELLED);
  }
};

exports.rescheduleAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const { scheduledStartAt, scheduledEndAt, doctorId } = req.body;
    const newSlot = {
      scheduledStartAt: new Date(scheduledStartAt),
      scheduledEndAt: new Date(scheduledEndAt),
      doctorId: doctorId ? Number(doctorId) : undefined,
    };
    const created = await appointmentService.rescheduleAppointment(appointmentId, newSlot, userId!, { orgId: branch.orgId, branchId: Number(branchId) });
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.APPOINTMENT_RESCHEDULED,
      entityType: "APPOINTMENT",
      entityId: created.id,
      after: { fromAppointmentId: appointmentId },
    });
    return sendClinicSuccess(res, 201, created, "Rescheduled");
  } catch (e: any) {
    if (e?.statusCode === 404) return sendClinicError(res, 404, e?.message || "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    if (e?.statusCode === 409) return sendClinicError(res, 409, e?.message || "Invalid transition", CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);
    return sendClinicError(res, 400, e?.message || "Reschedule failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.markNoShow = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const updated = await appointmentService.markNoShow(appointmentId, userId!, { orgId: branch.orgId, branchId: Number(branchId) });
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
      entityType: "APPOINTMENT",
      entityId: appointmentId,
      after: {},
    });
    return sendClinicSuccess(res, 200, updated, "Marked no-show");
  } catch (e: any) {
    if (e?.statusCode === 404) return sendClinicError(res, 404, e?.message || "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    if (e?.statusCode === 409) return sendClinicError(res, 409, e?.message || "Invalid transition", CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getQueueSession = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const date = req.query.date ? new Date(String(req.query.date)) : new Date();
    const session = await queueService.getOrCreateSession(
      branch.orgId,
      Number(branchId),
      date,
      "GENERAL",
      req.user?.id
    );
    return sendClinicSuccess(res, 200, session);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.openQueueSession = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const date = req.body?.date ? new Date(req.body.date) : new Date();
    const session = await queueService.getOrCreateSession(
      branch.orgId,
      Number(branchId),
      date,
      "GENERAL",
      req.user?.id
    );
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.QUEUE_SESSION_OPENED,
      entityType: "QUEUE_SESSION",
      entityId: session.id,
      after: { sessionId: session.id },
    });
    return sendClinicSuccess(res, 200, session, "Session open");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.closeQueueSession = async (req: any, res: any) => {
  try {
    const sessionId = Number(req.params.sessionId ?? req.body?.sessionId);
    const userId = req.user?.id;
    const session = await queueService.closeSession(sessionId, userId!);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.QUEUE_SESSION_CLOSED,
      entityType: "QUEUE_SESSION",
      entityId: sessionId,
      after: {},
    });
    return sendClinicSuccess(res, 200, session, "Session closed");
  } catch (e: any) {
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.issueTicket = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const userId = req.user?.id;
    const body = req.body;
    const ticket = await queueService.issueTicket(
      branch.orgId,
      Number(branchId),
      {
        appointmentId: body.appointmentId ? Number(body.appointmentId) : undefined,
        patientId: body.patientId ? Number(body.patientId) : undefined,
        petId: body.petId ? Number(body.petId) : undefined,
        doctorId: body.doctorId ? Number(body.doctorId) : undefined,
        serviceId: body.serviceId ? Number(body.serviceId) : undefined,
        priorityTag: body.priorityTag || "NORMAL",
      },
      userId!
    );
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.TICKET_ISSUED,
      entityType: "QUEUE_TICKET",
      entityId: ticket.id,
      after: { tokenNo: ticket.tokenNo },
    });
    emitQueueRealtime(req, branch.orgId, Number(branchId));
    return sendClinicSuccess(res, 201, ticket, "Ticket issued");
  } catch (e: any) {
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.assignDoctor = async (req: any, res: any) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const doctorId = Number(req.body.doctorId);
    const userId = req.user?.id;
    const updated = await queueService.assignDoctor(ticketId, doctorId, userId!);
    return sendClinicSuccess(res, 200, updated, "Doctor assigned");
  } catch (e: any) {
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  }
};

exports.setPriority = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const ticketId = Number(req.params.ticketId);
    const priorityTag = req.body.priorityTag || "NORMAL";
    const userId = req.user?.id;
    const updated = await queueService.setPriority(ticketId, priorityTag, userId!);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.TICKET_PRIORITY_CHANGED,
      entityType: "QUEUE_TICKET",
      entityId: ticketId,
      after: { priorityTag },
    });
    emitQueueRealtime(req, branch.orgId, Number(branchId));
    return sendClinicSuccess(res, 200, updated, "Priority updated");
  } catch (e: any) {
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  }
};

exports.callNext = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const userId = req.user?.id;
    const doctorId = req.body?.doctorId ? Number(req.body.doctorId) : undefined;
    const called = await queueService.callNext(Number(branchId), { doctorId }, userId!);
    if (!called) return sendClinicSuccess(res, 200, { called: null }, "No waiting ticket");
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.TICKET_CALLED,
      entityType: "QUEUE_TICKET",
      entityId: called.id,
      after: { tokenNo: called.tokenNo },
    });
    emitQueueRealtime(req, branch.orgId, Number(branchId));
    emitNowServingChanged(branch.orgId, Number(branchId), { tokenNo: called.tokenNo, priorityTag: called.priorityTag });
    return sendClinicSuccess(res, 200, { called }, "Called");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.skipTicket = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const ticketId = Number(req.params.ticketId);
    const userId = req.user?.id;
    const updated = await queueService.skipTicket(ticketId, userId!);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.TICKET_SKIPPED,
      entityType: "QUEUE_TICKET",
      entityId: ticketId,
      after: {},
    });
    emitQueueRealtime(req, branch.orgId, Number(branchId));
    return sendClinicSuccess(res, 200, updated, "Skipped");
  } catch (e: any) {
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  }
};

exports.startService = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const ticketId = Number(req.params.ticketId);
    const userId = req.user?.id;
    const updated = await queueService.startService(ticketId, userId!);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.TICKET_STARTED,
      entityType: "QUEUE_TICKET",
      entityId: ticketId,
      after: {},
    });
    emitQueueRealtime(req, branch.orgId, Number(branchId));
    return sendClinicSuccess(res, 200, updated, "Started");
  } catch (e: any) {
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  }
};

exports.completeService = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const ticketId = Number(req.params.ticketId);
    const userId = req.user?.id;
    const updated = await queueService.completeService(ticketId, userId!);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.TICKET_COMPLETED,
      entityType: "QUEUE_TICKET",
      entityId: ticketId,
      after: {},
    });
    emitQueueRealtime(req, branch.orgId, Number(branchId));
    emitNowServingChanged(branch.orgId, Number(branchId), { tokenNo: "", priorityTag: "" }); // clear now serving
    return sendClinicSuccess(res, 200, updated, "Completed");
  } catch (e: any) {
    return sendClinicError(res, 400, e?.message || "Failed", CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  }
};

exports.listTickets = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { date, queueSessionId, status } = req.query;
    const tickets = await queueService.listTickets(Number(branchId), {
      date: date ? String(date) : undefined,
      queueSessionId: queueSessionId ? Number(queueSessionId) : undefined,
      status: status ? String(status) : undefined,
    });
    return sendClinicSuccess(res, 200, { tickets });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getScreenPayload = async (req: any, res: any) => {
  try {
    const branchId = req.clinicScreenBranchId ?? req.clinicBranchId ?? req.params.branchId;
    const date = req.query?.date;
    const payload = await queueService.getScreenPayload(Number(branchId), date ? String(date) : undefined);
    return sendClinicSuccess(res, 200, payload);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAppointmentById = async (req: any, res: any) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    const branchId = req.clinicBranchId;
    const appointment = await appointmentService.getAppointmentById(appointmentId, Number(branchId));
    if (!appointment) return sendClinicError(res, 404, "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    return sendClinicSuccess(res, 200, appointment);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.searchAppointments = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query.q != null ? String(req.query.q).trim() : "";
    const searchBy = req.query.searchBy != null ? String(req.query.searchBy) : "all";
    const limit = req.query.limit != null ? Number(req.query.limit) : 50;
    const result = await appointmentService.searchAppointments(Number(branchId), { query: q, searchBy, limit });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Search failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.collectAppointmentPayment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const body = req.body || {};
    const amount = Number(body.amount);
    const method = body.method ? String(body.method) : "CASH";
    if (Number.isNaN(amount) || amount <= 0) {
      return sendClinicError(res, 400, "Invalid amount", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const updated = await appointmentService.collectAppointmentPayment(
      appointmentId,
      { amount, method, collectedByUserId: userId! },
      { orgId: branch.orgId, branchId: Number(branchId) }
    );
    return sendClinicSuccess(res, 200, updated, "Payment collected");
  } catch (e: any) {
    const code =
      e?.message === CLINIC_ERROR_CODES.PAYMENT_ALREADY_COLLECTED
        ? CLINIC_ERROR_CODES.PAYMENT_ALREADY_COLLECTED
        : CLINIC_ERROR_CODES.VALIDATION_ERROR;
    return sendClinicError(res, 400, e?.message || "Failed to collect payment", code);
  }
};

exports.getAppointmentSlip = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const appointmentId = Number(req.params.appointmentId);
    const slip = await appointmentService.getAppointmentSlipData(appointmentId, Number(branchId));
    if (!slip) return sendClinicError(res, 404, "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    return sendClinicSuccess(res, 200, slip);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAppointmentPaymentSlip = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const appointmentId = Number(req.params.appointmentId);
    const slip = await appointmentService.getPaymentSlipData(appointmentId, Number(branchId));
    if (!slip) {
      return sendClinicError(
        res,
        404,
        "Appointment not found or payment not collected",
        CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND
      );
    }
    return sendClinicSuccess(res, 200, slip);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.assignAppointmentDoctor = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const body = req.body || {};
    const doctorId = body.doctorId != null ? Number(body.doctorId) : null;
    if (doctorId == null || Number.isNaN(doctorId)) {
      return sendClinicError(res, 400, "doctorId is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const updated = await appointmentService.assignDoctor(
      appointmentId,
      doctorId,
      userId!,
      { orgId: branch.orgId, branchId: Number(branchId) }
    );
    return sendClinicSuccess(res, 200, updated, "Doctor assigned");
  } catch (e: any) {
    const code =
      e?.message === CLINIC_ERROR_CODES.APPOINTMENT_DOCTOR_ALREADY_ASSIGNED
        ? CLINIC_ERROR_CODES.APPOINTMENT_DOCTOR_ALREADY_ASSIGNED
        : CLINIC_ERROR_CODES.VALIDATION_ERROR;
    return sendClinicError(res, 400, e?.message || "Failed to assign doctor", code);
  }
};

exports.getIntake = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const intake = await intakeService.getIntakeByAppointmentId(branch.orgId, Number(branchId), appointmentId);
    if (!intake) {
      return sendClinicSuccess(res, 200, { intake: null, appointmentId });
    }
    return sendClinicSuccess(res, 200, intake);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get intake", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.upsertIntake = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const body = req.body || {};
    const existingIntake = await intakeService.getIntakeByAppointmentId(branch.orgId, Number(branchId), appointmentId);
    const intake = await intakeService.upsertIntake(
      branch.orgId,
      Number(branchId),
      appointmentId,
      {
        chiefComplaint: body.chiefComplaint,
        complaintDuration: body.complaintDuration,
        complaintOnset: body.complaintOnset,
        symptomsJson: body.symptomsJson,
        additionalSymptoms: body.additionalSymptoms,
        weightKg: body.weightKg,
        tempC: body.tempC,
        heartRate: body.heartRate,
        respRate: body.respRate,
        hydrationStatus: body.hydrationStatus,
        feedingJson: body.feedingJson,
        historyJson: body.historyJson,
        riskFlagsJson: body.riskFlagsJson,
        documentsJson: body.documentsJson,
      },
      userId
    );
    const isCreate = !existingIntake;
    await writeClinicAudit({
      req,
      action: isCreate ? CLINIC_AUDIT_ACTIONS.INTAKE_CREATED : CLINIC_AUDIT_ACTIONS.INTAKE_UPDATED,
      entityType: "CLINIC_INTAKE",
      entityId: intake.id,
      after: { appointmentId, status: intake.status },
    });
    return sendClinicSuccess(res, 200, intake, isCreate ? "Intake created" : "Intake updated");
  } catch (e: any) {
    if (e?.message === "Appointment not found") return sendClinicError(res, 404, e.message, CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    return sendClinicError(res, 400, e?.message || "Failed to save intake", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctors = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const templates = await prisma.doctorScheduleTemplate.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { branchMemberId: true },
      distinct: ["branchMemberId"],
    });
    const ids = templates.map((t: any) => t.branchMemberId);
    if (ids.length === 0) return sendClinicSuccess(res, 200, { doctors: [] });
    const members = await prisma.branchMember.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        user: { select: { profile: { select: { displayName: true } } } },
      },
    });
    const doctors = members.map((m: any) => ({
      id: m.id,
      displayName: m.user?.profile?.displayName ?? "Doctor #" + m.id,
    }));
    return sendClinicSuccess(res, 200, { doctors });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list doctors", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getClinicServices = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const result = await servicesService.getServices({ branchId, limit: 500, page: 1 });
    return sendClinicSuccess(res, 200, { items: result.items || [], pagination: result.pagination || {} });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list services", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

/**
 * GET doctors with fee for a selected service. Used by Quick Appointment for pricing-aware doctor selection.
 * Returns same doctor list as getDoctors plus fee/feeLabel per doctor (from DoctorServiceFee or Service.price fallback).
 */
exports.getDoctorsWithFees = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const serviceId = req.query.serviceId != null ? Number(req.query.serviceId) : null;
    const templates = await prisma.doctorScheduleTemplate.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { branchMemberId: true },
      distinct: ["branchMemberId"],
    });
    const ids = templates.map((t: any) => t.branchMemberId);
    if (ids.length === 0) {
      return sendClinicSuccess(res, 200, { doctors: [] });
    }
    const members = await prisma.branchMember.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        user: { select: { profile: { select: { displayName: true } } } },
      },
    });
    let defaultServicePrice = null;
    if (serviceId != null) {
      const svc = await prisma.service.findFirst({
        where: { id: serviceId, branchId },
        select: { price: true },
      });
      if (svc?.price != null) defaultServicePrice = Number(svc.price);
    }
    const profiles = await prisma.clinicStaffProfile.findMany({
      where: { branchId, branchMemberId: { in: ids } },
      select: { id: true, branchMemberId: true },
    });
    const profileByMember = new Map(profiles.map((p: any) => [p.branchMemberId, p]));
    let feesByProfile = new Map();
    if (serviceId != null && profiles.length > 0) {
      const fees = await prisma.doctorServiceFee.findMany({
        where: {
          clinicStaffProfileId: { in: profiles.map((p: any) => p.id) },
          serviceId,
          isActive: true,
        },
        select: { clinicStaffProfileId: true, fee: true },
      });
      fees.forEach((f: any) => feesByProfile.set(f.clinicStaffProfileId, Number(f.fee)));
    }
    const doctors = members.map((m: any) => {
      const displayName = m.user?.profile?.displayName ?? "Doctor #" + m.id;
      const profile = profileByMember.get(m.id);
      let fee = null;
      let feeLabel = null;
      if (serviceId != null) {
        if (profile && feesByProfile.has(profile.id)) {
          fee = feesByProfile.get(profile.id);
          feeLabel = "BDT " + fee;
        } else if (defaultServicePrice != null) {
          fee = defaultServicePrice;
          feeLabel = "BDT " + fee;
        } else {
          feeLabel = "Fee varies";
        }
      }
      return { id: m.id, displayName, fee, feeLabel };
    });
    return sendClinicSuccess(res, 200, { doctors });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list doctors with fees", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Patients (pets) ---
exports.listPatients = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { limit, offset, search, ownerId } = req.query;
    const result = await patientService.listPatients(Number(branchId), {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      search: search ? String(search) : undefined,
      ownerId: ownerId != null && ownerId !== "" ? Number(ownerId) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list patients", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPatient = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const petId = Number(req.params.petId);
    const patient = await patientService.getPatientByPetId(Number(branchId), petId);
    if (!patient) return sendClinicError(res, 404, "Patient not found", CLINIC_ERROR_CODES.PATIENT_NOT_FOUND);
    return sendClinicSuccess(res, 200, patient);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPatientByUniqueId = async (req: any, res: any) => {
  try {
    const uniquePetId = req.params.uniquePetId;
    if (!uniquePetId) return sendClinicError(res, 400, "uniquePetId is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const patient = await patientService.getPatientByUniqueId(String(uniquePetId));
    if (!patient) return sendClinicError(res, 404, "Patient not found", CLINIC_ERROR_CODES.PATIENT_NOT_FOUND);
    return sendClinicSuccess(res, 200, patient);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.registerPatient = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const body = req.body;
    if (!body.userId || !body.name || !body.animalTypeId)
      return sendClinicError(res, 400, "userId, name, and animalTypeId are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const patient = await patientService.registerPatient(Number(branchId), {
      userId: Number(body.userId),
      name: body.name,
      animalTypeId: Number(body.animalTypeId),
      breedId: body.breedId != null ? Number(body.breedId) : undefined,
      sex: body.sex,
      dateOfBirth: body.dateOfBirth,
      microchipNumber: body.microchipNumber,
      allergies: body.allergies,
      bloodType: body.bloodType,
      healthCardJson: body.healthCardJson,
      notes: body.notes,
      isRescue: body.isRescue,
      isNeutered: body.isNeutered,
      foodHabits: body.foodHabits,
      healthDisorders: body.healthDisorders,
    });
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.PATIENT_REGISTERED,
      entityType: "PATIENT",
      entityId: patient.id,
      after: { petId: patient.id, uniquePetId: patient.uniquePetId },
    });
    return sendClinicSuccess(res, 201, patient, "Patient registered");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to register patient", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updatePatient = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const petId = Number(req.params.petId);
    const body = req.body;
    const patient = await patientService.updatePatient(Number(branchId), petId, {
      name: body.name,
      breedId: body.breedId,
      sex: body.sex,
      dateOfBirth: body.dateOfBirth,
      microchipNumber: body.microchipNumber,
      allergies: body.allergies,
      bloodType: body.bloodType,
      healthCardJson: body.healthCardJson,
      notes: body.notes,
      isRescue: body.isRescue,
      isNeutered: body.isNeutered,
      foodHabits: body.foodHabits,
      healthDisorders: body.healthDisorders,
      qrCodeUrl: body.qrCodeUrl,
    });
    if (!patient) return sendClinicError(res, 404, "Patient not found", CLINIC_ERROR_CODES.PATIENT_NOT_FOUND);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.PATIENT_UPDATED,
      entityType: "PATIENT",
      entityId: petId,
      after: { petId },
    });
    return sendClinicSuccess(res, 200, patient, "Patient updated");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update patient", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.findOwner = async (req: any, res: any) => {
  try {
    const q = req.query?.q ?? req.query?.phone ?? req.query?.email;
    if (!q) return sendClinicError(res, 400, "q, phone, or email is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const owner = await patientService.findOwnerByPhoneOrEmail(String(q));
    if (!owner) return sendClinicError(res, 404, "Owner not found", CLINIC_ERROR_CODES.OWNER_NOT_FOUND);
    return sendClinicSuccess(res, 200, owner);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- EMR (Visits, Vitals, Notes) ---
exports.listVisits = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { petId, patientId, limit, offset } = req.query;
    const result = await emrService.listVisits(Number(branchId), {
      petId: petId ? Number(petId) : undefined,
      patientId: patientId ? Number(patientId) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list visits", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVisit = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const visit = await emrService.getVisitById(Number(branchId), visitId, { includePreviousVisits: true });
    if (!visit) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 200, visit);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createVisit = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const body = req.body;
    if (!body.petId || !body.patientId || !body.doctorId)
      return sendClinicError(res, 400, "petId, patientId, and doctorId are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const visit = await emrService.createVisit({
      orgId: branch.orgId,
      branchId: Number(branchId),
      petId: Number(body.petId),
      patientId: Number(body.patientId),
      doctorId: Number(body.doctorId),
      appointmentId: body.appointmentId != null ? Number(body.appointmentId) : undefined,
      status: body.status,
    });
    return sendClinicSuccess(res, 201, visit, "Visit created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create visit", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateVisit = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const body = req.body;
    const visit = await emrService.updateVisit(Number(branchId), visitId, {
      status: body.status,
      startedAt: body.startedAt != null ? new Date(body.startedAt) : undefined,
      completedAt: body.completedAt != null ? new Date(body.completedAt) : undefined,
      followUpDate: body.followUpDate != null ? new Date(body.followUpDate) : undefined,
      followUpNotes: body.followUpNotes,
    });
    if (!visit) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 200, visit, "Visit updated");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update visit", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addVitalRecord = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const body = req.body;
    const record = await emrService.addVitalRecord(visitId, Number(branchId), {
      weightKg: body.weightKg != null ? Number(body.weightKg) : undefined,
      tempC: body.tempC != null ? Number(body.tempC) : undefined,
      heartRate: body.heartRate != null ? Number(body.heartRate) : undefined,
      respRate: body.respRate != null ? Number(body.respRate) : undefined,
      notes: body.notes,
    });
    if (!record) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 201, record, "Vital record added");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addClinicalNote = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const userId = req.user?.id;
    const body = req.body;
    if (!body.noteType || !body.contentJson)
      return sendClinicError(res, 400, "noteType and contentJson are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId: Number(branchId), userId: Number(userId) } },
      select: { id: true },
    });
    if (!member) return sendClinicError(res, 403, "Branch member not found", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
    const note = await emrService.addClinicalNote(visitId, Number(branchId), {
      noteType: body.noteType,
      contentJson: body.contentJson,
      createdById: member.id,
    });
    if (!note) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 201, note, "Clinical note added");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addVisitAttachment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const body = req.body;
    if (!body.fileUrl) return sendClinicError(res, 400, "fileUrl is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const att = await emrService.addVisitAttachment(visitId, Number(branchId), {
      fileUrl: body.fileUrl,
      fileName: body.fileName,
      fileType: body.fileType,
      note: body.note,
    });
    if (!att) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 201, att, "Attachment added");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Consultation templates & discharge ---
exports.listConsultationTemplates = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const templates = await consultationService.listTemplates(Number(branchId));
    return sendClinicSuccess(res, 200, { templates });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getConsultationTemplate = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const templateId = Number(req.params.templateId);
    const template = await consultationService.getTemplate(Number(branchId), templateId);
    if (!template) return sendClinicError(res, 404, "Template not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, template);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createConsultationTemplate = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const body = req.body;
    if (!body.name || !body.contentJson) return sendClinicError(res, 400, "name and contentJson are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const template = await consultationService.createTemplate(Number(branchId), branch.orgId, {
      name: body.name,
      description: body.description,
      contentJson: body.contentJson,
      isDefault: body.isDefault,
    });
    return sendClinicSuccess(res, 201, template, "Template created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateConsultationTemplate = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const templateId = Number(req.params.templateId);
    const body = req.body;
    const template = await consultationService.updateTemplate(Number(branchId), templateId, {
      name: body.name,
      description: body.description,
      contentJson: body.contentJson,
      isDefault: body.isDefault,
    });
    if (!template) return sendClinicError(res, 404, "Template not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, template, "Template updated");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.applyTemplateToVisit = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const templateId = Number(req.body.templateId);
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const userId = req.user?.id;
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId: Number(branchId), userId: Number(userId) } },
      select: { id: true },
    });
    if (!member) return sendClinicError(res, 403, "Branch member not found", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
    const note = await consultationService.applyTemplateToVisit(visitId, Number(branchId), templateId, member.id);
    if (!note) return sendClinicError(res, 404, "Visit or template not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 201, note, "Template applied");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addDischargeNote = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const body = req.body;
    const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
    const userId = req.user?.id;
    const member = await prisma.branchMember.findUnique({
      where: { branchId_userId: { branchId: Number(branchId), userId: Number(userId) } },
      select: { id: true },
    });
    if (!member) return sendClinicError(res, 403, "Branch member not found", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
    const note = await consultationService.addDischargeNote(visitId, Number(branchId), {
      contentJson: body.contentJson ?? {},
      createdByMemberId: member.id,
    });
    if (!note) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 201, note, "Discharge note added");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Prescriptions ---
exports.listPrescriptionsByVisit = async (req: any, res: any) => {
  try {
    const visitId = Number(req.params.visitId);
    const list = await prescriptionService.listByVisit(visitId);
    return sendClinicSuccess(res, 200, { prescriptions: list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createPrescription = async (req: any, res: any) => {
  try {
    const visitId = Number(req.params.visitId);
    const body = req.body;
    if (!body.petId || !body.doctorId || !Array.isArray(body.items))
      return sendClinicError(res, 400, "petId, doctorId, and items are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const prescription = await prescriptionService.createPrescription(visitId, {
      petId: Number(body.petId),
      doctorId: Number(body.doctorId),
      notes: body.notes,
      items: body.items,
    });
    return sendClinicSuccess(res, 201, prescription, "Prescription created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPrescription = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const prescription = await prescriptionService.getPrescriptionById(prescriptionId);
    if (!prescription) return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, prescription);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPrescriptionByQr = async (req: any, res: any) => {
  try {
    const qrToken = req.params.qrToken;
    if (!qrToken) return sendClinicError(res, 400, "qrToken required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const prescription = await prescriptionService.getPrescriptionByQrToken(String(qrToken));
    if (!prescription) return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, prescription);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.finalizePrescription = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const prescription = await prescriptionService.finalizePrescription(prescriptionId);
    if (!prescription) return sendClinicError(res, 400, "Prescription not found or not in DRAFT", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, prescription, "Prescription finalized");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.dispensePrescription = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const userId = req.user?.id;
    const createDispenseRequest = req.body?.createDispenseRequest === true;
    const prescription = await prescriptionService.markDispensed(prescriptionId, {
      requestedByUserId: userId ?? undefined,
      createDispenseRequest: createDispenseRequest && !!userId,
    });
    if (!prescription) return sendClinicError(res, 400, "Prescription not found or not FINALIZED", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, prescription, "Prescription dispensed");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.searchMedicine = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query?.q ?? req.query?.query ?? "";
    const limit = req.query?.limit ? Number(req.query.limit) : 20;
    const results = await prescriptionService.searchMedicine(Number(branchId), String(q), limit);
    return sendClinicSuccess(res, 200, { items: results });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Clinic Billing (Visit -> Order) ---
exports.getVisitBillingSummary = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const summary = await billingService.getBillingSummaryForVisit(visitId, Number(branchId));
    if (!summary) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 200, summary);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createVisitInvoice = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const userId = req.user?.id;
    const body = req.body;
    if (!body.customerId || !Array.isArray(body.items) || body.items.length === 0)
      return sendClinicError(res, 400, "customerId and items are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const order = await billingService.createInvoiceFromVisit(
      visitId,
      Number(branchId),
      {
        customerId: Number(body.customerId),
        items: body.items,
        paymentMethod: body.paymentMethod,
        notes: body.notes,
      },
      Number(userId)
    );
    return sendClinicSuccess(res, 201, order, "Invoice created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create invoice", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVisitOrders = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const orders = await billingService.getOrdersForVisit(visitId, Number(branchId));
    return sendClinicSuccess(res, 200, { orders });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVisitPaymentStatus = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const servicePaymentStatus = await billingService.getVisitServicePaymentStatus(visitId, Number(branchId));
    return sendClinicSuccess(res, 200, { servicePaymentStatus });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPrescriptionOrderLines = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const lines = await billingService.getPrescriptionItemsForOrder(prescriptionId);
    return sendClinicSuccess(res, 200, { items: lines });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Vaccination & Deworming ---
exports.listPetVaccinations = async (req: any, res: any) => {
  try {
    const petId = Number(req.params.petId);
    const list = await vaccinationService.listByPet(petId);
    return sendClinicSuccess(res, 200, { vaccinations: list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPetVaccinationNextDue = async (req: any, res: any) => {
  try {
    const petId = Number(req.params.petId);
    const list = await vaccinationService.getNextDueByPet(petId);
    return sendClinicSuccess(res, 200, { due: list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordVaccination = async (req: any, res: any) => {
  try {
    const body = req.body;
    if (!body.petId || !body.vaccineTypeId) return sendClinicError(res, 400, "petId and vaccineTypeId required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const v = await vaccinationService.recordVaccination({
      petId: Number(body.petId),
      vaccineTypeId: Number(body.vaccineTypeId),
      administeredAt: body.administeredAt ? new Date(body.administeredAt) : undefined,
      nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : undefined,
      batchNumber: body.batchNumber,
      manufacturer: body.manufacturer,
      vetClinic: body.vetClinic,
      notes: body.notes,
    });
    return sendClinicSuccess(res, 201, v, "Vaccination recorded");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVaccinationCertificate = async (req: any, res: any) => {
  try {
    const token = req.params.token;
    const v = await vaccinationService.getByCertificateToken(String(token));
    if (!v) return sendClinicError(res, 404, "Certificate not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, v);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listPetDeworming = async (req: any, res: any) => {
  try {
    const petId = Number(req.params.petId);
    const list = await vaccinationService.listDewormingByPet(petId);
    return sendClinicSuccess(res, 200, { records: list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordDeworming = async (req: any, res: any) => {
  try {
    const body = req.body;
    if (!body.petId || !body.medicationName) return sendClinicError(res, 400, "petId and medicationName required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await vaccinationService.recordDeworming({
      petId: Number(body.petId),
      medicationName: body.medicationName,
      dosage: body.dosage,
      weightAtTime: body.weightAtTime,
      nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : undefined,
      notes: body.notes,
    });
    return sendClinicSuccess(res, 201, r, "Deworming recorded");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Lab ---
exports.createLabRequisition = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const body = req.body;
    if (!body.visitId || !body.petId || !body.testsJson) return sendClinicError(res, 400, "visitId, petId, testsJson required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await labService.createRequisition(Number(branchId), { visitId: Number(body.visitId), petId: Number(body.petId), testsJson: body.testsJson, notes: body.notes });
    return sendClinicSuccess(res, 201, r, "Requisition created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listLabRequisitionsByVisit = async (req: any, res: any) => {
  try {
    const visitId = Number(req.params.visitId);
    const list = await labService.listRequisitionsByVisit(visitId);
    return sendClinicSuccess(res, 200, { requisitions: list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addLabReport = async (req: any, res: any) => {
  try {
    const requisitionId = Number(req.params.requisitionId);
    const body = req.body;
    const r = await labService.addReport(requisitionId, { fileUrl: body.fileUrl, abnormalFlags: body.abnormalFlags, notes: body.notes, items: body.items });
    return sendClinicSuccess(res, 201, r, "Report added");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordServiceDelivery = async (req: any, res: any) => {
  try {
    const visitId = Number(req.params.visitId);
    const body = req.body;
    if (!body.serviceId) return sendClinicError(res, 400, "serviceId required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const userId = req.user?.id;
    const r = await procedureService.recordDelivery(
      visitId,
      { serviceId: Number(body.serviceId), status: body.status, checklistJson: body.checklistJson, consumablesJson: body.consumablesJson, notes: body.notes },
      { verifiedByUserId: userId ?? undefined }
    );
    return sendClinicSuccess(res, 201, r, "Service delivery recorded");
  } catch (e: any) {
    if (e?.statusCode === 402) return sendClinicError(res, 402, e?.message || "Payment required before this service", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listVisitServiceDeliveries = async (req: any, res: any) => {
  try {
    const visitId = Number(req.params.visitId);
    const list = await procedureService.listByVisit(visitId);
    return sendClinicSuccess(res, 200, { deliveries: list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getClinicDashboardSummary = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const dateFrom = (req.query.dateFrom as string) || new Date().toISOString().slice(0, 10);
    const dateTo = (req.query.dateTo as string) || new Date().toISOString().slice(0, 10);
    const summary = await clinicReportsService.getDashboardSummary(Number(branchId), dateFrom, dateTo);
    return sendClinicSuccess(res, 200, summary);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Medicine Control (CCMLPA) ---
exports.upsertMedicinePolicy = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const orgId = req.clinicOrgId ?? (await prisma.branch.findUnique({ where: { id: Number(branchId) }, select: { orgId: true } }))?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch or org not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const variantId = Number(req.body.variantId);
    if (!variantId) return sendClinicError(res, 400, "variantId required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await medicinePolicyService.upsertPolicy(variantId, orgId, req.body);
    return sendClinicSuccess(res, 200, r, "Policy saved");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getMedicinePolicy = async (req: any, res: any) => {
  try {
    const variantId = Number(req.params.variantId);
    const r = await medicinePolicyService.getPolicyWithDefaults(variantId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listMedicinePolicies = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const orgId = req.clinicOrgId ?? (await prisma.branch.findUnique({ where: { id: Number(branchId) }, select: { orgId: true } }))?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch or org not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const q = req.query;
    const result = await medicinePolicyService.listPolicies(orgId, {
      variantId: q.variantId ? Number(q.variantId) : undefined,
      highRiskOnly: q.highRiskOnly === "true",
      skip: q.skip ? Number(q.skip) : undefined,
      take: q.take ? Number(q.take) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createDispenseRequest = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const orgId = req.clinicOrgId ?? (await prisma.branch.findUnique({ where: { id: Number(branchId) }, select: { orgId: true } }))?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch or org not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.items?.length) return sendClinicError(res, 400, "items required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await dispenseControlService.createRequest({
      branchId: Number(branchId),
      orgId,
      requestedByUserId: userId,
      patientId: body.patientId ?? null,
      visitId: body.visitId ?? null,
      surgeryCaseId: body.surgeryCaseId ?? null,
      treatmentCourseId: body.treatmentCourseId ?? null,
      urgencyLevel: body.urgencyLevel ?? "NORMAL",
      items: body.items.map((i: any) => ({ variantId: Number(i.variantId), requestedQty: Number(i.requestedQty), unit: i.unit ?? null, reason: i.reason ?? null })),
    });
    return sendClinicSuccess(res, 201, r, "Dispense request created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.approveDispenseRequest = async (req: any, res: any) => {
  try {
    const requestId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await dispenseControlService.approveRequest(requestId, userId);
    return sendClinicSuccess(res, 200, r, "Request approved");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.issueDispenseRequest = async (req: any, res: any) => {
  try {
    const requestId = Number(req.params.id);
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.locationId) return sendClinicError(res, 400, "locationId required (pharmacy fulfilment location)", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (!body.items?.length) return sendClinicError(res, 400, "items required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const items = body.items.map((i: any) => ({
      requestItemId: Number(i.requestItemId),
      issuedQty: Number(i.issuedQty),
      vialInstanceId: i.vialInstanceId ?? null,
    }));
    const r = await dispenseControlService.issueItems(requestId, Number(body.locationId), items, userId);
    return sendClinicSuccess(res, 200, r, "Items issued");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listDispenseRequests = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const result = await dispenseControlService.listRequests(Number(branchId), {
      status: q.status ?? undefined,
      visitId: q.visitId ? Number(q.visitId) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
      take: q.take ? Number(q.take) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDispenseRequestById = async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.clinicBranchId;
    const r = await dispenseControlService.getRequestById(id, Number(branchId));
    if (!r) return sendClinicError(res, 404, "Request not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getActiveVialSession = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const variantId = Number(req.params.variantId);
    const r = await openVialService.getActiveSession(Number(branchId), variantId);
    return sendClinicSuccess(res, 200, r ?? { active: false });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.openVial = async (req: any, res: any) => {
  try {
    const instanceId = Number(req.params.instanceId);
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    const vial = await prisma.vialInstance.findFirst({ where: { id: instanceId, branchId: Number(branchId) }, include: { variant: true } });
    if (!vial) return sendClinicError(res, 404, "Vial not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (body.initialQty == null) return sendClinicError(res, 400, "initialQty required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await openVialService.openVial({
      vialInstanceId: instanceId,
      variantId: vial.variantId,
      lotId: vial.lotId ?? null,
      branchId: Number(branchId),
      roomId: body.roomId ?? null,
      openedByUserId: userId,
      initialQty: Number(body.initialQty),
      openPhotoUrl: body.openPhotoUrl ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Vial opened");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.openVialSession = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.variantId || body.initialQty == null) return sendClinicError(res, 400, "variantId and initialQty required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await openVialService.openVial({
      vialInstanceId: body.vialInstanceId ?? null,
      variantId: Number(body.variantId),
      lotId: body.lotId ?? null,
      branchId: Number(branchId),
      roomId: body.roomId ?? null,
      openedByUserId: userId,
      initialQty: Number(body.initialQty),
      openPhotoUrl: body.openPhotoUrl ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Vial session opened");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordVialSessionDose = async (req: any, res: any) => {
  try {
    const sessionId = Number(req.params.id);
    const userId = req.user?.id;
    const body = req.body;
    if (body.quantityDelta == null) return sendClinicError(res, 400, "quantityDelta required (negative for amount used)", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await openVialService.recordDose(sessionId, {
      quantityDelta: Number(body.quantityDelta),
      performedByUserId: userId ?? body.performedByUserId ?? null,
      witnessUserId: body.witnessUserId ?? null,
      photoUrl: body.photoUrl ?? null,
      notes: body.notes ?? null,
    });
    return sendClinicSuccess(res, 200, r, "Dose recorded");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.closeVialSession = async (req: any, res: any) => {
  try {
    const sessionId = Number(req.params.id);
    const body = req.body;
    if (!body.status || !["EXHAUSTED", "RETURNED"].includes(body.status)) return sendClinicError(res, 400, "status required: EXHAUSTED or RETURNED", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await openVialService.closeSession(sessionId, {
      status: body.status,
      returnPhotoUrl: body.returnPhotoUrl ?? null,
      notes: body.notes ?? null,
    });
    return sendClinicSuccess(res, 200, r, "Session closed");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listVialSessions = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const result = await openVialService.listSessions(Number(branchId), {
      status: q.status ?? undefined,
      variantId: q.variantId ? Number(q.variantId) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
      take: q.take ? Number(q.take) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordDose = async (req: any, res: any) => {
  try {
    const body = req.body;
    const userId = req.user?.id;
    if (!body.patientId || body.administeredDose == null) return sendClinicError(res, 400, "patientId and administeredDose required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await doseConsumptionService.recordAdministration({
      patientId: Number(body.patientId),
      visitId: body.visitId ?? null,
      surgeryCaseId: body.surgeryCaseId ?? null,
      variantId: Number(body.variantId),
      vialSessionId: body.vialSessionId ?? null,
      prescribedDose: body.prescribedDose ?? null,
      administeredDose: Number(body.administeredDose),
      unit: body.unit ?? null,
      route: body.route ?? null,
      administeredByUserId: userId ?? body.administeredByUserId ?? null,
      witnessedByUserId: body.witnessedByUserId ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Dose recorded");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoseByVisit = async (req: any, res: any) => {
  try {
    const visitId = Number(req.params.visitId);
    const list = await doseConsumptionService.getConsumptionByVisit(visitId);
    return sendClinicSuccess(res, 200, { list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createTreatmentCourse = async (req: any, res: any) => {
  try {
    const body = req.body;
    if (!body.patientId || !body.variantId || body.totalPrescribedDoses == null) return sendClinicError(res, 400, "patientId, variantId, totalPrescribedDoses required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await treatmentCourseService.createCourse({
      patientId: Number(body.patientId),
      visitId: body.visitId ?? null,
      variantId: Number(body.variantId),
      totalPrescribedDoses: Number(body.totalPrescribedDoses),
      expectedDates: body.expectedDates ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Treatment course created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordTreatmentCourseDose = async (req: any, res: any) => {
  try {
    const courseId = Number(req.params.id);
    const body = req.body;
    const userId = req.user?.id;
    if (body.doseQty == null) return sendClinicError(res, 400, "doseQty required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await treatmentCourseService.recordCourseDose({
      courseId,
      vialSessionId: body.vialSessionId ?? null,
      doseQty: Number(body.doseQty),
      administeredByUserId: userId ?? body.administeredByUserId ?? null,
    });
    return sendClinicSuccess(res, 200, r, "Course dose recorded");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getTreatmentCourseProgress = async (req: any, res: any) => {
  try {
    const courseId = Number(req.params.id);
    const r = await treatmentCourseService.getCourseProgress(courseId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.submitVialReturn = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.vialSessionId || !body.condition) return sendClinicError(res, 400, "vialSessionId and condition required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await returnAuditService.submitReturn({
      vialSessionId: Number(body.vialSessionId),
      returnedByUserId: userId,
      condition: body.condition,
      approxRemainingQty: body.approxRemainingQty ?? null,
      returnPhotoUrl: body.returnPhotoUrl ?? null,
      receivedByUserId: body.receivedByUserId ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Return submitted");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.verifyVialReturn = async (req: any, res: any) => {
  try {
    const returnId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await returnAuditService.verifyReturn(returnId, userId);
    return sendClinicSuccess(res, 200, r, "Return verified");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.quarantineVialReturn = async (req: any, res: any) => {
  try {
    const returnId = Number(req.params.id);
    const body = req.body;
    const r = await returnAuditService.quarantineReturn(returnId, body.reason);
    return sendClinicSuccess(res, 200, r, "Return quarantined");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.assignReturnToBin = async (req: any, res: any) => {
  try {
    const returnId = Number(req.params.id);
    const auditBinId = Number(req.body.auditBinId);
    if (!auditBinId) return sendClinicError(res, 400, "auditBinId required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await returnAuditService.assignToBin(returnId, auditBinId);
    return sendClinicSuccess(res, 200, r, "Return assigned to bin");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createAuditBin = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const body = req.body;
    if (!body.binType) return sendClinicError(res, 400, "binType required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await auditBinService.createBin({
      branchId: Number(branchId),
      binType: body.binType,
      roomId: body.roomId ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Audit bin created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.sealAuditBin = async (req: any, res: any) => {
  try {
    const binId = Number(req.params.id);
    const sealNo = req.body.sealNo;
    if (!sealNo) return sendClinicError(res, 400, "sealNo required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await auditBinService.sealBin(binId, String(sealNo));
    return sendClinicSuccess(res, 200, r, "Bin sealed");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listAuditBins = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query;
    const result = await auditBinService.listBins(Number(branchId), {
      binType: q.binType ?? undefined,
      status: q.status ?? undefined,
      skip: q.skip ? Number(q.skip) : undefined,
      take: q.take ? Number(q.take) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDestructionList = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const list = await auditBinService.generateDestructionList(Number(branchId));
    return sendClinicSuccess(res, 200, { list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordDestruction = async (req: any, res: any) => {
  try {
    const auditBinId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (body.itemCount == null) return sendClinicError(res, 400, "itemCount required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await auditBinService.recordDestruction({
      auditBinId,
      destroyedByUserId: userId,
      witnessUserId: body.witnessUserId ?? null,
      approvalRequestId: body.approvalRequestId ?? null,
      itemCount: Number(body.itemCount),
      photoUrl: body.photoUrl ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Destruction recorded");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getMedicineControlBranchDashboard = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const r = await auditIntelligenceService.getBranchManagerDashboard(Number(branchId));
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getMedicineControlPharmacyDashboard = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const r = await auditIntelligenceService.getPharmacyDashboard(Number(branchId));
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getMedicineControlAuditorDashboard = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const r = await auditIntelligenceService.getAuditorDashboard(Number(branchId));
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// Clinical Item Master (staff: read-only item search and branch stock)
const clinicalItemService = require("./clinicalItem.service");
const clinicalItemStockService = require("./clinicalItemStock.service");
const clinicalStockLedgerService = require("./clinicalStockLedger.service");
const inventoryConsumptionService = require("./inventoryConsumption.service");
const clinicalSupplyRequestService = require("./clinicalSupplyRequest.service");
const clinicalStockTransferService = require("./clinicalStockTransfer.service");
const sterilizationService = require("./sterilization.service");
const instrumentInstanceService = require("./instrumentInstance.service");
const clinicalStockAuditService = require("./clinicalStockAudit.service");
const clinicalWastageService = require("./clinicalWastage.service");
const replenishmentService = require("./replenishment.service");

exports.getBranchClinicalItemSearch = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
    if (!branch) return sendClinicError(res, 404, "Branch not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const q = req.query.q ? String(req.query.q) : undefined;
    const limit = req.query.limit != null ? Math.min(Number(req.query.limit), 50) : 20;
    const items = await clinicalItemService.searchClinicalItems({ orgId: branch.orgId, q, branchId, limit });
    return sendClinicSuccess(res, 200, items);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchItemStock = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const itemId = req.query.itemId != null ? Number(req.query.itemId) : undefined;
    const variantId = req.query.variantId != null ? Number(req.query.variantId) : undefined;
    const rows = await clinicalItemStockService.getBranchItemStock({ branchId, itemId, variantId });
    return sendClinicSuccess(res, 200, rows);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchLowStockAlerts = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const alerts = await clinicalItemStockService.getLowStockAlerts(branchId);
    return sendClinicSuccess(res, 200, alerts);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchItemStockLedger = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await clinicalStockLedgerService.getClinicalStockHistory({
      branchId,
      clinicalItemId: q.clinicalItemId != null ? Number(q.clinicalItemId) : undefined,
      variantId: q.variantId != null ? Number(q.variantId) : undefined,
      limit: q.limit != null ? Number(q.limit) : 100,
      offset: q.offset != null ? Number(q.offset) : 0,
      fromDate: q.fromDate ? new Date(String(q.fromDate)) : undefined,
      toDate: q.toDate ? new Date(String(q.toDate)) : undefined,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchItemStockConsumption = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await inventoryConsumptionService.getConsumptionForBranch({
      branchId,
      limit: q.limit != null ? Number(q.limit) : 50,
      offset: q.offset != null ? Number(q.offset) : 0,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchSupplyRequests = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await clinicalSupplyRequestService.listSupplyRequests({
      branchId,
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? Number(q.limit) : 50,
      offset: q.offset != null ? Number(q.offset) : 0,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchSupplyRequestById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const requestId = Number(req.params.requestId);
    const data = await clinicalSupplyRequestService.getSupplyRequestById(requestId, { branchId });
    if (!data) return sendClinicError(res, 404, "Supply request not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchSupplyRequest = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return sendClinicError(res, 400, "items array is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await clinicalSupplyRequestService.createSupplyRequest(branchId, userId, items, {
      priority: body.priority,
      note: body.note,
    });
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchSupplyRequestSubmit = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const requestId = Number(req.params.requestId);
    const data = await clinicalSupplyRequestService.submitSupplyRequest(requestId, branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchSupplyRequestLowStockSuggestions = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const data = await clinicalSupplyRequestService.autoDetectLowStock(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchTransfers = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
    if (!branch) return sendClinicError(res, 404, "Branch not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const q = req.query || {};
    const data = await clinicalStockTransferService.getTransferHistory({
      orgId: branch.orgId,
      branchId,
      direction: q.direction as "from" | "to" | undefined,
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? Number(q.limit) : 50,
      offset: q.offset != null ? Number(q.offset) : 0,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchTransferById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const transferId = Number(req.params.transferId);
    const data = await clinicalStockTransferService.getTransferById(transferId, { toBranchId: branchId });
    if (!data) return sendClinicError(res, 404, "Transfer not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchTransferReceive = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const transferId = Number(req.params.transferId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const receivedItems = Array.isArray(body.receivedItems) ? body.receivedItems : [];
    const data = await clinicalStockTransferService.receiveTransfer(transferId, branchId, userId, receivedItems);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchItemStockAdjust = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const body = req.body || {};
    const itemId = body.itemId != null ? parseInt(String(body.itemId), 10) : null;
    const variantId = body.variantId != null ? parseInt(String(body.variantId), 10) : null;
    const deltaQty = body.deltaQty != null ? parseFloat(String(body.deltaQty)) : null;
    if (itemId == null || variantId == null || deltaQty == null || Number.isNaN(itemId) || Number.isNaN(variantId) || Number.isNaN(deltaQty)) {
      return sendClinicError(res, 400, "itemId, variantId, and deltaQty are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;
    const unitCost = body.unitCost != null ? parseFloat(String(body.unitCost)) : undefined;
    const actorId = req.user?.id;
    const data = await clinicalItemStockService.adjustBranchItemStock(branchId, itemId, variantId, deltaQty, { reason, unitCost, actorId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchItemStockReceive = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const body = req.body || {};
    const itemId = body.itemId != null ? parseInt(String(body.itemId), 10) : null;
    const variantId = body.variantId != null ? parseInt(String(body.variantId), 10) : null;
    const quantity = body.quantity != null ? parseFloat(String(body.quantity)) : null;
    if (itemId == null || variantId == null || quantity == null || Number.isNaN(itemId) || Number.isNaN(variantId) || Number.isNaN(quantity) || quantity <= 0) {
      return sendClinicError(res, 400, "itemId, variantId, and positive quantity are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const batchNo = typeof body.batchNo === "string" ? body.batchNo.trim() : undefined;
    const expiryDate = body.expiryDate ? new Date(body.expiryDate) : undefined;
    const purchaseCost = body.purchaseCost != null ? parseFloat(String(body.purchaseCost)) : undefined;
    const actorId = req.user?.id;
    if (batchNo) {
      const data = await clinicalItemStockService.createBranchItemBatch(branchId, itemId, variantId, {
        batchNo,
        expiryDate: expiryDate || undefined,
        receivedQty: quantity,
        purchaseCost,
        actorId,
      });
      return sendClinicSuccess(res, 200, data);
    }
    const data = await clinicalItemStockService.adjustBranchItemStock(branchId, itemId, variantId, quantity, { reason: "Receive", unitCost: purchaseCost, actorId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchInstrumentIssueLogs = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const status = req.query?.status === "returned" ? "returned" : req.query?.status === "open" ? "open" : undefined;
    const where = { branchId };
    if (status === "open") where.returnedAt = null;
    if (status === "returned") where.returnedAt = { not: null };
    const rows = await prisma.instrumentIssueLog.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      take: 200,
    });
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const variantIds = [...new Set(rows.map((r) => r.variantId))];
    const [items, variants] = await Promise.all([
      itemIds.length ? prisma.clinicalItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, itemCode: true } }) : [],
      variantIds.length ? prisma.clinicalItemVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, variantName: true, sku: true } }) : [],
    ]);
    const itemMap = new Map((items as any[]).map((i) => [i.id, i]));
    const variantMap = new Map((variants as any[]).map((v) => [v.id, v]));
    const data = rows.map((r) => ({
      ...r,
      item: itemMap.get(r.itemId),
      variant: variantMap.get(r.variantId),
    }));
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createBranchInstrumentIssueLog = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const body = req.body || {};
    const itemId = body.itemId != null ? parseInt(String(body.itemId), 10) : null;
    const variantId = body.variantId != null ? parseInt(String(body.variantId), 10) : null;
    const issuedQty = body.issuedQty != null ? parseFloat(String(body.issuedQty)) : null;
    if (itemId == null || variantId == null || issuedQty == null || Number.isNaN(itemId) || Number.isNaN(variantId) || Number.isNaN(issuedQty) || issuedQty <= 0) {
      return sendClinicError(res, 400, "itemId, variantId, and positive issuedQty are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const issuedToUserId = body.issuedToUserId != null ? parseInt(String(body.issuedToUserId), 10) : null;
    const procedureId = body.procedureId != null ? parseInt(String(body.procedureId), 10) : null;
    const data = await prisma.instrumentIssueLog.create({
      data: {
        branchId,
        itemId,
        variantId,
        issuedToUserId: issuedToUserId != null && !Number.isNaN(issuedToUserId) ? issuedToUserId : null,
        procedureId: procedureId != null && !Number.isNaN(procedureId) ? procedureId : null,
        issuedQty,
      },
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.returnBranchInstrumentIssueLog = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const logId = parseInt(String(req.params.logId), 10);
    if (Number.isNaN(logId)) return sendClinicError(res, 400, "Invalid logId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const returnedQty = body.returnedQty != null ? parseFloat(String(body.returnedQty)) : null;
    if (returnedQty == null || Number.isNaN(returnedQty) || returnedQty < 0) {
      return sendClinicError(res, 400, "returnedQty is required and must be >= 0", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const sterilizationStatus = typeof body.sterilizationStatus === "string" ? body.sterilizationStatus.trim() || null : null;
    const conditionNote = typeof body.conditionNote === "string" ? body.conditionNote.trim() || null : null;
    const existing = await prisma.instrumentIssueLog.findFirst({ where: { id: logId, branchId } });
    if (!existing) return sendClinicError(res, 404, "Log not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await prisma.instrumentIssueLog.update({
      where: { id: logId },
      data: {
        returnedQty,
        returnedAt: new Date(),
        sterilizationStatus,
        conditionNote,
      },
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchSterilizationCycles = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await sterilizationService.getSterilizationCycles(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? Number(q.limit) : 50,
      offset: q.offset != null ? Number(q.offset) : 0,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchSterilizationCycleById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const cycleId = Number(req.params.cycleId);
    const data = await sterilizationService.getSterilizationCycleById(cycleId, { branchId });
    if (!data) return sendClinicError(res, 404, "Cycle not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchSterilizationCycleStart = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const instrumentIds = Array.isArray(body.instrumentIds) ? body.instrumentIds.map((id: any) => Number(id)).filter((n: number) => !Number.isNaN(n)) : [];
    const method = typeof body.method === "string" ? body.method : "AUTOCLAVE";
    const data = await sterilizationService.startSterilizationCycle(branchId, instrumentIds, method, {
      machineName: body.machineName,
      operatorId: userId,
    });
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchSterilizationCycleComplete = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const cycleId = Number(req.params.cycleId);
    const body = req.body || {};
    const data = await sterilizationService.completeSterilizationCycle(cycleId, {
      sterileDays: body.sterileDays != null ? Number(body.sterileDays) : undefined,
    });
    if (!data) return sendClinicError(res, 404, "Cycle not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchSterilizationCycleFail = async (req: any, res: any) => {
  try {
    const cycleId = Number(req.params.cycleId);
    const data = await sterilizationService.failSterilizationCycle(cycleId);
    if (!data) return sendClinicError(res, 404, "Cycle not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchInstrumentInstances = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await instrumentInstanceService.listInstrumentInstances(branchId, {
      clinicalItemId: q.clinicalItemId != null ? Number(q.clinicalItemId) : undefined,
      sterilizationStatus: q.sterilizationStatus ? String(q.sterilizationStatus) : undefined,
      activeOnly: q.activeOnly !== "false",
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchSterilizationDueAlerts = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const data = await instrumentInstanceService.getDueSterilizationAlerts(branchId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchStockAudits = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await clinicalStockAuditService.listAudits(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? Number(q.limit) : 50,
      offset: q.offset != null ? Number(q.offset) : 0,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchStockAuditById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const auditId = Number(req.params.auditId);
    const data = await clinicalStockAuditService.getAuditById(auditId, { branchId });
    if (!data) return sendClinicError(res, 404, "Audit not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchStockAuditCreate = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const scope = body.scope ? String(body.scope) : "PARTIAL";
    const data = await clinicalStockAuditService.createAudit(branchId, scope, userId);
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchStockAuditStart = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const auditId = Number(req.params.auditId);
    const data = await clinicalStockAuditService.startAudit(auditId, { branchId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchStockAuditFreeze = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const auditId = Number(req.params.auditId);
    const data = await clinicalStockAuditService.freezeAudit(auditId, { branchId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchStockAuditRecordCount = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const auditId = Number(req.params.auditId);
    const body = req.body || {};
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const data = await clinicalStockAuditService.recordAuditCount(auditId, lines, { branchId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchStockAuditComplete = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const auditId = Number(req.params.auditId);
    const data = await clinicalStockAuditService.completeAudit(auditId, { branchId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchWastageLogs = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await clinicalWastageService.listWastageLogs(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? Number(q.limit) : 50,
      offset: q.offset != null ? Number(q.offset) : 0,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchWastageLogById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const wastageId = Number(req.params.wastageId);
    const data = await clinicalWastageService.getWastageLogById(wastageId, { branchId });
    if (!data) return sendClinicError(res, 404, "Wastage log not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchWastageReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const data = await clinicalWastageService.reportWastage(branchId, userId, {
      clinicalItemId: body.clinicalItemId,
      variantId: body.variantId,
      batchNo: body.batchNo,
      wastageType: body.wastageType ?? "UNEXPLAINED",
      qty: body.qty ?? 0,
      reason: body.reason,
    });
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listBranchReplenishmentRecommendations = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const data = await replenishmentService.listRecommendations(branchId, {
      status: q.status ? String(q.status) : undefined,
      limit: q.limit != null ? Number(q.limit) : 50,
      offset: q.offset != null ? Number(q.offset) : 0,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchReplenishmentGenerate = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const body = req.body || {};
    const data = await replenishmentService.generateRecommendations(branchId, {
      days: body.days ?? 30,
      requestedById: req.user?.id,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchReplenishmentConvert = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const recommendationIds = Array.isArray(body.recommendationIds) ? body.recommendationIds.map((id: any) => Number(id)) : [];
    const data = await replenishmentService.convertToSupplyRequest(branchId, recommendationIds, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchReplenishmentDismiss = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const recommendationId = Number(req.params.recommendationId);
    const data = await replenishmentService.dismissRecommendation(recommendationId, { branchId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// Enterprise: Surgery Package, Discount, Contract, Case, Settlement, Consumption, Reports
const clinicEnterprise = require("./clinicEnterprise.controller");
Object.assign(exports, clinicEnterprise);
