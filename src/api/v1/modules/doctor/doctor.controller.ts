/**
 * Doctor panel controller: appointments, visits, profile.
 * All routes require the user to be a doctor (ClinicStaffProfile with staffType=DOCTOR),
 * or to have a DoctorVerification record (verified or pending — list endpoints return empty data when no branch assignment).
 */
const doctorService = require("./doctor.service");
const doctorRequestService = require("./doctorRequest.service");
const appointmentService = require("../clinic/appointment.service");

function emitDoctorQueueUpdateIfAvailable(userId, payload) {
  try {
    const { emitDoctorQueueUpdate, emitDoctorAppointmentUpdate } = require("../../../realtime/socketio.gateway");
    if (typeof emitDoctorQueueUpdate === "function") emitDoctorQueueUpdate(userId, payload);
    if (typeof emitDoctorAppointmentUpdate === "function") emitDoctorAppointmentUpdate(userId, payload);
  } catch (_) {}
}

async function hasDoctorVerification(userId) {
  const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
  const v = await prisma.doctorVerification.findUnique({
    where: { userId },
    select: { id: true },
  });
  return Boolean(v);
}

exports.getMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const profile = await doctorService.getDoctorProfile(userId);
    if (profile.doctorBranchMemberIds.length === 0) {
      const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
      const hasDoctorVerification = await prisma.doctorVerification.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!hasDoctorVerification) {
        return res.status(403).json({ success: false, message: "Doctor access required" });
      }
      return res.status(200).json({ success: true, data: profile });
    }

    return res.status(200).json({ success: true, data: profile });
  } catch (e) {
    console.error("[doctor.getMe]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get doctor profile" });
  }
};

exports.getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) {
      const allowed = await hasDoctorVerification(userId);
      if (!allowed) return res.status(403).json({ success: false, message: "Doctor access required" });
    }

    const data = await doctorService.getDashboardSummary(userId, {
      branchId: req.query?.branchId ? Number(req.query.branchId) : undefined,
      date: req.query?.date ? String(req.query.date) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getDashboardSummary]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get dashboard summary" });
  }
};

exports.listAppointments = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) {
      const allowed = await hasDoctorVerification(userId);
      if (!allowed) return res.status(403).json({ success: false, message: "Doctor access required" });
      return res.status(200).json({ success: true, data: { appointments: [], total: 0 } });
    }

    const { date, fromDate, toDate, branchId, status, statuses, visitType, priority, appointmentType, search, limit, offset } = req.query;
    const result = await doctorService.listAppointments(doctorIds, {
      date: date ? String(date) : undefined,
      fromDate: fromDate ? String(fromDate) : undefined,
      toDate: toDate ? String(toDate) : undefined,
      branchId: branchId ? Number(branchId) : undefined,
      status: status ? String(status) : undefined,
      statuses: statuses ? String(statuses) : undefined,
      visitType: visitType ? String(visitType) : undefined,
      priority: priority ? String(priority) : undefined,
      appointmentType: appointmentType ? String(appointmentType) : undefined,
      search: search ? String(search) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("[doctor.listAppointments]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list appointments" });
  }
};

exports.getAppointmentStats = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) {
      const allowed = await hasDoctorVerification(userId);
      if (!allowed) return res.status(403).json({ success: false, message: "Doctor access required" });
      return res.status(200).json({ success: true, data: { total: 0, statusCounts: {}, emergencyCount: 0, followUpCount: 0, paymentPendingCount: 0 } });
    }
    const { date, fromDate, toDate, branchId } = req.query;
    const data = await doctorService.getAppointmentStats(doctorIds, {
      date: date ? String(date) : undefined,
      fromDate: fromDate ? String(fromDate) : undefined,
      toDate: toDate ? String(toDate) : undefined,
      branchId: branchId ? Number(branchId) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getAppointmentStats]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get stats" });
  }
};

exports.getAppointmentDetail = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });
    const data = await doctorService.getAppointmentById(id, doctorIds);
    if (!data) return res.status(404).json({ success: false, message: "Appointment not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getAppointmentDetail]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get appointment" });
  }
};

exports.callAppointment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });
    const data = await doctorService.callAppointment(id, userId, doctorIds);
    if (!data) return res.status(404).json({ success: false, message: "Appointment not found" });
    emitDoctorQueueUpdateIfAvailable(userId, { event: "CALL", appointmentId: id });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ success: false, message: e?.message || "Invalid status transition" });
    console.error("[doctor.callAppointment]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to call" });
  }
};

exports.startConsultAppointment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });
    const data = await doctorService.startConsultAppointment(id, userId, doctorIds);
    if (!data) return res.status(404).json({ success: false, message: "Appointment not found" });
    emitDoctorQueueUpdateIfAvailable(userId, { event: "START_CONSULT", appointmentId: id });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ success: false, message: e?.message || "Invalid status transition" });
    console.error("[doctor.startConsultAppointment]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to start consultation" });
  }
};

exports.completeAppointment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });
    const data = await doctorService.completeAppointment(id, userId, doctorIds);
    if (!data) return res.status(404).json({ success: false, message: "Appointment not found" });
    emitDoctorQueueUpdateIfAvailable(userId, { event: "COMPLETE", appointmentId: id });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ success: false, message: e?.message || "Invalid status transition" });
    console.error("[doctor.completeAppointment]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to complete" });
  }
};

exports.addNote = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });
    const body = req.body || {};
    const data = await doctorService.addDoctorNote(id, userId, doctorIds, {
      noteType: body.noteType,
      contentJson: body.contentJson,
    });
    if (!data) return res.status(404).json({ success: false, message: "Appointment or visit not found" });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.addNote]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to add note" });
  }
};

exports.createFollowUp = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });
    const body = req.body || {};
    if (!body.followUpDate) return res.status(400).json({ success: false, message: "followUpDate is required" });
    const data = await doctorService.createFollowUp(id, userId, doctorIds, {
      followUpDate: body.followUpDate,
      followUpNotes: body.followUpNotes,
      createAppointment: body.createAppointment,
    });
    if (!data) return res.status(404).json({ success: false, message: "Appointment or visit not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.createFollowUp]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to create follow-up" });
  }
};

exports.getPatientHistory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const petId = Number(req.params.petId);
    if (!Number.isFinite(petId)) return res.status(400).json({ success: false, message: "Invalid petId" });
    const data = await doctorService.getPatientHistory(petId, doctorIds);
    if (!data) return res.status(404).json({ success: false, message: "Pet not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getPatientHistory]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get patient history" });
  }
};

exports.listFollowUps = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const data = await doctorService.listFollowUps(doctorIds, {
      branchId: req.query?.branchId ? Number(req.query.branchId) : undefined,
      status: req.query?.status ? String(req.query.status) : undefined,
      limit: req.query?.limit ? Number(req.query.limit) : undefined,
      offset: req.query?.offset ? Number(req.query.offset) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.listFollowUps]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list follow-ups" });
  }
};

exports.listCases = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const data = await doctorService.listCasesForDoctor(doctorIds, {
      branchId: req.query?.branchId ? Number(req.query.branchId) : undefined,
      status: req.query?.status ? String(req.query.status) : undefined,
      limit: req.query?.limit ? Number(req.query.limit) : undefined,
      offset: req.query?.offset ? Number(req.query.offset) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.listCases]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list cases" });
  }
};

exports.listPrescriptions = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) return res.status(403).json({ success: false, message: "Doctor access required" });
    const data = await doctorService.listPrescriptionsForDoctor(doctorIds, {
      branchId: req.query?.branchId ? Number(req.query.branchId) : undefined,
      status: req.query?.status ? String(req.query.status) : undefined,
      limit: req.query?.limit ? Number(req.query.limit) : undefined,
      offset: req.query?.offset ? Number(req.query.offset) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.listPrescriptions]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list prescriptions" });
  }
};

exports.listVisits = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) {
      const allowed = await hasDoctorVerification(userId);
      if (!allowed) return res.status(403).json({ success: false, message: "Doctor access required" });
      return res.status(200).json({ success: true, data: { visits: [], total: 0 } });
    }

    const { date, branchId, limit, offset } = req.query;
    const result = await doctorService.listVisits(doctorIds, {
      date: date ? String(date) : undefined,
      branchId: branchId ? Number(branchId) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("[doctor.listVisits]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list visits" });
  }
};

exports.getVisit = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) {
      return res.status(403).json({ success: false, message: "Doctor access required" });
    }

    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) {
      return res.status(400).json({ success: false, message: "Invalid visit id" });
    }

    const visit = await doctorService.getVisitById(visitId, doctorIds);
    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found" });
    }
    return res.status(200).json({ success: true, data: visit });
  } catch (e) {
    console.error("[doctor.getVisit]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get visit" });
  }
};

exports.updateBranchFee = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
    if (doctorIds.length === 0) {
      return res.status(403).json({ success: false, message: "Doctor access required" });
    }

    const branchMemberId = Number(req.params.branchMemberId);
    if (!Number.isFinite(branchMemberId)) {
      return res.status(400).json({ success: false, message: "Invalid branchMemberId" });
    }
    const raw = req.body?.defaultConsultationFee;
    const fee = raw === null || raw === "" ? null : typeof raw === "number" ? raw : Number(raw);
    if (fee !== null && (typeof fee !== "number" || Number.isNaN(fee) || fee < 0)) {
      return res.status(400).json({ success: false, message: "defaultConsultationFee must be a non-negative number or null" });
    }

    const updated = await doctorService.updateOwnConsultationFee(userId, branchMemberId, fee);
    if (!updated) {
      return res.status(404).json({ success: false, message: "Branch profile not found" });
    }
    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    console.error("[doctor.updateBranchFee]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to update fee" });
  }
};

async function ensureOwnAppointment(req, res, appointmentId) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return { userId: null, doctorIds: [], appointment: null };
  }
  const doctorIds = await doctorService.getDoctorBranchMemberIds(userId);
  if (doctorIds.length === 0) {
    res.status(403).json({ success: false, message: "Doctor access required" });
    return { userId: null, doctorIds: [], appointment: null };
  }
  const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, doctorId: true, orgId: true, branchId: true, status: true },
  });
  if (!appointment || !doctorIds.includes(appointment.doctorId)) {
    res.status(404).json({ success: false, message: "Appointment not found" });
    return { userId: null, doctorIds: [], appointment: null };
  }
  return { userId, doctorIds, appointment };
}

exports.confirmAppointment = async (req, res) => {
  try {
    const appointmentId = Number(req.params.id);
    if (!Number.isFinite(appointmentId)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id" });
    }
    const { userId, appointment } = await ensureOwnAppointment(req, res, appointmentId);
    if (!userId || !appointment) return;

    const updated = await appointmentService.confirmAppointment(
      appointmentId,
      userId,
      { orgId: appointment.orgId, branchId: appointment.branchId }
    );
    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ success: false, message: e?.message || "Invalid status transition" });
    console.error("[doctor.confirmAppointment]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to confirm" });
  }
};

exports.cancelAppointment = async (req, res) => {
  try {
    const appointmentId = Number(req.params.id);
    if (!Number.isFinite(appointmentId)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id" });
    }
    const { userId, appointment } = await ensureOwnAppointment(req, res, appointmentId);
    if (!userId || !appointment) return;

    const reason = req.body?.reason ? String(req.body.reason).trim() : "Cancelled by doctor";
    const updated = await appointmentService.cancelAppointment(
      appointmentId,
      reason,
      userId,
      { orgId: appointment.orgId, branchId: appointment.branchId }
    );
    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ success: false, message: e?.message || "Invalid status transition" });
    console.error("[doctor.cancelAppointment]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to cancel" });
  }
};

exports.rescheduleAppointment = async (req, res) => {
  try {
    const appointmentId = Number(req.params.id);
    if (!Number.isFinite(appointmentId)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id" });
    }
    const { userId, appointment } = await ensureOwnAppointment(req, res, appointmentId);
    if (!userId || !appointment) return;

    const body = req.body || {};
    const scheduledStartAt = body.scheduledStartAt ? new Date(body.scheduledStartAt) : null;
    const scheduledEndAt = body.scheduledEndAt ? new Date(body.scheduledEndAt) : null;
    if (!scheduledStartAt || !scheduledEndAt || scheduledStartAt >= scheduledEndAt) {
      return res.status(400).json({ success: false, message: "scheduledStartAt and scheduledEndAt required (start < end)" });
    }
    const newSlot = {
      scheduledStartAt,
      scheduledEndAt,
      doctorId: body.doctorId != null ? Number(body.doctorId) : undefined,
    };
    const created = await appointmentService.rescheduleAppointment(
      appointmentId,
      newSlot,
      userId,
      { orgId: appointment.orgId, branchId: appointment.branchId }
    );
    return res.status(200).json({ success: true, data: created });
  } catch (e) {
    if (e?.statusCode === 409) return res.status(409).json({ success: false, message: e?.message || "Invalid status transition" });
    if (e?.message?.includes("DOUBLE_BOOKING") || e?.code === "DOUBLE_BOOKING") return res.status(409).json({ success: false, message: "Slot already booked" });
    console.error("[doctor.rescheduleAppointment]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to reschedule" });
  }
};

// --- Schedule proposals (CP3A) ---
exports.createScheduleProposal = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const body = req.body || {};
    const proposal = await doctorService.createScheduleProposal(userId, branchId, { proposalPayload: body.proposalPayload });
    if (!proposal) return res.status(404).json({ success: false, message: "Branch or doctor profile not found" });
    return res.status(201).json({ success: true, data: proposal });
  } catch (e) {
    if (e?.statusCode === 403) return res.status(403).json({ success: false, message: e?.message || "Forbidden" });
    console.error("[doctor.createScheduleProposal]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to create proposal" });
  }
};

exports.listMyScheduleProposals = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const status = req.query?.status ? String(req.query.status) : undefined;
    const result = await doctorService.listMyScheduleProposals(userId, branchId, { status });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("[doctor.listMyScheduleProposals]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list proposals" });
  }
};

// --- Metrics (CP4A) ---
exports.getMyMetrics = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    const data = await doctorService.getMyMetrics(userId, branchId, { from, to });
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found for this branch" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getMyMetrics]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get metrics" });
  }
};

exports.getMySettlementLedger = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });

    const status = req.query?.status ? String(req.query.status) : undefined;
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    const data = await doctorService.getMySettlementLedger(userId, branchId, { status, from, to });
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found for this branch" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getMySettlementLedger]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get settlement ledger" });
  }
};

exports.getMySettlementSummary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    const data = await doctorService.getMySettlementSummary(userId, branchId, { from, to });
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found for this branch" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getMySettlementSummary]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get settlement summary" });
  }
};

exports.getMySettlementBatches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const status = req.query?.status ? String(req.query.status) : undefined;
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    const page = req.query?.page ? Number(req.query.page) : undefined;
    const limit = req.query?.limit ? Number(req.query.limit) : undefined;
    const data = await doctorService.getMySettlementBatches(userId, branchId, { status, from, to, page, limit });
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found for this branch" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getMySettlementBatches]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get settlement batches" });
  }
};

exports.getMyContract = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.getMyContract(userId, branchId);
    return res.status(200).json({ success: true, data: data ?? null });
  } catch (e) {
    console.error("[doctor.getMyContract]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get contract" });
  }
};

exports.listNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await doctorService.listDoctorNotifications(userId, {
      limit: req.query?.limit ? Number(req.query.limit) : undefined,
      offset: req.query?.offset ? Number(req.query.offset) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.listNotifications]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list notifications" });
  }
};

exports.getNotificationUnreadCount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await doctorService.getDoctorNotificationUnreadCount(userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getNotificationUnreadCount]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get unread count" });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid notification id" });
    const data = await doctorService.markDoctorNotificationRead(userId, id);
    if (!data) return res.status(404).json({ success: false, message: "Notification not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.markNotificationRead]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to mark notification as read" });
  }
};

// --- Onboarding ---
exports.getOnboarding = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.getOnboarding(userId, branchId);
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found for this branch" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getOnboarding]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get onboarding" });
  }
};

exports.completeOnboarding = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.completeOnboarding(userId, branchId);
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    if (e?.statusCode === 400) return res.status(400).json({ success: false, message: e?.message || "Validation failed" });
    console.error("[doctor.completeOnboarding]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to complete onboarding" });
  }
};

/** POST /doctor/onboarding/complete – set profile-level onboardingCompleted (no branch). */
exports.completeProfileOnboarding = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await doctorService.completeProfileOnboarding(userId);
    if (!data) return res.status(404).json({ success: false, message: "Doctor verification not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.completeProfileOnboarding]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to complete profile onboarding" });
  }
};

// --- Doctor requests (fee/schedule/cancel/leave – clinic approval) ---
exports.listDoctorRequests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = req.query?.branchId ? Number(req.query.branchId) : undefined;
    const status = req.query?.status ? String(req.query.status) : undefined;
    const result = await doctorRequestService.listForDoctor(userId, { branchId, status });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("[doctor.listDoctorRequests]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list requests" });
  }
};

exports.createDoctorRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { branchId, type, payload } = req.body || {};
    if (!branchId || !type) return res.status(400).json({ success: false, message: "branchId and type required" });
    const data = await doctorRequestService.create(userId, { branchId: Number(branchId), type: String(type), payload });
    if (!data) return res.status(403).json({ success: false, message: "Cannot create request for this branch" });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.createDoctorRequest]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to create request" });
  }
};

// --- My services ---
exports.getMyServices = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.getMyServices(userId, branchId);
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getMyServices]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get services" });
  }
};

exports.putMyServices = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.putMyServices(userId, branchId, req.body || {});
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.putMyServices]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to update services" });
  }
};

// --- My schedule ---
exports.getMySchedule = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.getMySchedule(userId, branchId);
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getMySchedule]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get schedule" });
  }
};

exports.putMySchedule = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.putMySchedule(userId, branchId, req.body || {});
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    if (e?.statusCode === 403) return res.status(403).json({ success: false, message: e?.message || "Forbidden" });
    console.error("[doctor.putMySchedule]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to update schedule" });
  }
};

// --- My schedule exceptions ---
exports.getMyExceptions = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const from = req.query?.from ? String(req.query.from) : undefined;
    const to = req.query?.to ? String(req.query.to) : undefined;
    const data = await doctorService.getMyExceptions(userId, branchId, { from, to });
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getMyExceptions]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get exceptions" });
  }
};

exports.getUpcomingLeaves = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await doctorService.getUpcomingLeaves(userId, {
      branchId: req.query?.branchId ? Number(req.query.branchId) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getUpcomingLeaves]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get upcoming leaves" });
  }
};

exports.createMyException = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.createMyException(userId, branchId, req.body || {});
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.createMyException]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to create exception" });
  }
};

exports.deleteMyException = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    const exceptionId = Number(req.params.exceptionId);
    if (!Number.isFinite(branchId) || !Number.isFinite(exceptionId)) return res.status(400).json({ success: false, message: "Invalid branchId or exceptionId" });
    const data = await doctorService.deleteMyException(userId, branchId, exceptionId);
    if (!data) return res.status(404).json({ success: false, message: "Exception not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.deleteMyException]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to delete exception" });
  }
};

// --- Service proposals ---
exports.createServiceProposal = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const body = req.body || {};
    if (!body.title || typeof body.title !== "string" || !body.title.trim()) return res.status(400).json({ success: false, message: "title is required" });
    const data = await doctorService.createServiceProposal(userId, branchId, {
      title: body.title,
      category: body.category,
      department: body.department,
      suggestedPrice: body.suggestedPrice != null ? Number(body.suggestedPrice) : null,
      reason: body.reason,
    });
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found" });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.createServiceProposal]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to create proposal" });
  }
};

exports.listMyServiceProposals = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const status = req.query?.status ? String(req.query.status) : undefined;
    const result = await doctorService.listMyServiceProposals(userId, branchId, { status });
    return res.status(200).json({ success: true, data: result ?? { proposals: [] } });
  } catch (e) {
    console.error("[doctor.listMyServiceProposals]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list proposals" });
  }
};

exports.listConsultationTemplates = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ success: false, message: "Invalid branchId" });
    const data = await doctorService.listConsultationTemplatesForDoctor(userId, branchId);
    if (!data) return res.status(404).json({ success: false, message: "Doctor profile not found for this branch" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.listConsultationTemplates]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list consultation templates" });
  }
};

exports.getReminders = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await doctorService.getDoctorReminders(userId, {
      branchId: req.query?.branchId ? Number(req.query.branchId) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.getReminders]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get reminders" });
  }
};
