/**
 * Clinic (staff) controller: appointment + queue actions.
 * All routes are under /api/v1/clinic/branches/:branchId/ and use requireClinicPermission.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const appointmentService = require("./appointment.service");
const queueService = require("./queue.service");
const patientService = require("./patient.service");
const servicesService = require("../services/services.service");
const servicePricingService = require("./servicePricing.service");
const {
  resolveServiceListPriceFromRows,
  computeDoctorFeeAmountFromRow,
} = require("./servicePricingResolution.service");
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
const injectionTokenService = require("./injectionToken.service");
const { normalizeMedicineSourceInput } = require("./medicineSource.util");
const dailyReconciliationService = require("./dailyReconciliation.service");
const treatmentCourseService = require("./treatmentCourse.service");
const dailyDueMedicineService = require("./dailyDueMedicine.service");
const exceptionOverrideService = require("./exceptionOverride.service");
const outsideMedicineService = require("./outsideMedicine.service");
const eodHandoverService = require("./eodHandover.service");
const returnAuditService = require("./returnAudit.service");
const auditBinService = require("./auditBin.service");
const auditIntelligenceService = require("./auditIntelligence.service");
const roomManagement = require("../../services/roomManagement.service");
const roomScheduling = require("../../services/roomScheduling.service");
const roomPolicy = require("../../services/roomPolicy.service");
const roomOccupancy = require("../../services/roomOccupancy.service");
const { sendClinicError, sendClinicSuccess, CLINIC_ERROR_CODES } = require("./clinic.responses");
const visitCompletionPolicy = require("../doctor/visitCompletionPolicy");
const { writeClinicAudit, CLINIC_AUDIT_ACTIONS } = require("./clinic.audit");
const { emitQueueUpdated, emitNowServingChanged, emitDoctorAppointmentUpdate } = require("../../../../realtime/socketio.gateway");

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

const appointmentAvailabilityService = require("../../services/appointmentAvailability.service");

exports.getBookingAvailableSlots = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { date, serviceId, packageId, doctorId, durationMinutes } = req.query;
    if (!date) return sendClinicError(res, 400, "date is required (YYYY-MM-DD)", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const slots = await appointmentAvailabilityService.getAvailableSlots(Number(branchId), String(date), {
      serviceId: serviceId ? Number(serviceId) : undefined,
      packageId: packageId ? Number(packageId) : undefined,
      doctorId: doctorId ? Number(doctorId) : undefined,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
    });
    return sendClinicSuccess(res, 200, { slots });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get available slots", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBookingEligibleDoctors = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { serviceId, packageId } = req.query;
    const doctors = await appointmentAvailabilityService.getEligibleDoctors(Number(branchId), {
      serviceId: serviceId ? Number(serviceId) : undefined,
      packageId: packageId ? Number(packageId) : undefined,
    });
    return sendClinicSuccess(res, 200, { doctors });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get eligible doctors", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBookingPricePreview = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { serviceId, packageId, doctorId, species } = req.query;
    const preview = await appointmentAvailabilityService.getPricePreview(Number(branchId), {
      serviceId: serviceId ? Number(serviceId) : undefined,
      packageId: packageId ? Number(packageId) : undefined,
      doctorId: doctorId ? Number(doctorId) : undefined,
      species: species ? String(species) : undefined,
    });
    return sendClinicSuccess(res, 200, preview);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get price preview", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBookingConstraints = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { date } = req.query;
    const constraints = await appointmentAvailabilityService.getBookingConstraints(
      Number(branchId),
      date ? String(date) : undefined
    );
    return sendClinicSuccess(res, 200, constraints);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get booking constraints", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBookingCompatibleRooms = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const start = q.start ? new Date(String(q.start)) : null;
    const end = q.end ? new Date(String(q.end)) : null;
    if (!start || !end || start >= end) {
      return sendClinicError(res, 400, "Query start and end (ISO datetime) required with start < end", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const serviceId = q.serviceId != null ? Number(q.serviceId) : undefined;
    const surgeryPackageId = q.surgeryPackageId != null ? Number(q.surgeryPackageId) : undefined;
    const doctorId = q.doctorId != null ? Number(q.doctorId) : undefined;
    const result = await roomPolicy.getCompatibleRoomsWithDetails(branchId, start, end, {
      serviceId,
      surgeryPackageId,
      doctorId,
    });
    return sendClinicSuccess(res, 200, { roomIds: result.roomIds, rooms: result.rooms });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get compatible rooms", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.confirmAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { appointmentId } = req.params;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const orgId = req.user?.orgId ?? (await prisma.branch.findUnique({ where: { id: Number(branchId) }, select: { orgId: true } }))?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const updated = await appointmentService.confirmAppointment(Number(appointmentId), userId, { orgId, branchId: Number(branchId) });
    return sendClinicSuccess(res, 200, updated);
  } catch (e: any) {
    return sendClinicError(res, e?.statusCode ?? 500, e?.message || "Failed to confirm appointment", CLINIC_ERROR_CODES.VALIDATION_ERROR);
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
    const doctorIdRaw =
      body.doctorId === "" || body.doctorId === null || body.doctorId === undefined || String(body.doctorId).toLowerCase() === "any"
        ? null
        : Number(body.doctorId);
    const doctorId = doctorIdRaw === 0 || Number.isNaN(doctorIdRaw) ? null : doctorIdRaw;
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
        surgeryPackageId:
          body.surgeryPackageId != null && body.surgeryPackageId !== "" ? Number(body.surgeryPackageId) : null,
        appointmentType: body.appointmentType || "CONSULTATION",
        durationMinutes: body.durationMinutes != null ? Number(body.durationMinutes) : null,
        specialInstructions: body.specialInstructions ?? null,
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
    if (appointment.doctorId != null && typeof emitDoctorAppointmentUpdate === "function") {
      try {
        const doctorMember = await prisma.branchMember.findUnique({
          where: { id: appointment.doctorId },
          select: { userId: true },
        });
        if (doctorMember?.userId) {
          emitDoctorAppointmentUpdate(doctorMember.userId, { event: "CREATED", appointmentId: appointment.id, branchId: appointment.branchId });
        }
      } catch (_) {}
    }
    return sendClinicSuccess(res, 201, appointment, "Appointment created");
  } catch (e: any) {
    const code =
      e?.message === CLINIC_ERROR_CODES.DOUBLE_BOOKING
        ? CLINIC_ERROR_CODES.DOUBLE_BOOKING
        : e?.message === CLINIC_ERROR_CODES.PAST_DATETIME_NOT_ALLOWED
          ? CLINIC_ERROR_CODES.PAST_DATETIME_NOT_ALLOWED
          : e?.message === CLINIC_ERROR_CODES.ADVANCE_BOOKING_LIMIT_EXCEEDED
            ? CLINIC_ERROR_CODES.ADVANCE_BOOKING_LIMIT_EXCEEDED
            : /^ROOM_/.test(e?.message || "")
              ? (e?.message as string)
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
    const doctorIdRaw =
      body.doctorId === "" || body.doctorId === null || body.doctorId === undefined || String(body.doctorId).toLowerCase() === "any"
        ? null
        : body.doctorId != null ? Number(body.doctorId) : null;
    const doctorId = doctorIdRaw === 0 || doctorIdRaw === null || Number.isNaN(doctorIdRaw) ? null : doctorIdRaw;
    const appointment = await appointmentService.createQuickAppointment(
      {
        orgId: branch.orgId,
        branchId: Number(branchId),
        patientId: body.patientId != null ? Number(body.patientId) : null,
        petId: body.petId != null && body.petId !== "" ? Number(body.petId) : null,
        doctorId,
        serviceId: Number(body.serviceId),
        surgeryPackageId:
          body.surgeryPackageId != null && body.surgeryPackageId !== "" ? Number(body.surgeryPackageId) : null,
        scheduledStartAt: new Date(body.scheduledStartAt),
        scheduledEndAt: new Date(body.scheduledEndAt),
        status: body.status === "DRAFT" ? "DRAFT" : "PRE_BOOKED",
        ownerNameSnapshot: body.ownerNameSnapshot ?? null,
        mobileSnapshot: body.mobileSnapshot ?? null,
        petNameSnapshot: body.petNameSnapshot ?? null,
        petTypeSnapshot: body.petTypeSnapshot ?? null,
        priority: body.priority || "NORMAL",
        notes: body.notes ?? null,
        source: body.source ?? null,
        channel: body.channel ?? null,
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
    if (appointment.doctorId != null && typeof emitDoctorAppointmentUpdate === "function") {
      try {
        const doctorMember = await prisma.branchMember.findUnique({
          where: { id: appointment.doctorId },
          select: { userId: true },
        });
        if (doctorMember?.userId) {
          emitDoctorAppointmentUpdate(doctorMember.userId, { event: "CREATED", appointmentId: appointment.id, branchId: appointment.branchId });
        }
      } catch (_) {}
    }
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
    if (e?.statusCode === 404) return sendClinicError(res, 404, e?.message || "Appointment or pet not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    if (e?.statusCode === 409) return sendClinicError(res, 409, e?.message || "Invalid transition", CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);
    if (e?.code === CLINIC_ERROR_CODES.PET_OWNER_MISMATCH) return sendClinicError(res, 400, e?.message || "Pet does not belong to owner", e.code);
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
    if (e?.code === CLINIC_ERROR_CODES.SNAPSHOT_ONLY_CANNOT_CHECK_IN) return sendClinicError(res, 400, e?.message || "Link owner and pet before check-in", e.code);
    return sendClinicError(res, 400, e?.message || "Check-in failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.enqueueAppointment = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const branch = req.clinicBranch;
    const appointmentId = Number(req.params.appointmentId);
    const userId = req.user?.id;
    const updated = await appointmentService.enqueueAppointment(appointmentId, userId!, { orgId: branch.orgId, branchId: Number(branchId) });
    await writeClinicAudit({
      req,
      action: "APPOINTMENT_ENQUEUED",
      entityType: "APPOINTMENT",
      entityId: appointmentId,
      after: { appointmentId, status: updated.status },
    });
    return sendClinicSuccess(res, 200, updated, "Enqueued");
  } catch (e: any) {
    if (e?.statusCode === 404) return sendClinicError(res, 404, e?.message || "Appointment not found", CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND);
    if (e?.statusCode === 409) return sendClinicError(res, 409, e?.message || "Invalid transition — appointment must be CHECKED_IN to enqueue", CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);
    return sendClinicError(res, 400, e?.message || "Enqueue failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
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
    const { scheduledStartAt, scheduledEndAt, doctorId, roomId } = req.body;
    const newSlot = {
      scheduledStartAt: new Date(scheduledStartAt),
      scheduledEndAt: new Date(scheduledEndAt),
      doctorId: doctorId ? Number(doctorId) : undefined,
      roomId: roomId != null ? Number(roomId) : undefined,
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
    const code = /^ROOM_/.test(e?.message || "") ? (e?.message as string) : CLINIC_ERROR_CODES.VALIDATION_ERROR;
    return sendClinicError(res, 400, e?.message || "Reschedule failed", code);
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

exports.getAppointmentEvents = async (req: any, res: any) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    const branchId = req.clinicBranchId;
    const events = await appointmentService.getAppointmentEvents(appointmentId, Number(branchId));
    return sendClinicSuccess(res, 200, { events });
  } catch (e: any) {
    const status = e?.message === CLINIC_ERROR_CODES.NOT_FOUND ? 404 : 500;
    return sendClinicError(res, status, e?.message || "Failed to get events", CLINIC_ERROR_CODES.VALIDATION_ERROR);
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
    if (e?.statusCode === 404)
      return sendClinicError(
        res,
        404,
        e?.message || "Appointment not found or not available in this branch.",
        CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND
      );
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
      entityType: "APPOINTMENT",
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

exports.createClinicService = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const orgId = req.clinicBranch?.orgId;
    const userId = req.user?.id;
    if (!orgId || !userId) return sendClinicError(res, 400, "Branch context and user required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const name = body.name?.trim();
    const category = body.category;
    const price = body.price;
    if (!name) return sendClinicError(res, 400, "Service name is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (!category) return sendClinicError(res, 400, "Service category is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (price === undefined || price === null || Number(price) < 0) return sendClinicError(res, 400, "Valid price is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const service = await servicesService.createService({
      orgId,
      branchId,
      name,
      description: body.description,
      category,
      price: Number(price),
      duration: body.duration != null ? Number(body.duration) : undefined,
      serviceCode: body.serviceCode || undefined,
      status: body.status || "ACTIVE",
      createdByUserId: userId,
      baseCost: body.baseCost != null ? Number(body.baseCost) : undefined,
      minSafePrice: body.minSafePrice != null ? Number(body.minSafePrice) : undefined,
      staffInstructions: body.staffInstructions,
      pricingExplanation: body.pricingExplanation,
      visibleToPublic: body.visibleToPublic !== undefined ? Boolean(body.visibleToPublic) : undefined,
      preparationNotes: body.preparationNotes,
      aftercareNotes: body.aftercareNotes,
      faqJson: body.faqJson,
    });
    return sendClinicSuccess(res, 201, service);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create service", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateClinicService = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const serviceId = Number(req.params.serviceId);
    const userId = req.user?.id;
    if (!serviceId || !userId) return sendClinicError(res, 400, "Service ID and user required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const updateData = {};
    if (body.name !== undefined) (updateData as any).name = body.name?.trim();
    if (body.description !== undefined) (updateData as any).description = body.description;
    if (body.category !== undefined) (updateData as any).category = body.category;
    if (body.price !== undefined) (updateData as any).price = Number(body.price);
    if (body.duration !== undefined) (updateData as any).duration = body.duration != null ? Number(body.duration) : null;
    if (body.serviceCode !== undefined) (updateData as any).serviceCode = body.serviceCode;
    if (body.status !== undefined) (updateData as any).status = body.status;
    if (body.baseCost !== undefined) (updateData as any).baseCost = body.baseCost == null ? null : Number(body.baseCost);
    if (body.minSafePrice !== undefined) (updateData as any).minSafePrice = body.minSafePrice == null ? null : Number(body.minSafePrice);
    if (body.staffInstructions !== undefined) (updateData as any).staffInstructions = body.staffInstructions;
    if (body.pricingExplanation !== undefined) (updateData as any).pricingExplanation = body.pricingExplanation;
    if (body.visibleToPublic !== undefined) (updateData as any).visibleToPublic = Boolean(body.visibleToPublic);
    if (body.preparationNotes !== undefined) (updateData as any).preparationNotes = body.preparationNotes;
    if (body.aftercareNotes !== undefined) (updateData as any).aftercareNotes = body.aftercareNotes;
    if (body.faqJson !== undefined) (updateData as any).faqJson = body.faqJson;
    const service = await servicesService.updateService(serviceId, updateData as any, branchId);
    return sendClinicSuccess(res, 200, service);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update service", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.setClinicServiceStatus = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const serviceId = Number(req.params.serviceId);
    const status = req.body?.status;
    if (!serviceId) return sendClinicError(res, 400, "Service ID required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (status !== "ACTIVE" && status !== "INACTIVE") return sendClinicError(res, 400, "status must be ACTIVE or INACTIVE", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const service = await servicesService.updateService(serviceId, { status }, branchId);
    return sendClinicSuccess(res, 200, service);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update service status", CLINIC_ERROR_CODES.VALIDATION_ERROR);
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
    let listPrice: number | null = null;
    if (serviceId != null) {
      const svc = await prisma.service.findFirst({
        where: { id: serviceId, branchId },
        include: { pricingVariants: true },
      });
      if (svc) listPrice = resolveServiceListPriceFromRows(svc);
    }
    const profiles = await prisma.clinicStaffProfile.findMany({
      where: { branchId, branchMemberId: { in: ids } },
      select: { id: true, branchMemberId: true },
    });
    const profileByMember = new Map(profiles.map((p: any) => [p.branchMemberId, p]));
    const feesByProfile = new Map<number, number>();
    if (serviceId != null && profiles.length > 0 && listPrice != null) {
      const fees = await prisma.doctorServiceFee.findMany({
        where: {
          clinicStaffProfileId: { in: profiles.map((p: any) => p.id) },
          serviceId,
          isActive: true,
        },
      });
      for (const f of fees) {
        const amt = computeDoctorFeeAmountFromRow(f, listPrice);
        if (amt <= 0) continue;
        const pid = (f as any).clinicStaffProfileId;
        const prev = feesByProfile.get(pid);
        if (prev == null || amt > prev) feesByProfile.set(pid, amt);
      }
    }
    const doctors = members.map((m: any) => {
      const displayName = m.user?.profile?.displayName ?? "Doctor #" + m.id;
      const profile = profileByMember.get(m.id);
      let fee = null;
      let feeLabel = null;
      if (serviceId != null) {
        const prof = profile as { id: number } | undefined;
        if (prof && feesByProfile.has(prof.id)) {
          fee = feesByProfile.get(prof.id);
          feeLabel = "BDT " + fee;
        } else if (listPrice != null && listPrice > 0) {
          fee = listPrice;
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

exports.getServicePricingMatrix = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = await servicePricingService.getServicePricingMatrix(branchId, { limit });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to load pricing matrix", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getServicePricingHistory = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const serviceId = Number(req.params.serviceId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    if (!serviceId) return sendClinicError(res, 400, "Invalid serviceId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await servicePricingService.listServicePricingHistory(branchId, serviceId, { limit });
    return sendClinicSuccess(res, 200, { items: data });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to load history", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorFeeHistory = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const memberId = Number(req.params.memberId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    if (!memberId) return sendClinicError(res, 400, "Invalid memberId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await servicePricingService.listDoctorFeeHistory(branchId, memberId, { limit });
    return sendClinicSuccess(res, 200, { items: data });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to load fee history", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.patchClinicServicePricing = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const serviceId = Number(req.params.serviceId);
    const userId = req.user?.id;
    if (!serviceId || !userId) return sendClinicError(res, 400, "Invalid request", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const reason = body.reason != null ? String(body.reason) : null;
    const { reason: _r, ...rest } = body;
    const data = await servicePricingService.patchBranchServicePricing(branchId, serviceId, userId, rest, reason);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update pricing", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getClinicServiceMedia = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const serviceId = Number(req.params.serviceId);
    if (!serviceId) return sendClinicError(res, 400, "Invalid serviceId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await servicePricingService.listServiceMedia(serviceId, branchId);
    return sendClinicSuccess(res, 200, { items: data });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list media", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.putClinicServiceMedia = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const serviceId = Number(req.params.serviceId);
    if (!serviceId) return sendClinicError(res, 400, "Invalid serviceId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const data = await servicePricingService.putServiceMediaOrder(serviceId, branchId, items);
    return sendClinicSuccess(res, 200, { items: data });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to save media", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Patients (pets) ---
exports.listPatients = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const { limit, offset, search, ownerId, animalTypeId } = req.query;
    const result = await patientService.listPatients(Number(branchId), {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      search: search ? String(search) : undefined,
      ownerId: ownerId != null && ownerId !== "" ? Number(ownerId) : undefined,
      animalTypeId: animalTypeId != null && animalTypeId !== "" ? Number(animalTypeId) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list patients", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPatientClinicalOverview = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const petId = Number(req.params.petId);
    const resolved = await patientService.resolvePatientClinicalOverview(Number(branchId), petId);
    if (resolved.kind === "NOT_FOUND") {
      return sendClinicError(res, 404, "Patient not found", CLINIC_ERROR_CODES.PATIENT_NOT_FOUND);
    }
    if (resolved.kind === "NOT_IN_BRANCH") {
      return sendClinicError(
        res,
        404,
        "Pet not linked to this branch",
        CLINIC_ERROR_CODES.PATIENT_NOT_IN_BRANCH
      );
    }
    return sendClinicSuccess(res, 200, resolved.data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPatient = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const petId = Number(req.params.petId);
    const resolved = await patientService.resolvePatientForBranch(Number(branchId), petId);
    if (resolved.kind === "NOT_FOUND") {
      return sendClinicError(res, 404, "Patient not found", CLINIC_ERROR_CODES.PATIENT_NOT_FOUND);
    }
    if (resolved.kind === "NOT_IN_BRANCH") {
      return sendClinicError(
        res,
        404,
        "Pet not linked to this branch",
        CLINIC_ERROR_CODES.PATIENT_NOT_IN_BRANCH
      );
    }
    return sendClinicSuccess(res, 200, resolved.data);
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
      subBreedId: body.subBreedId != null ? Number(body.subBreedId) : undefined,
      colorId: body.colorId != null ? Number(body.colorId) : undefined,
      coatPatternId: body.coatPatternId != null ? Number(body.coatPatternId) : undefined,
      sizeId: body.sizeId != null ? Number(body.sizeId) : undefined,
      customBreedText: body.customBreedText,
      customColorText: body.customColorText,
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
    if (e?.code === CLINIC_ERROR_CODES.DUPLICATE_PET || e?.code === "DUPLICATE_PET") return sendClinicError(res, 409, e?.message || "Duplicate pet", CLINIC_ERROR_CODES.DUPLICATE_PET);
    return sendClinicError(res, 500, e?.message || "Failed to register patient", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.linkOwner = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const petId = Number(req.params.petId);
    const userId = req.body?.userId != null ? Number(req.body.userId) : null;
    if (!userId || !Number.isFinite(userId))
      return sendClinicError(res, 400, "userId is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const patient = await patientService.linkPetToOwner(Number(branchId), petId, userId);
    if (!patient) return sendClinicError(res, 404, "Patient or owner not found", CLINIC_ERROR_CODES.PATIENT_NOT_FOUND);
    return sendClinicSuccess(res, 200, patient, "Owner linked");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to link owner", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updatePatient = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const petId = Number(req.params.petId);
    const body = req.body;
    const access = await patientService.resolvePatientForBranch(Number(branchId), petId);
    if (access.kind === "NOT_FOUND") {
      return sendClinicError(res, 404, "Patient not found", CLINIC_ERROR_CODES.PATIENT_NOT_FOUND);
    }
    if (access.kind === "NOT_IN_BRANCH") {
      return sendClinicError(
        res,
        404,
        "Pet not linked to this branch",
        CLINIC_ERROR_CODES.PATIENT_NOT_IN_BRANCH
      );
    }
    const patient = await patientService.updatePatient(Number(branchId), petId, {
      name: body.name,
      breedId: body.breedId,
      subBreedId: body.subBreedId,
      colorId: body.colorId,
      coatPatternId: body.coatPatternId,
      sizeId: body.sizeId,
      customBreedText: body.customBreedText,
      customColorText: body.customColorText,
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

exports.ensureOwner = async (req: any, res: any) => {
  try {
    const body = req.body || {};
    const phone = (body.phone ?? "").toString().trim() || undefined;
    const email = (body.email ?? "").toString().trim() || undefined;
    const displayName = (body.displayName ?? body.name ?? "").toString().trim() || undefined;

    if (!phone && !email) {
      return sendClinicError(res, 400, "Phone or email is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }

    const owner = await patientService.ensureOwner({ phone, email, displayName });
    if (!owner) return sendClinicError(res, 400, "Could not resolve or create owner", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicSuccess(res, 200, owner, owner.id ? "Owner found or created" : "Owner");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to ensure owner", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

const VISIT_STATUS_FILTER_WHITELIST = new Set(["CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

/** YYYY-MM-DD from date inputs = inclusive UTC calendar day; other strings pass through Date parsing. */
function visitQueryFromDate(raw: unknown): Date | undefined {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00.000Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function visitQueryToDateInclusive(raw: unknown): Date | undefined {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function isRequestedVisitStatusCompleted(raw: unknown): boolean {
  return raw != null && String(raw).trim().toUpperCase() === "COMPLETED";
}

function parseVisitStatusList(q: any): string[] | undefined {
  const raw = q.status;
  if (raw == null || raw === "") return undefined;
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  const tokens = parts.map((s: any) => String(s).trim().toUpperCase()).filter(Boolean);
  if (!tokens.length) return undefined;
  const invalid = tokens.filter((s) => !VISIT_STATUS_FILTER_WHITELIST.has(s));
  if (invalid.length) {
    const err: any = new Error(`Invalid visit status in filter: ${invalid.join(", ")}`);
    err.code = "INVALID_VISIT_STATUS_FILTER";
    throw err;
  }
  return tokens;
}

function csvEscapeCell(val: any): string {
  if (val == null) return "";
  let s = String(val);
  const formulaRisk = /^[=+\-@]/.test(s);
  // Reduce CSV/formula-injection risk when opened in spreadsheets
  if (formulaRisk) s = `'${s}`;
  if (formulaRisk || /[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// --- EMR (Visits, Vitals, Notes) ---
exports.listVisits = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query || {};
    let statusFilter: string[] | undefined;
    try {
      statusFilter = parseVisitStatusList(q);
    } catch (e: any) {
      if (e?.code === "INVALID_VISIT_STATUS_FILTER") {
        return sendClinicError(res, 400, e.message || "Invalid status filter", CLINIC_ERROR_CODES.VALIDATION_ERROR);
      }
      throw e;
    }
    const hasAppointment =
      q.hasAppointment === "true" ? true : q.hasAppointment === "false" ? false : undefined;
    const unpaidOnly = q.unpaidOnly === "true" || q.unpaidOnly === "1";
    const sortDir = q.sortDir === "asc" ? "asc" : q.sortDir === "desc" ? "desc" : undefined;
    const result = await emrService.listVisits(Number(branchId), {
      petId: q.petId != null ? Number(q.petId) : undefined,
      patientId: q.patientId != null ? Number(q.patientId) : undefined,
      limit: q.limit != null ? Number(q.limit) : undefined,
      offset: q.offset != null ? Number(q.offset) : undefined,
      treatmentCode: q.treatmentCode ? String(q.treatmentCode) : undefined,
      fromDate: visitQueryFromDate(q.fromDate),
      toDate: visitQueryToDateInclusive(q.toDate),
      search: q.search ? String(q.search) : undefined,
      status: statusFilter,
      doctorId: q.doctorId != null && q.doctorId !== "" ? Number(q.doctorId) : undefined,
      appointmentId: q.appointmentId != null && q.appointmentId !== "" ? Number(q.appointmentId) : undefined,
      hasAppointment,
      sortField: q.sortField ? String(q.sortField) : undefined,
      sortDir,
      includeSignals: q.includeSignals === "false" ? false : undefined,
      unpaidOnly,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list visits", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVisitsSummary = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query || {};
    const summary = await emrService.getVisitsSummaryForBranch(
      Number(branchId),
      visitQueryFromDate(q.fromDate),
      visitQueryToDateInclusive(q.toDate)
    );
    return sendClinicSuccess(res, 200, summary);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to load visits summary", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.exportVisitsCsv = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const q = req.query || {};
    let statusFilter: string[] | undefined;
    try {
      statusFilter = parseVisitStatusList(q);
    } catch (e: any) {
      if (e?.code === "INVALID_VISIT_STATUS_FILTER") {
        return sendClinicError(res, 400, e.message || "Invalid status filter", CLINIC_ERROR_CODES.VALIDATION_ERROR);
      }
      throw e;
    }
    const hasAppointment =
      q.hasAppointment === "true" ? true : q.hasAppointment === "false" ? false : undefined;
    const unpaidOnly = q.unpaidOnly === "true" || q.unpaidOnly === "1";
    const sortDir = q.sortDir === "asc" ? "asc" : q.sortDir === "desc" ? "desc" : undefined;
    const { visits } = await emrService.listVisits(Number(branchId), {
      petId: q.petId != null ? Number(q.petId) : undefined,
      patientId: q.patientId != null ? Number(q.patientId) : undefined,
      limit: Math.min(Number(q.limit) || 2000, 5000),
      offset: 0,
      treatmentCode: q.treatmentCode ? String(q.treatmentCode) : undefined,
      fromDate: visitQueryFromDate(q.fromDate),
      toDate: visitQueryToDateInclusive(q.toDate),
      search: q.search ? String(q.search) : undefined,
      status: statusFilter,
      doctorId: q.doctorId != null && q.doctorId !== "" ? Number(q.doctorId) : undefined,
      appointmentId: q.appointmentId != null && q.appointmentId !== "" ? Number(q.appointmentId) : undefined,
      hasAppointment,
      sortField: q.sortField ? String(q.sortField) : undefined,
      sortDir,
      includeSignals: true,
      unpaidOnly,
    });
    const header = [
      "id",
      "treatmentCode",
      "status",
      "createdAt",
      "startedAt",
      "completedAt",
      "petName",
      "ownerName",
      "doctorName",
      "appointmentId",
      "appointmentStatus",
      "queueToken",
      "queueStatus",
      "orders",
      "unpaidOrders",
      "settlementStatus",
    ];
    const lines = [header.join(",")];
    for (const v of visits) {
      const petName = v.pet?.name ?? "";
      const ownerName = v.patient?.profile?.displayName ?? "";
      const doctorName = v.doctor?.user?.profile?.displayName ?? "";
      lines.push(
        [
          csvEscapeCell(v.id),
          csvEscapeCell(v.treatmentCode),
          csvEscapeCell(v.status),
          csvEscapeCell(v.createdAt),
          csvEscapeCell(v.startedAt),
          csvEscapeCell(v.completedAt),
          csvEscapeCell(petName),
          csvEscapeCell(ownerName),
          csvEscapeCell(doctorName),
          csvEscapeCell(v.appointmentId),
          csvEscapeCell(v.appointment?.status),
          csvEscapeCell(v.queueTicket?.tokenNo),
          csvEscapeCell(v.queueTicket?.status),
          csvEscapeCell(v.billing?.orderCount),
          csvEscapeCell(v.billing?.unpaidOrderCount),
          csvEscapeCell(v.settlement?.settlementStatus),
        ].join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="clinic-visits-export.csv"');
    return res.status(200).send(lines.join("\n"));
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to export visits", CLINIC_ERROR_CODES.VALIDATION_ERROR);
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
    if (isRequestedVisitStatusCompleted(body.status)) {
      return sendClinicError(
        res,
        400,
        "Visits cannot be created as COMPLETED. Create the visit, then use POST /visits/:visitId/complete.",
        CLINIC_ERROR_CODES.VALIDATION_ERROR
      );
    }
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
    if (isRequestedVisitStatusCompleted(body.status)) {
      return sendClinicError(
        res,
        400,
        "Use POST /visits/:visitId/complete to complete a visit (branch completion policy applies).",
        CLINIC_ERROR_CODES.VALIDATION_ERROR
      );
    }
    if (Object.prototype.hasOwnProperty.call(body || {}, "completedAt")) {
      return sendClinicError(
        res,
        400,
        "completedAt cannot be changed via PATCH. Use POST /visits/:visitId/complete to finish a visit.",
        CLINIC_ERROR_CODES.VALIDATION_ERROR
      );
    }
    const visit = await emrService.updateVisit(Number(branchId), visitId, {
      status: body.status,
      startedAt: body.startedAt != null ? new Date(body.startedAt) : undefined,
      followUpDate: body.followUpDate != null ? new Date(body.followUpDate) : undefined,
      followUpNotes: body.followUpNotes,
    });
    if (!visit) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 200, visit, "Visit updated");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update visit", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVisitCompletionEligibilityStaff = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const row = await prisma.visit.findFirst({
      where: { id: visitId, branchId: Number(branchId) },
      select: { status: true },
    });
    if (!row) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    if (row.status === "COMPLETED") {
      return sendClinicSuccess(res, 200, { completed: true, eligible: true, unmet: [], canOverride: false });
    }
    const eligibility = await visitCompletionPolicy.checkVisitCompletionEligibilityInBranch(visitId, Number(branchId));
    if (!eligibility) {
      return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    }
    return sendClinicSuccess(res, 200, { completed: false, ...eligibility });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.completeVisitStaff = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    const body = req.body || {};
    const result = await emrService.completeVisitWithPolicy(Number(branchId), visitId, Number(userId), {
      overrideReason: body.overrideReason,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
      }
      if (result.code === "COMPLETION_REQUIREMENTS_NOT_MET") {
        return sendClinicError(res, 400, "Visit completion requirements not met", CLINIC_ERROR_CODES.COMPLETION_REQUIREMENTS_NOT_MET, {
          unmet: result.unmet,
        });
      }
      return sendClinicError(res, 400, result.code || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    return sendClinicSuccess(res, 200, result.visit, "Visit completed");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to complete visit", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVisitQueueEvents = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const visitId = Number(req.params.visitId);
    const payload = await emrService.getVisitQueueEventsForBranch(Number(branchId), visitId);
    if (!payload) return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    return sendClinicSuccess(res, 200, payload);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to load queue events", CLINIC_ERROR_CODES.VALIDATION_ERROR);
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
    const branchId = Number(req.params.branchId);
    const visit = await prisma.visit.findFirst({
      where: { id: visitId, branchId },
      select: { id: true },
    });
    if (!visit) {
      return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    }
    const list = await prescriptionService.listByVisit(visitId);
    return sendClinicSuccess(res, 200, { prescriptions: list });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createPrescription = async (req: any, res: any) => {
  try {
    const visitId = Number(req.params.visitId);
    const branchId = Number(req.params.branchId);
    const doctorBranchMemberId = req.clinicDoctorBranchMemberId;
    if (!Number.isFinite(doctorBranchMemberId)) {
      return sendClinicError(res, 403, "Doctor context required", CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN);
    }
    const body = req.body;
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return sendClinicError(res, 400, "items are required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const visit = await prisma.visit.findFirst({
      where: { id: visitId, branchId },
      select: { id: true, petId: true, doctorId: true },
    });
    if (!visit?.petId) {
      return sendClinicError(res, 404, "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    }
    if (visit.doctorId !== doctorBranchMemberId) {
      return sendClinicError(
        res,
        403,
        "You may only prescribe for visits where you are the assigned doctor",
        CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN
      );
    }
    console.info("[prescription] create", {
      visitId,
      doctorBranchMemberId,
      userId: req.user?.id,
      branchId,
    });
    const prescription = await prescriptionService.createPrescription(visitId, {
      petId: visit.petId,
      doctorId: doctorBranchMemberId,
      notes: body.notes,
      items: body.items,
    });
    return sendClinicSuccess(res, 201, prescription, "Prescription created");
  } catch (e: any) {
    if (e?.code === "RX_CATALOG_VALIDATION") {
      return sendClinicError(res, 400, e.message || "Invalid catalog medicine", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    if (e?.code === "VISIT_NOT_FOUND") {
      return sendClinicError(res, 404, e.message || "Visit not found", CLINIC_ERROR_CODES.VISIT_NOT_FOUND);
    }
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPrescription = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const branchId = Number(req.params.branchId);
    const prescription = await prescriptionService.getPrescriptionById(prescriptionId);
    if (!prescription || prescription.visit?.branchId !== branchId) {
      return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    }
    return sendClinicSuccess(res, 200, prescription);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPrescriptionByQr = async (req: any, res: any) => {
  try {
    const qrToken = req.params.qrToken;
    const branchId = Number(req.params.branchId);
    if (!qrToken) return sendClinicError(res, 400, "qrToken required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const prescription = await prescriptionService.getPrescriptionByQrToken(String(qrToken));
    if (!prescription || prescription.visit?.branchId !== branchId) {
      return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    }
    return sendClinicSuccess(res, 200, prescription);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updatePrescription = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const branchId = Number(req.params.branchId);
    const doctorBranchMemberId = req.clinicDoctorBranchMemberId;
    if (!Number.isFinite(doctorBranchMemberId)) {
      return sendClinicError(res, 403, "Doctor context required", CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN);
    }
    const existing = await prescriptionService.getPrescriptionById(prescriptionId);
    if (!existing || existing.visit?.branchId !== branchId) {
      return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    }
    if (existing.doctorId !== doctorBranchMemberId) {
      return sendClinicError(res, 403, "Not allowed to edit this prescription", CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN);
    }
    if (existing.status !== "DRAFT") {
      return sendClinicError(
        res,
        409,
        "Prescription is finalized or dispensed and cannot be edited",
        CLINIC_ERROR_CODES.PRESCRIPTION_NOT_EDITABLE
      );
    }
    const body = req.body || {};
    console.info("[prescription] update", {
      prescriptionId,
      doctorBranchMemberId,
      userId: req.user?.id,
      branchId,
    });
    const prescription = await prescriptionService.updatePrescription(prescriptionId, {
      notes: body.notes,
      items: Array.isArray(body.items) ? body.items : undefined,
    });
    if (!prescription) {
      return sendClinicError(
        res,
        409,
        "Prescription is finalized or dispensed and cannot be edited",
        CLINIC_ERROR_CODES.PRESCRIPTION_NOT_EDITABLE
      );
    }
    return sendClinicSuccess(res, 200, prescription, "Prescription updated");
  } catch (e: any) {
    if (e?.code === "RX_CATALOG_VALIDATION") {
      return sendClinicError(res, 400, e.message || "Invalid catalog medicine", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.finalizePrescription = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const branchId = Number(req.params.branchId);
    const doctorBranchMemberId = req.clinicDoctorBranchMemberId;
    if (!Number.isFinite(doctorBranchMemberId)) {
      return sendClinicError(res, 403, "Doctor context required", CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN);
    }
    const existing = await prescriptionService.getPrescriptionById(prescriptionId);
    if (!existing || existing.visit?.branchId !== branchId) {
      return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    }
    if (existing.doctorId !== doctorBranchMemberId) {
      return sendClinicError(res, 403, "Not allowed to finalize this prescription", CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN);
    }
    if (existing.status !== "DRAFT") {
      return sendClinicError(
        res,
        409,
        "Prescription is not in draft status",
        CLINIC_ERROR_CODES.PRESCRIPTION_NOT_EDITABLE
      );
    }
    console.info("[prescription] finalize", {
      prescriptionId,
      doctorBranchMemberId,
      userId: req.user?.id,
      branchId,
    });
    const prescription = await prescriptionService.finalizePrescription(prescriptionId);
    if (!prescription) {
      return sendClinicError(
        res,
        409,
        "Prescription is not in draft status",
        CLINIC_ERROR_CODES.PRESCRIPTION_NOT_EDITABLE
      );
    }
    return sendClinicSuccess(res, 200, prescription, "Prescription finalized");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.dispensePrescription = async (req: any, res: any) => {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    const branchId = Number(req.params.branchId);
    const userId = req.user?.id;
    const createDispenseRequest = req.body?.createDispenseRequest === true;
    const existing = await prescriptionService.getPrescriptionById(prescriptionId);
    if (!existing || existing.visit?.branchId !== branchId) {
      return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    }
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

const countryMedicineCatalogService = require("../../services/countryMedicineCatalog.service");

exports.searchCountryMedicineCatalog = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const ctx = await countryMedicineCatalogService.resolveMedicineCatalogContextForBranch(Number(branchId));
    if (!ctx) return sendClinicError(res, 404, "Branch not found", CLINIC_ERROR_CODES.NOT_FOUND);
    if (!ctx.catalogAvailable) {
      return sendClinicSuccess(res, 200, {
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        notice: ctx.catalogBlockMessage,
        catalogCountry: { code: null, name: null },
      });
    }
    const q = String(req.query?.q ?? req.query?.query ?? "");
    if (q.trim().length < countryMedicineCatalogService.MIN_QUERY_LEN) {
      return sendClinicError(
        res,
        400,
        `Enter at least ${countryMedicineCatalogService.MIN_QUERY_LEN} characters to search the national medicine catalog (brand, generic, manufacturer, strength, form, or pack marking).`,
        CLINIC_ERROR_CODES.VALIDATION_ERROR
      );
    }
    const page = req.query?.page ? Number(req.query.page) : 1;
    const limit = req.query?.limit ? Number(req.query.limit) : 20;
    const result = await countryMedicineCatalogService.searchCountryMedicineCatalog({
      countryId: ctx.countryId!,
      q,
      genericId: req.query?.genericId ? Number(req.query.genericId) : undefined,
      manufacturerId: req.query?.manufacturerId ? Number(req.query.manufacturerId) : undefined,
      dosageFormId: req.query?.dosageFormId ? Number(req.query.dosageFormId) : undefined,
      strength: req.query?.strength ? String(req.query.strength) : undefined,
      page,
      limit,
    });
    return sendClinicSuccess(res, 200, {
      ...result,
      catalogCountry: { code: ctx.countryCode, name: ctx.countryName },
    });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getCountryMedicineBrandCatalog = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const brandId = Number(req.params.brandId);
    if (!Number.isFinite(brandId)) {
      return sendClinicError(res, 400, "Invalid brand id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const ctx = await countryMedicineCatalogService.resolveMedicineCatalogContextForBranch(Number(branchId));
    if (!ctx) return sendClinicError(res, 404, "Branch not found", CLINIC_ERROR_CODES.NOT_FOUND);
    if (!ctx.catalogAvailable || ctx.countryId == null) {
      return sendClinicError(
        res,
        400,
        ctx.catalogBlockMessage || "National medicine catalog is not available for this branch.",
        CLINIC_ERROR_CODES.VALIDATION_ERROR
      );
    }
    const row = await countryMedicineCatalogService.getCountryMedicineBrandDetail(ctx.countryId, brandId);
    if (!row) {
      return sendClinicError(
        res,
        404,
        "No catalog medicine matches this id for your organization’s country, or the item is inactive.",
        CLINIC_ERROR_CODES.NOT_FOUND
      );
    }
    return sendClinicSuccess(res, 200, row);
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
    const branchId = Number(req.params.branchId);
    const rx = await prescriptionService.getPrescriptionById(prescriptionId);
    if (!rx || rx.visit?.branchId !== branchId) {
      return sendClinicError(res, 404, "Prescription not found", CLINIC_ERROR_CODES.NOT_FOUND);
    }
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
      branchId: Number(branchId),
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
      prescriptionId: body.prescriptionId != null ? Number(body.prescriptionId) : null,
      surgeryCaseId: body.surgeryCaseId ?? null,
      treatmentCourseId: body.treatmentCourseId ?? null,
      requestType: body.requestType ?? null,
      requestReason: body.requestReason ?? null,
      tokenId: body.tokenId ?? null,
      treatmentDayItemId: body.treatmentDayItemId ?? null,
      transactionType: body.transactionType ?? null,
      urgencyLevel: body.urgencyLevel ?? "NORMAL",
      items: body.items.map((i: any) => ({
        variantId: Number(i.variantId),
        clinicalItemVariantId: i.clinicalItemVariantId != null ? Number(i.clinicalItemVariantId) : null,
        requestedQty: Number(i.requestedQty),
        unit: i.unit ?? null,
        reason: i.reason ?? null,
      })),
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
      requestType: q.requestType ?? undefined,
      transactionType: q.transactionType ?? undefined,
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

exports.receiveDispenseRequest = async (req: any, res: any) => {
  try {
    const requestId = Number(req.params.id);
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await dispenseControlService.receiveDispenseRequest(requestId, Number(branchId), userId);
    return sendClinicSuccess(res, 200, r, "Dispense received");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordOutsideMedicineReceive = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.variantId) return sendClinicError(res, 400, "variantId required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await outsideMedicineService.recordOutsideReceive({
      branchId: Number(branchId),
      variantId: Number(body.variantId),
      receivedByUserId: userId,
      batchCode: body.batchCode ?? null,
      expiryDate: body.expiryDate ?? null,
    });
    return sendClinicSuccess(res, 201, r, "Outside medicine receive recorded");
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
      activatedFromDispenseRequestId: body.activatedFromDispenseRequestId ?? null,
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
    const forceOpenRequested = body.forceOpen === true;
    if (forceOpenRequested) {
      const perms: string[] = req.clinicProfile?.permissions ?? [];
      if (!perms.includes("medicine.vial.force_open")) {
        return sendClinicError(res, 403, "Force-open permission required", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
      }
    }
    const r = await openVialService.openVial({
      vialInstanceId: body.vialInstanceId ?? null,
      variantId: Number(body.variantId),
      lotId: body.lotId ?? null,
      branchId: Number(branchId),
      roomId: body.roomId ?? null,
      openedByUserId: userId,
      initialQty: Number(body.initialQty),
      requestedDose: body.requestedDose != null ? Number(body.requestedDose) : null,
      allowForceOpen: forceOpenRequested,
      openPhotoUrl: body.openPhotoUrl ?? null,
      activatedFromDispenseRequestId: body.activatedFromDispenseRequestId ?? null,
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
    const notes = (body.notes ?? body.returnReason ?? body.wastageReason ?? "").trim();
    if (body.status === "RETURNED" && !notes) {
      return sendClinicError(res, 400, "Return/wastage reason (notes, returnReason, or wastageReason) is required when closing as RETURNED", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const r = await openVialService.closeSession(sessionId, {
      status: body.status,
      returnPhotoUrl: body.returnPhotoUrl ?? null,
      notes: notes || null,
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
    const branchId = Number(req.clinicBranchId);
    const body = req.body;
    const userId = req.user?.id;
    if (!body.patientId || !body.variantId || body.administeredDose == null) {
      return sendClinicError(res, 400, "patientId, variantId and administeredDose required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const administeredDose = Number(body.administeredDose);
    if (administeredDose <= 0 || !Number.isFinite(administeredDose)) {
      return sendClinicError(res, 400, "administeredDose must be a positive number", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const emergencyBypassRequested = body.emergencyBypass === true;
    if (emergencyBypassRequested) {
      const perms: string[] = req.clinicProfile?.permissions ?? [];
      if (!perms.includes("injection.token.emergency_bypass")) {
        return sendClinicError(res, 403, "Emergency bypass permission required", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
      }
    }
    const r = await doseConsumptionService.recordAdministration({
      branchId,
      patientId: Number(body.patientId),
      visitId: body.visitId ?? null,
      surgeryCaseId: body.surgeryCaseId ?? null,
      variantId: Number(body.variantId),
      vialSessionId: body.vialSessionId ?? null,
      injectionTokenId: body.injectionTokenId != null ? Number(body.injectionTokenId) : null,
      medicineSource: body.medicineSource ?? undefined,
      allowEmergencyBypass: emergencyBypassRequested,
      emergencyBypassReason: body.emergencyBypassReason != null ? String(body.emergencyBypassReason).trim() || null : null,
      medicineApprovalRequestId: body.medicineApprovalRequestId != null ? Number(body.medicineApprovalRequestId) : null,
      prescribedDose: body.prescribedDose ?? null,
      administeredDose,
      unit: body.unit ?? null,
      route: body.route ?? null,
      administeredByUserId: userId ?? body.administeredByUserId ?? null,
      witnessedByUserId: body.witnessedByUserId ?? null,
    });
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.MEDICATION_ADMINISTERED,
      entityType: "MEDICATION_ADMINISTRATION",
      entityId: r.id,
      after: { visitId: r.visitId, variantId: r.variantId, administeredDose: r.administeredDose, emergencyBypass: !!r.emergencyBypassReason },
    });
    return sendClinicSuccess(res, 201, r, "Dose recorded");
  } catch (e: any) {
    if (e?.message === "ROOM_MISMATCH") {
      return sendClinicError(
        res,
        400,
        "Selected vial is in a different room than the token's pre-selected vial. Use the vial assigned to this token or record in the correct room.",
        CLINIC_ERROR_CODES.ROOM_MISMATCH
      );
    }
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

exports.generateInjectionToken = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    const body = req.body || {};
    const walkIn = body.billingCheckout?.walkIn;
    const hasMedLines = Array.isArray(body.medicationLines) && body.medicationLines.length > 0;
    if (!hasMedLines && (body.expectedDose == null || body.expectedDose === "")) {
      return sendClinicError(res, 400, "medicationLines or expectedDose is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    if (!hasMedLines && body.variantId != null && body.variantId !== "" && Number(body.variantId) <= 0) {
      return sendClinicError(res, 400, "variantId must be positive when using legacy single-medicine payload", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    if (!walkIn && (body.visitId == null || body.visitId === "")) {
      return sendClinicError(
        res,
        400,
        "visitId is required unless billingCheckout.walkIn creates the visit",
        CLINIC_ERROR_CODES.VALIDATION_ERROR
      );
    }
    const bc = body.billingCheckout;
    const billingCheckout =
      bc && typeof bc === "object"
        ? {
            walkIn:
              bc.walkIn && typeof bc.walkIn === "object"
                ? {
                    patientId: Number(bc.walkIn.patientId),
                    petId: Number(bc.walkIn.petId),
                    doctorBranchMemberId:
                      bc.walkIn.doctorBranchMemberId != null && bc.walkIn.doctorBranchMemberId !== ""
                        ? Number(bc.walkIn.doctorBranchMemberId)
                        : undefined,
                  }
                : undefined,
            injectionServiceId: bc.injectionServiceId != null ? Number(bc.injectionServiceId) : null,
            servicePrice: bc.servicePrice != null ? Number(bc.servicePrice) : null,
            medicineVariantId: bc.medicineVariantId != null ? Number(bc.medicineVariantId) : null,
            medicineQuantity: bc.medicineQuantity != null ? Number(bc.medicineQuantity) : null,
            medicineUnitPrice: bc.medicineUnitPrice != null ? Number(bc.medicineUnitPrice) : null,
            medicineLineBillings: Array.isArray(bc.medicineLineBillings)
              ? bc.medicineLineBillings.map((row: any) => ({
                  variantId: Number(row.variantId),
                  quantity: row.quantity != null ? Number(row.quantity) : 1,
                  unitPrice: Number(row.unitPrice),
                }))
              : null,
            consumablesServiceId: bc.consumablesServiceId != null ? Number(bc.consumablesServiceId) : null,
            consumablesPrice: bc.consumablesPrice != null ? Number(bc.consumablesPrice) : null,
            paymentMethod: bc.paymentMethod != null ? String(bc.paymentMethod) : null,
            markPaid: bc.markPaid === true || bc.markPaid === "true" || bc.markPaid === 1,
            notes: bc.notes != null ? String(bc.notes) : null,
          }
        : undefined;
    const token = await injectionTokenService.generateToken({
      branchId,
      visitId: body.visitId != null && body.visitId !== "" ? Number(body.visitId) : undefined,
      prescriptionId: body.prescriptionId != null ? Number(body.prescriptionId) : null,
      orderId: body.orderId != null ? Number(body.orderId) : null,
      patientId: body.patientId != null ? Number(body.patientId) : null,
      petId: body.petId != null ? Number(body.petId) : null,
      variantId: body.variantId != null && body.variantId !== "" ? Number(body.variantId) : undefined,
      treatmentCourseId: body.treatmentCourseId != null ? Number(body.treatmentCourseId) : null,
      treatmentDayId: body.treatmentDayId != null ? Number(body.treatmentDayId) : null,
      selectedVialSessionId: body.selectedVialSessionId != null ? Number(body.selectedVialSessionId) : null,
      expectedDose: body.expectedDose != null && body.expectedDose !== "" ? Number(body.expectedDose) : undefined,
      unit: body.unit ?? null,
      medicineSource: normalizeMedicineSourceInput(body.medicineSource, "INTERNAL_CLINIC"),
      encounterKind: body.encounterKind,
      medicationLines: hasMedLines ? body.medicationLines : undefined,
      externalPrescriberName: body.externalPrescriberName ?? null,
      externalPrescriberClinic: body.externalPrescriberClinic ?? null,
      externalRxNotes: body.externalRxNotes ?? null,
      externalRxEvidenceUrl: body.externalRxEvidenceUrl ?? null,
      serviceChargeAmount: body.serviceChargeAmount != null ? Number(body.serviceChargeAmount) : null,
      medicineChargeAmount: body.medicineChargeAmount != null ? Number(body.medicineChargeAmount) : null,
      consumablesChargeAmount: body.consumablesChargeAmount != null ? Number(body.consumablesChargeAmount) : null,
      billingCheckout: billingCheckout ?? null,
      generatedByUserId: Number(userId),
      expiresInHours: body.expiresInHours != null ? Number(body.expiresInHours) : undefined,
    });
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.INJECTION_TOKEN_GENERATED,
      entityType: "INJECTION_TOKEN",
      entityId: token.id,
      after: { tokenCode: token.tokenCode, visitId: token.visitId, variantId: token.variantId },
    });
    return sendClinicSuccess(res, 201, token, "Injection token generated");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to generate token", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.validateInjectionToken = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    const tokenCode = String(req.query.tokenCode ?? req.body?.tokenCode ?? "").trim();
    if (!tokenCode) return sendClinicError(res, 400, "tokenCode is required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await injectionTokenService.validateToken(tokenCode, branchId, userId != null ? Number(userId) : undefined);
    if (!result.valid) {
      return sendClinicError(res, 400, result.reason || "Invalid token", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    if (result.valid && !result.alreadyValidated && result.token?.id && userId) {
      await writeClinicAudit({
        req,
        action: CLINIC_AUDIT_ACTIONS.INJECTION_TOKEN_VALIDATED,
        entityType: "INJECTION_TOKEN",
        entityId: result.token.id,
        after: { tokenCode: result.token.tokenCode, validatedByUserId: userId },
      });
    }
    return sendClinicSuccess(res, 200, result, result.alreadyValidated ? "Token was already validated" : "Token is valid");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to validate token", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.cancelInjectionToken = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    const tokenId = Number(req.params.id);
    const cancelReason = req.body?.reason != null ? String(req.body.reason).trim() || null : null;
    const result = await injectionTokenService.cancelToken(tokenId, branchId, Number(userId), cancelReason);
    await writeClinicAudit({
      req,
      action: CLINIC_AUDIT_ACTIONS.INJECTION_TOKEN_CANCELLED,
      entityType: "INJECTION_TOKEN",
      entityId: tokenId,
      after: { tokenCode: result.tokenCode, cancelReason: result.cancelReason ?? null },
    });
    return sendClinicSuccess(res, 200, result, "Injection token cancelled");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to cancel token", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listInjectionTokens = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    const q = req.query || {};
    const validatedByUserId =
      q.validatedByMe === "true" || q.validatedByMe === true
        ? userId != null
          ? Number(userId)
          : undefined
        : q.validatedByUserId != null
          ? Number(q.validatedByUserId)
          : undefined;
    const generatedByUserId =
      q.generatedByMe === "true" || q.generatedByMe === true
        ? userId != null
          ? Number(userId)
          : undefined
        : q.generatedByUserId != null
          ? Number(q.generatedByUserId)
          : undefined;
    const medicineSourceFilter =
      q.medicineSource != null && String(q.medicineSource).trim() !== ""
        ? normalizeMedicineSourceInput(q.medicineSource, "INTERNAL_CLINIC")
        : undefined;
    const encounterKindFilter =
      q.encounterKind != null && String(q.encounterKind).trim() !== ""
        ? String(q.encounterKind).trim().toUpperCase().replace(/-/g, "_") === "EXTERNAL_WALK_IN"
          ? "EXTERNAL_WALK_IN"
          : "INTERNAL_VISIT"
        : undefined;
    const result = await injectionTokenService.listTokens(branchId, {
      status: q.status ?? undefined,
      visitId: q.visitId != null ? Number(q.visitId) : undefined,
      patientId: q.patientId != null ? Number(q.patientId) : undefined,
      tokenCode: q.tokenCode != null ? String(q.tokenCode) : undefined,
      fromDate: q.fromDate ? new Date(String(q.fromDate)) : undefined,
      toDate: q.toDate ? new Date(String(q.toDate)) : undefined,
      skip: q.skip != null ? Number(q.skip) : undefined,
      take: q.take != null ? Number(q.take) : undefined,
      validatedByUserId,
      generatedByUserId,
      medicineSource: medicineSourceFilter,
      encounterKind: encounterKindFilter,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list tokens", CLINIC_ERROR_CODES.VALIDATION_ERROR);
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

exports.listTreatmentCourses = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    const status = req.query.status as string | undefined;
    const skip = req.query.skip ? Number(req.query.skip) : undefined;
    const take = req.query.take ? Number(req.query.take) : undefined;
    const r = await treatmentCourseService.listCourses(Number(branchId), { patientId, status, skip, take });
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createFullTreatmentCourse = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.patientId || !body.durationDays || !body.days?.length) return sendClinicError(res, 400, "patientId, durationDays, days required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await treatmentCourseService.createFullCourse({
      patientId: Number(body.patientId),
      visitId: body.visitId ?? null,
      branchId: body.branchId ? Number(body.branchId) : Number(branchId),
      prescribedByDoctorId: body.prescribedByDoctorId ?? null,
      treatmentBranchId: body.treatmentBranchId ?? null,
      crossBranchAllowed: body.crossBranchAllowed ?? false,
      durationDays: Number(body.durationDays),
      days: body.days.map((d: any) => ({
        dayNumber: Number(d.dayNumber),
        scheduledDate: new Date(d.scheduledDate),
        items: (d.items || []).map((i: any) => ({
          variantId: Number(i.variantId),
          medicineName: String(i.medicineName),
          dosageMl: Number(i.dosageMl),
          route: i.route ?? null,
          frequency: i.frequency ?? null,
          expectedNote: i.expectedNote ?? null,
        })),
      })),
      createdByUserId: userId,
    });
    return sendClinicSuccess(res, 201, r, "Treatment course created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getTreatmentCourseSchedule = async (req: any, res: any) => {
  try {
    const courseId = Number(req.params.id);
    const r = await treatmentCourseService.getCourseWithSchedule(courseId);
    if (!r) return sendClinicError(res, 404, "Course not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getTreatmentCourseTodayDue = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const courseId = Number(req.params.id);
    const r = await dailyDueMedicineService.getTodayDueMedicines(courseId, Number(branchId));
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getTreatmentCourseRevisions = async (req: any, res: any) => {
  try {
    const courseId = Number(req.params.id);
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const r = await treatmentCourseService.getRevisionHistory(courseId, limit);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.holdTreatmentCourse = async (req: any, res: any) => {
  try {
    const courseId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await treatmentCourseService.holdCourse(courseId, req.body.reason ?? null, userId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.resumeTreatmentCourse = async (req: any, res: any) => {
  try {
    const courseId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await treatmentCourseService.resumeCourse(courseId, userId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.stopTreatmentCourse = async (req: any, res: any) => {
  try {
    const courseId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await treatmentCourseService.stopCourse(courseId, userId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateTreatmentDayItem = async (req: any, res: any) => {
  try {
    const itemId = Number(req.params.itemId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await treatmentCourseService.updateDayItem(itemId, req.body, userId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getTreatmentBillingSummary = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const courseId = Number(req.params.courseId);
    const r = await billingService.getTreatmentBillingSummary(courseId, Number(branchId));
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createTreatmentDayBill = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const courseId = Number(req.params.courseId);
    const body = req.body;
    if (!body.customerId || !body.treatmentDayId) return sendClinicError(res, 400, "customerId and treatmentDayId required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await billingService.createTreatmentDayBill(courseId, Number(branchId), {
      customerId: Number(body.customerId),
      treatmentDayId: Number(body.treatmentDayId),
      serviceFee: body.serviceFee ?? 0,
      visitId: body.visitId ?? null,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
    }, userId);
    return sendClinicSuccess(res, 201, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getOpenVialAvailability = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const variantId = Number(req.params.variantId);
    const requiredMl = req.query.requiredMl != null ? Number(req.query.requiredMl) : undefined;
    const r = await billingService.getOpenVialAvailability(Number(branchId), variantId, requiredMl);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createInternalOrder = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const orgId = req.clinicOrgId ?? (await prisma.branch.findUnique({ where: { id: Number(branchId) }, select: { orgId: true } }))?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch or org not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.items?.length) return sendClinicError(res, 400, "items required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await dispenseControlService.createInternalOrder({
      branchId: Number(branchId),
      orgId,
      requestedByUserId: userId,
      patientId: body.patientId ?? null,
      visitId: body.visitId ?? null,
      treatmentCourseId: body.treatmentCourseId ?? null,
      tokenId: body.tokenId ?? null,
      treatmentDayItemId: body.treatmentDayItemId ?? null,
      requestReason: body.requestReason ?? null,
      items: body.items.map((i: any) => ({ variantId: Number(i.variantId), requestedQty: Number(i.requestedQty), unit: i.unit ?? null, reason: i.reason ?? null })),
    });
    return sendClinicSuccess(res, 201, r, "Internal order created");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getInternalOrdersDashboard = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const requestType = req.query.requestType ?? undefined;
    const r = await dispenseControlService.getInternalOrderDashboard(Number(branchId), { requestType });
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPatientDueMedicines = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const patientId = Number(req.params.patientId);
    const r = await dailyDueMedicineService.getPatientDueMedicines(patientId, Number(branchId));
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.markTreatmentDayCompleted = async (req: any, res: any) => {
  try {
    const treatmentDayId = Number(req.params.treatmentDayId);
    const r = await dailyDueMedicineService.markDayCompleted(treatmentDayId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.requestSupervisorOverride = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const orgId = req.clinicOrgId ?? (await prisma.branch.findUnique({ where: { id: Number(branchId) }, select: { orgId: true } }))?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch or org not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body;
    if (!body.action || !body.reason) return sendClinicError(res, 400, "action and reason required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await exceptionOverrideService.requestSupervisorOverride(Number(branchId), orgId, {
      action: body.action,
      reason: body.reason,
      requestedByUserId: userId,
      relatedEntityType: body.relatedEntityType ?? null,
      relatedEntityId: body.relatedEntityId ?? null,
      evidenceUrls: body.evidenceUrls ?? null,
    });
    return sendClinicSuccess(res, 201, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.approveOverride = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const overrideId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const r = await exceptionOverrideService.approveOverride(overrideId, Number(branchId), userId);
    return sendClinicSuccess(res, 200, r);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getInjectionTokenWithContext = async (req: any, res: any) => {
  try {
    const branchId = req.clinicBranchId;
    const tokenId = Number(req.params.id);
    const r = await injectionTokenService.getTokenWithTreatmentContext(tokenId, Number(branchId));
    if (!r) return sendClinicError(res, 404, "Token not found", CLINIC_ERROR_CODES.NOT_FOUND);
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

exports.getInjectionMonitoringDashboard = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const date = req.query?.date ? new Date(String(req.query.date)) : undefined;
    const result = await auditIntelligenceService.getInjectionMonitoringDashboard(branchId, date);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getInjectionRoomBoard = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    const date = req.query?.date ? new Date(String(req.query.date)) : undefined;
    const roomId = req.query?.roomId != null ? Number(req.query.roomId) : undefined;
    const validatedByUserId =
      req.query?.validatedByMe === "true" || req.query?.validatedByMe === true
        ? userId != null
          ? Number(userId)
          : undefined
        : req.query?.validatedByUserId != null
          ? Number(req.query.validatedByUserId)
          : undefined;
    const administeredByUserId =
      req.query?.administeredByMe === "true" || req.query?.administeredByMe === true
        ? userId != null
          ? Number(userId)
          : undefined
        : req.query?.administeredByUserId != null
          ? Number(req.query.administeredByUserId)
          : undefined;
    const result = await auditIntelligenceService.getInjectionRoomBoard(branchId, date, roomId, validatedByUserId, administeredByUserId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.runDailyReconciliation = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const date = req.body?.date ? new Date(String(req.body.date)) : undefined;
    const result = await dailyReconciliationService.autoReconcile(branchId, date);
    return sendClinicSuccess(res, 200, result, "Reconciliation completed");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listDailyReconciliations = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    if (q.date) {
      const row = await dailyReconciliationService.getReconciliationByDate(branchId, new Date(String(q.date)));
      return sendClinicSuccess(res, 200, { row });
    }

    const result = await dailyReconciliationService.listReconciliations(branchId, {
      fromDate: q.fromDate ? new Date(String(q.fromDate)) : undefined,
      toDate: q.toDate ? new Date(String(q.toDate)) : undefined,
      status: q.status ?? undefined,
      hasMismatch: q.hasMismatch != null ? String(q.hasMismatch) === "true" : undefined,
      skip: q.skip != null ? Number(q.skip) : undefined,
      take: q.take != null ? Number(q.take) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.acknowledgeDailyReconciliation = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    const reconciliationId = Number(req.params.id);
    const result = await dailyReconciliationService.acknowledgeMismatch(
      branchId,
      reconciliationId,
      Number(userId),
      req.body?.note ?? null
    );
    return sendClinicSuccess(res, 200, result, "Reconciliation acknowledged");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getEodStatus = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const date = req.query?.date ? String(req.query.date) : undefined;
    const result = await eodHandoverService.getEodStatus(branchId, date);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.eodClose = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const date = req.body?.date ? String(req.body.date) : undefined;
    const notes = req.body?.notes;
    const status = await eodHandoverService.getEodStatus(branchId, date);
    if (!status.canClose) {
      return sendClinicError(res, 400, "Cannot close day: " + status.blockers.join("; "), CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const record = await eodHandoverService.recordDayClose(branchId, status.date, Number(userId), notes);
    return sendClinicSuccess(res, 200, {
      closed: true,
      date: status.date,
      closedAt: record.closedAt,
      closedByUserId: record.closedByUserId,
    }, "Day closed");
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDayClose = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const date = req.query?.date ? String(req.query.date) : undefined;
    const result = await eodHandoverService.getDayClose(branchId, date);
    return sendClinicSuccess(res, 200, result ?? {});
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getHandoverSummary = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const expiredWithinHours = req.query?.expiredWithinHours != null ? Number(req.query.expiredWithinHours) : undefined;
    const result = await eodHandoverService.getHandoverSummary(branchId, {
      expiredWithinHours,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// Staff catalog: master browse + add-from-master + branch catalog list (reuse owner services)
const masterCatalogService = require("./masterCatalog.service");
const addFromMasterCatalogService = require("./addFromMasterCatalog.service");

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

// --- Staff Branch Catalog (master browse + add-from-master + branch items list) ---
exports.listStaffCatalogMasterCategories = async (req: any, res: any) => {
  try {
    const q = req.query || {};
    const data = await masterCatalogService.listMasterCategories({
      parentId: q.parentId != null ? parseInt(String(q.parentId), 10) : undefined,
      domainType: q.domainType != null ? String(q.domainType) : undefined,
      isActive: q.isActive !== undefined ? q.isActive === "true" : undefined,
      page: q.page != null ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : undefined,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list master categories", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listStaffCatalogMasterItems = async (req: any, res: any) => {
  try {
    const q = req.query || {};
    const data = await masterCatalogService.listMasterItems({
      categoryId: q.categoryId != null ? parseInt(String(q.categoryId), 10) : undefined,
      domainType: q.domainType != null ? String(q.domainType) : undefined,
      search: q.search != null ? String(q.search) : undefined,
      isActive: q.isActive !== undefined ? q.isActive === "true" : undefined,
      page: q.page != null ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit != null ? parseInt(String(q.limit), 10) : undefined,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list master items", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.previewStaffAddFromMasterCatalog = async (req: any, res: any) => {
  try {
    const orgId = req.clinicBranch?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch context required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const masterItemIds = Array.isArray(body.masterItemIds) ? body.masterItemIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const masterCategoryIds = Array.isArray(body.masterCategoryIds) ? body.masterCategoryIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const option = body.option && ["createMissingOnly", "createOrUpdate", "skipExisting"].includes(body.option) ? body.option : "createMissingOnly";
    const data = await addFromMasterCatalogService.previewAddFromMaster(orgId, {
      masterItemIds: masterItemIds.length ? masterItemIds : undefined,
      masterCategoryIds: masterCategoryIds.length ? masterCategoryIds : undefined,
      option,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to preview add from master", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.executeStaffAddFromMasterCatalog = async (req: any, res: any) => {
  try {
    const orgId = req.clinicBranch?.orgId;
    const userId = req.user?.id;
    if (!orgId) return sendClinicError(res, 400, "Branch context required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const masterItemIds = Array.isArray(body.masterItemIds) ? body.masterItemIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const masterCategoryIds = Array.isArray(body.masterCategoryIds) ? body.masterCategoryIds.map((x: unknown) => parseInt(String(x), 10)) : [];
    const option = body.option && ["createMissingOnly", "createOrUpdate", "skipExisting"].includes(body.option) ? body.option : "createMissingOnly";
    const data = await addFromMasterCatalogService.executeAddFromMaster(orgId, userId, {
      masterItemIds: masterItemIds.length ? masterItemIds : undefined,
      masterCategoryIds: masterCategoryIds.length ? masterCategoryIds : undefined,
      option,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to execute add from master", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listStaffCatalogItems = async (req: any, res: any) => {
  try {
    const orgId = req.clinicBranch?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch context required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const q = req.query || {};
    const data = await clinicalItemService.listClinicalItems({
      orgId,
      domainType: q.domainType ? String(q.domainType) : undefined,
      categoryId: q.categoryId ? parseInt(String(q.categoryId), 10) : undefined,
      search: q.search ? String(q.search) : undefined,
      isActive: q.isActive !== undefined ? q.isActive === "true" : undefined,
      page: q.page ? parseInt(String(q.page), 10) : undefined,
      limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list catalog items", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getStaffCatalogItemById = async (req: any, res: any) => {
  try {
    const orgId = req.clinicBranch?.orgId;
    const itemId = req.params.itemId != null ? parseInt(String(req.params.itemId), 10) : NaN;
    if (!orgId) return sendClinicError(res, 400, "Branch context required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (Number.isNaN(itemId)) return sendClinicError(res, 400, "Invalid itemId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await clinicalItemService.getClinicalItemById(itemId, { orgId });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    if (e?.message === "Clinical item not found") return sendClinicError(res, 404, "Item not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicError(res, 500, e?.message || "Failed to get item", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.setStaffCatalogItemStatus = async (req: any, res: any) => {
  try {
    const orgId = req.clinicBranch?.orgId;
    const itemId = req.params.itemId != null ? parseInt(String(req.params.itemId), 10) : NaN;
    const isActive = req.body?.isActive;
    if (!orgId) return sendClinicError(res, 400, "Branch context required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (Number.isNaN(itemId)) return sendClinicError(res, 400, "Invalid itemId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (typeof isActive !== "boolean") return sendClinicError(res, 400, "body.isActive (boolean) required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const item = isActive
      ? await clinicalItemService.activateClinicalItem(itemId, orgId)
      : await clinicalItemService.deactivateClinicalItem(itemId, orgId);
    return sendClinicSuccess(res, 200, item);
  } catch (e: any) {
    if (e?.message === "Clinical item not found") return sendClinicError(res, 404, "Item not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    return sendClinicError(res, 500, e?.message || "Failed to update item status", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getStaffCatalogSummary = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const orgId = req.clinicBranch?.orgId;
    if (!orgId) return sendClinicError(res, 400, "Branch context required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const [
      itemsResult,
      packagesResult,
      pendingApprovals,
      activeServicesCount,
      draftPackagesCount,
      discountCampaignsCount,
      mappedDoctorsCount,
    ] = await Promise.all([
      clinicalItemService.listClinicalItems({ orgId, limit: 1, page: 1 }),
      require("./package.service").listPackages({ branchId, limit: 1, page: 1 }),
      require("../../services/clinicApprovalRequest.service")
        .listByBranch(branchId, { status: "PENDING" })
        .then((r: { items: unknown[]; total: number }) => r.items),
      prisma.service.count({ where: { branchId, status: "ACTIVE" } }),
      prisma.surgeryPackage.count({ where: { branchId, status: "DRAFT" } }),
      prisma.discountPolicy.count({ where: { branchId, status: "ACTIVE" } }),
      (async () => {
        const [serviceProfileIds, packageProfileIds] = await Promise.all([
          prisma.doctorServiceMapping.findMany({ where: { branchId }, select: { clinicStaffProfileId: true }, distinct: ["clinicStaffProfileId"] }),
          prisma.doctorPackageMapping.findMany({ where: { branchId }, select: { clinicStaffProfileId: true }, distinct: ["clinicStaffProfileId"] }),
        ]);
        const ids = new Set([
          ...serviceProfileIds.map((m) => m.clinicStaffProfileId),
          ...packageProfileIds.map((m) => m.clinicStaffProfileId),
        ]);
        return ids.size;
      })(),
    ]);
    const totalCatalogItems = (itemsResult as { pagination?: { total?: number } })?.pagination?.total ?? 0;
    const totalPackages = (packagesResult as { pagination?: { total?: number } })?.pagination?.total ?? 0;
    const pendingCount = Array.isArray(pendingApprovals) ? pendingApprovals.length : 0;
    return sendClinicSuccess(res, 200, {
      totalCatalogItems,
      totalPackages,
      pendingApprovalRequests: pendingCount,
      activeServices: activeServicesCount,
      draftPackages: draftPackagesCount,
      discountCampaignsRunning: discountCampaignsCount,
      mappedDoctors: mappedDoctorsCount,
      lowStockPackageLinkedItems: 0,
      recentlyAddedItems: 0,
    });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get catalog summary", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getStaffAuditHistory = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const limit = Math.min(req.query?.limit != null ? parseInt(String(req.query.limit), 10) : 50, 100);
    const entityTypeFilter = typeof req.query?.entityType === "string" ? req.query.entityType.trim() : null;
    const packageIds = await prisma.surgeryPackage.findMany({
      where: { branchId },
      select: { id: true },
    });
    const pkgIds = packageIds.map((p) => p.id);
    const takePerSource = limit + 50;
    const [packageAudits, approvalLogs, discountAudits, doctorAudits] = await Promise.all([
      pkgIds.length
        ? prisma.packageAuditLog.findMany({
            where: { surgeryPackageId: { in: pkgIds } },
            orderBy: { createdAt: "desc" },
            take: takePerSource,
            include: {
              user: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true } } } },
              surgeryPackage: { select: { id: true, packageCode: true, packageName: true } },
            },
          })
        : [],
      prisma.approvalActionLog.findMany({
        where: { branchId },
        orderBy: { createdAt: "desc" },
        take: takePerSource,
        include: { org: { select: { id: true } }, branch: { select: { id: true, name: true } } },
      }),
      prisma.discountAuditLog.findMany({
        where: { branchId },
        orderBy: { createdAt: "desc" },
        take: takePerSource,
      }),
      prisma.doctorAuditLog.findMany({
        where: { branchId },
        orderBy: { createdAt: "desc" },
        take: takePerSource,
        include: { clinicStaffProfile: { select: { id: true } } },
      }),
    ]);
    const mapUser = (u: { id: number; profile?: { displayName: string } | null; auth?: { email: string | null } | null } | null) =>
      u != null ? { id: u.id, name: (u.profile as { displayName?: string })?.displayName ?? (u.auth as { email?: string | null })?.email ?? null } : null;
    const entries = [
      ...packageAudits.map((r) => ({
        id: `pkg-audit-${r.id}`,
        type: "package_audit",
        action: r.action,
        userId: r.userId,
        user: mapUser(r.user as Parameters<typeof mapUser>[0]),
        entityType: "PACKAGE",
        entityId: r.surgeryPackageId,
        package: (r as any).surgeryPackage,
        meta: r.meta,
        createdAt: r.createdAt,
      })),
      ...approvalLogs.map((r) => ({
        id: `approval-${r.id}`,
        type: "approval_action",
        action: r.action,
        userId: r.byUserId,
        entityType: r.entityType,
        entityId: r.entityId,
        reason: r.reason,
        meta: r.meta,
        createdAt: r.createdAt,
      })),
      ...discountAudits.map((r) => ({
        id: `discount-audit-${r.id}`,
        type: "discount_audit",
        action: r.action,
        userId: r.byUserId,
        entityType: "DISCOUNT",
        entityId: r.discountPolicyId,
        meta: r.meta,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      ...doctorAudits.map((r) => ({
        id: `doctor-audit-${r.id}`,
        type: "doctor_audit",
        action: r.action,
        userId: r.changedByUserId,
        entityType: "DOCTOR",
        entityId: (r as any).clinicStaffProfile?.id,
        field: r.field,
        oldValue: r.oldValue,
        newValue: r.newValue,
        meta: r.oldValue != null || r.newValue != null ? { oldValue: r.oldValue, newValue: r.newValue, field: r.field } : null,
        createdAt: r.createdAt,
      })),
    ]
      .filter((e) => !entityTypeFilter || e.entityType === entityTypeFilter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
    return sendClinicSuccess(res, 200, { entries });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get audit history", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

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
      department: body.department,
      requestType: body.requestType,
      neededBy: body.neededBy,
      reason: body.reason,
    });
    return sendClinicSuccess(res, 201, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.patchBranchSupplyRequest = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const requestId = Number(req.params.requestId);
    const body = req.body || {};
    const data = await clinicalSupplyRequestService.updateSupplyRequestDraft(requestId, branchId, {
      department: body.department,
      requestType: body.requestType,
      priority: body.priority,
      neededBy: body.neededBy,
      reason: body.reason,
      note: body.note,
      items: body.items,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.postBranchSupplyRequestCancel = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const requestId = Number(req.params.requestId);
    const userId = req.user?.id;
    const data = await clinicalSupplyRequestService.cancelSupplyRequest(requestId, branchId, userId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getBranchSupplyRequestItemSearch = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
    if (!branch) return sendClinicError(res, 404, "Branch not found", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const q = req.query.q ? String(req.query.q) : undefined;
    const limit = req.query.limit != null ? Math.min(Number(req.query.limit), 50) : 20;
    const items = await clinicalItemService.searchClinicalItems({ orgId: branch.orgId, q, branchId, limit });
    const itemIds = (items || []).map((i: any) => i.id);
    if (itemIds.length === 0) return sendClinicSuccess(res, 200, items || []);
    const stocks = await clinicalItemStockService.getBranchItemStock({ branchId });
    const stockByKey = new Map(stocks.map((s: any) => [`${s.itemId}_${s.variantId}`, s]));
    const enriched = (items || []).map((item: any) => ({
      ...item,
      variants: (item.variants || []).map((v: any) => {
        const key = `${item.id}_${v.id}`;
        const st = stockByKey.get(key) as { currentQty?: unknown; reorderLevel?: unknown } | undefined;
        return {
          ...v,
          currentStock: st ? Number(st.currentQty ?? 0) : null,
          reorderLevel: st?.reorderLevel != null ? Number(st.reorderLevel) : null,
        };
      }),
    }));
    return sendClinicSuccess(res, 200, enriched);
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
    if (expiryDate && expiryDate < new Date()) {
      return sendClinicError(res, 400, "Expired batch cannot be received", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
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
    const where: { branchId: number; returnedAt?: null | { not: null } } = { branchId };
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

// Clinic Approval Workflow: create/list approval requests (manager flow)
const clinicApprovalRequestService = require("../../services/clinicApprovalRequest.service");
const { CLINIC_APPROVAL_REQUEST_TYPES } = require("../../constants/clinicApprovalTypes");

exports.listClinicApprovalRequests = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const status = typeof req.query.status === "string" && ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status)
      ? (req.query.status as "PENDING" | "APPROVED" | "REJECTED")
      : undefined;
    const requestType =
      typeof req.query.requestType === "string" && req.query.requestType.length > 0 ? req.query.requestType : undefined;
    const doctorQueue =
      req.query.doctorQueue === "1" ||
      req.query.doctorQueue === "true" ||
      String(req.query.doctorQueue).toLowerCase() === "yes";
    let requestTypes: string[] | undefined;
    if (typeof req.query.requestTypes === "string" && req.query.requestTypes.trim()) {
      requestTypes = req.query.requestTypes.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    const requestedByUserId =
      req.query.requestedByUserId != null && String(req.query.requestedByUserId).trim() !== ""
        ? Number(req.query.requestedByUserId)
        : undefined;
    const memberId =
      req.query.memberId != null && String(req.query.memberId).trim() !== "" ? Number(req.query.memberId) : undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const offset = req.query.offset != null ? Number(req.query.offset) : undefined;

    const data = await clinicApprovalRequestService.listByBranch(branchId, {
      status,
      requestType: requestType as any,
      doctorQueueOnly: doctorQueue || undefined,
      requestTypes: requestTypes as any,
      requestedByUserId: requestedByUserId && Number.isFinite(requestedByUserId) ? requestedByUserId : undefined,
      memberId: memberId && Number.isFinite(memberId) ? memberId : undefined,
      createdFrom: from && !Number.isNaN(from.getTime()) ? from : undefined,
      createdTo: to && !Number.isNaN(to.getTime()) ? to : undefined,
      q,
      limit,
      offset,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list approval requests", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getClinicApprovalRequestsSummary = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const doctorQueue =
      req.query.doctorQueue === "1" ||
      req.query.doctorQueue === "true" ||
      String(req.query.doctorQueue).toLowerCase() === "yes";
    const data = await clinicApprovalRequestService.getBranchApprovalSummary(branchId, {
      doctorQueueOnly: doctorQueue || undefined,
    });
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get approval summary", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getClinicApprovalRequestById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const requestId = Number(req.params.requestId);
    if (!requestId || !Number.isFinite(requestId)) {
      return sendClinicError(res, 400, "Invalid request id", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const data = await clinicApprovalRequestService.getByIdForBranchWithLogs(branchId, requestId);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    if (e?.message === "REQUEST_BRANCH_MISMATCH") {
      return sendClinicError(res, 403, "Request does not belong to this branch", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
    }
    if (e?.message === "Clinic approval request not found") {
      return sendClinicError(res, 404, "Approval request not found", CLINIC_ERROR_CODES.NOT_FOUND);
    }
    return sendClinicError(res, 500, e?.message || "Failed to get approval request", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createClinicApprovalRequest = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const body = req.body || {};
    const requestType = body.requestType;
    if (!requestType || !CLINIC_APPROVAL_REQUEST_TYPES.includes(requestType)) {
      return sendClinicError(res, 400, "requestType required and must be one of: " + CLINIC_APPROVAL_REQUEST_TYPES.join(", "), CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const payload = typeof body.payload === "object" && body.payload !== null ? body.payload : {};
    const result = await clinicApprovalRequestService.createRequest({
      branchId,
      requestType,
      payload,
      requestedByUserId: userId,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to create approval request", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

/**
 * PUT /branches/:branchId/approval-requests/:requestId/decide
 * Staff/manager: approve or reject a clinic approval request for this branch.
 * Body: { decision: "APPROVED" | "REJECTED", rejectReason?: string }
 */
exports.decideClinicApprovalRequest = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const requestId = Number(req.params.requestId);
    const userId = req.user?.id;
    if (!userId) return sendClinicError(res, 401, "Unauthorized", CLINIC_ERROR_CODES.UNAUTHORIZED);
    if (!requestId || !Number.isFinite(requestId)) return sendClinicError(res, 400, "Invalid request id", CLINIC_ERROR_CODES.VALIDATION_ERROR);

    const row = await prisma.clinicApprovalRequest.findUnique({
      where: { id: requestId },
      select: { id: true, branchId: true, status: true },
    });
    if (!row) return sendClinicError(res, 404, "Approval request not found", CLINIC_ERROR_CODES.NOT_FOUND);
    if (row.branchId !== branchId) return sendClinicError(res, 403, "Request does not belong to this branch", CLINIC_ERROR_CODES.BRANCH_ACCESS_DENIED);
    if (row.status !== "PENDING") return sendClinicError(res, 400, "Request already resolved", CLINIC_ERROR_CODES.VALIDATION_ERROR);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const decision = body.decision === "APPROVED" || body.decision === "REJECTED" ? body.decision : null;
    if (!decision) return sendClinicError(res, 400, "decision required: APPROVED or REJECTED", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    if (decision === "REJECTED") {
      const rr = body.rejectReason;
      if (typeof rr !== "string" || !rr.trim()) {
        return sendClinicError(res, 400, "rejectReason is required when rejecting", CLINIC_ERROR_CODES.VALIDATION_ERROR);
      }
    }

    const result = await clinicApprovalRequestService.decide(requestId, decision, userId, body.rejectReason);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to decide approval request", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

/**
 * GET /branches/:branchId/rooms
 * Staff: list clinic rooms for the branch (filters + optional summary).
 */
exports.getScheduleBoard = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const dateFrom = q.dateFrom ? new Date(String(q.dateFrom)) : new Date();
    const dateTo = q.dateTo ? new Date(String(q.dateTo)) : new Date(dateFrom.getTime() + 7 * 24 * 60 * 60 * 1000);
    const filters: any = {};
    if (q.roomId != null) filters.roomId = Number(q.roomId);
    if (q.doctorId != null) filters.doctorId = Number(q.doctorId);
    if (q.serviceId != null) filters.serviceId = Number(q.serviceId);
    const data = await roomScheduling.getScheduleBoard(branchId, dateFrom, dateTo, Object.keys(filters).length ? filters : undefined);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get schedule board", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getRoomSchedule = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const roomId = Number(req.params.roomId);
    const dateStr = req.query?.date;
    const date = dateStr ? new Date(String(dateStr)) : new Date();
    if (!roomId) return sendClinicError(res, 400, "Invalid roomId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await roomScheduling.getRoomTodaySchedule(branchId, roomId, date);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get room schedule", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getLiveOperations = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const at = req.query?.at ? new Date(String(req.query.at)) : new Date();
    const data = await roomOccupancy.getLiveOperationsState(branchId, at);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get live operations", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getRoomsLiveState = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const at = req.query?.at ? new Date(String(req.query.at)) : new Date();
    const data = await roomOccupancy.getAllRoomsLiveState(branchId, at);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get rooms live state", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getRoomLiveState = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const roomId = Number(req.params.roomId);
    const at = req.query?.at ? new Date(String(req.query.at)) : new Date();
    if (!roomId) return sendClinicError(res, 400, "Invalid roomId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const data = await roomOccupancy.getRoomLiveState(branchId, roomId, at);
    if (!data) return sendClinicError(res, 404, "Room not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, data);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get room live state", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createRoomBlock = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const roomId = Number(req.params.roomId);
    const userId = req.user?.id ?? null;
    const body = req.body || {};
    const startAt = body.startAt ? new Date(body.startAt) : null;
    const endAt = body.endAt ? new Date(body.endAt) : null;
    if (!roomId || !startAt || !endAt || startAt >= endAt) {
      return sendClinicError(res, 400, "startAt and endAt (ISO) required with startAt < endAt", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const type = body.type && ["CLEANING", "MAINTENANCE", "BLOCKED", "EMERGENCY_UNAVAILABLE"].includes(body.type) ? body.type : "BLOCKED";
    const block = await roomOccupancy.createRoomBlock(
      branchId,
      roomId,
      { type, startAt, endAt, reason: body.reason ?? null },
      userId
    );
    return sendClinicSuccess(res, 201, block);
  } catch (e: any) {
    if (e?.message === "ROOM_NOT_FOUND") return sendClinicError(res, 404, "Room not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicError(res, 500, e?.message || "Failed to create block", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.releaseRoomBlock = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const blockId = Number(req.params.blockId);
    if (!blockId) return sendClinicError(res, 400, "Invalid blockId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const released = await roomOccupancy.releaseRoomBlock(blockId, branchId);
    if (!released) return sendClinicError(res, 404, "Block not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, { released: true });
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to release block", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listClinicRooms = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const q = req.query || {};
    const filters: any = {};
    if (q.roomType) filters.roomType = String(q.roomType);
    if (q.status) filters.status = String(q.status);
    if (q.operationalStatus) filters.operationalStatus = String(q.operationalStatus);
    if (q.zone) filters.zone = String(q.zone);
    if (q.floor) filters.floor = String(q.floor);
    if (q.activeOnly === "false") filters.activeOnly = false;
    if (q.bookableOnly === "true") filters.bookableOnly = true;

    const rooms = await roomManagement.listRooms(branchId, filters);
    if (q.summary === "1" || q.summary === "true") {
      const summary = await roomManagement.getRoomSummary(branchId);
      return sendClinicSuccess(res, 200, { items: rooms, summary });
    }
    return sendClinicSuccess(res, 200, rooms);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to list rooms", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

/**
 * GET /branches/:branchId/rooms/:roomId
 * Staff: get room detail (branch-scoped).
 */
exports.getClinicRoomDetail = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const roomId = Number(req.params.roomId);
    if (!roomId) return sendClinicError(res, 400, "Invalid roomId", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const room = await roomManagement.getRoomDetail(branchId, roomId);
    if (!room) return sendClinicError(res, 404, "Room not found", CLINIC_ERROR_CODES.NOT_FOUND);
    return sendClinicSuccess(res, 200, room);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to get room", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

/**
 * PATCH /branches/:branchId/rooms/:roomId
 * Staff: limited update (operationalStatus only by permission).
 */
exports.patchClinicRoom = async (req: any, res: any) => {
  try {
    const branchId = Number(req.clinicBranchId);
    const roomId = Number(req.params.roomId);
    const body = req.body || {};
    if (!roomId) return sendClinicError(res, 400, "Invalid roomId", CLINIC_ERROR_CODES.VALIDATION_ERROR);

    const existing = await prisma.branchRoom.findFirst({
      where: { id: roomId, branchId },
    });
    if (!existing) return sendClinicError(res, 404, "Room not found", CLINIC_ERROR_CODES.NOT_FOUND);

    const updateData: any = {};
    if (body.operationalStatus !== undefined) updateData.operationalStatus = String(body.operationalStatus);

    if (Object.keys(updateData).length === 0) {
      return sendClinicSuccess(res, 200, existing);
    }

    const room = await prisma.branchRoom.update({
      where: { id: roomId },
      data: updateData,
    });
    return sendClinicSuccess(res, 200, room);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed to update room", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// Enterprise: Surgery Package, Discount, Contract, Case, Settlement, Consumption, Reports
const clinicEnterprise = require("./clinicEnterprise.controller");
Object.assign(exports, clinicEnterprise);
