/**
 * Clinic intake service: Help Desk intake form data linked to appointments.
 * getIntakeByAppointmentId, upsertIntake (with status sync), getIntakeForVisit.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

const INTAKE_STATUS = { NOT_STARTED: "NOT_STARTED", PARTIAL: "PARTIAL", COMPLETE: "COMPLETE" };

function computeIntakeStatus(row: {
  chiefComplaint?: string | null;
  weightKg?: number | null;
  tempC?: number | null;
  symptomsJson?: unknown;
  riskFlagsJson?: unknown;
}): string {
  const hasComplaint = !!row.chiefComplaint?.trim();
  const hasVital = row.weightKg != null || row.tempC != null;
  const hasAny =
    hasComplaint ||
    hasVital ||
    row.symptomsJson != null ||
    row.riskFlagsJson != null ||
    false;
  if (!hasAny) return INTAKE_STATUS.NOT_STARTED;
  if (hasComplaint && hasVital) return INTAKE_STATUS.COMPLETE;
  return INTAKE_STATUS.PARTIAL;
}

/**
 * Fetch intake for an appointment (branch-scoped).
 */
async function getIntakeByAppointmentId(
  orgId: number,
  branchId: number,
  appointmentId: number
): Promise<any | null> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, orgId, branchId },
    select: { id: true },
  });
  if (!appointment) return null;

  const intake = await prisma.clinicIntake.findUnique({
    where: { appointmentId },
    include: {
      appointment: {
        select: {
          id: true,
          intakeStatus: true,
          patientId: true,
          petId: true,
          doctorId: true,
          scheduledStartAt: true,
          source: true,
          status: true,
          patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
          pet: { select: { id: true, name: true, animalType: { select: { name: true } }, breed: { select: { name: true } }, sex: true, dateOfBirth: true } },
          doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
        },
      },
    },
  });
  return intake;
}

/**
 * Create or update intake for an appointment; sync appointment.intakeStatus.
 */
async function upsertIntake(
  orgId: number,
  branchId: number,
  appointmentId: number,
  data: {
    chiefComplaint?: string | null;
    complaintDuration?: string | null;
    complaintOnset?: string | null;
    symptomsJson?: unknown;
    additionalSymptoms?: string | null;
    weightKg?: number | null;
    tempC?: number | null;
    heartRate?: number | null;
    respRate?: number | null;
    hydrationStatus?: string | null;
    feedingJson?: unknown;
    historyJson?: unknown;
    riskFlagsJson?: unknown;
    documentsJson?: unknown;
  },
  userId?: number | null
): Promise<any> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, orgId, branchId },
    select: { id: true },
  });
  if (!appointment) throw new Error("Appointment not found");

  const existing = await prisma.clinicIntake.findUnique({
    where: { appointmentId },
  });

  const payload: any = {
    orgId,
    branchId,
    appointmentId,
    updatedByUserId: userId ?? null,
    chiefComplaint: data.chiefComplaint ?? existing?.chiefComplaint ?? null,
    complaintDuration: data.complaintDuration ?? existing?.complaintDuration ?? null,
    complaintOnset: data.complaintOnset ?? existing?.complaintOnset ?? null,
    symptomsJson: data.symptomsJson !== undefined ? data.symptomsJson : existing?.symptomsJson ?? null,
    additionalSymptoms: data.additionalSymptoms !== undefined ? data.additionalSymptoms : existing?.additionalSymptoms ?? null,
    weightKg: data.weightKg !== undefined ? data.weightKg : existing?.weightKg ?? null,
    tempC: data.tempC !== undefined ? data.tempC : existing?.tempC ?? null,
    heartRate: data.heartRate !== undefined ? data.heartRate : existing?.heartRate ?? null,
    respRate: data.respRate !== undefined ? data.respRate : existing?.respRate ?? null,
    hydrationStatus: data.hydrationStatus ?? existing?.hydrationStatus ?? null,
    feedingJson: data.feedingJson !== undefined ? data.feedingJson : existing?.feedingJson ?? null,
    historyJson: data.historyJson !== undefined ? data.historyJson : existing?.historyJson ?? null,
    riskFlagsJson: data.riskFlagsJson !== undefined ? data.riskFlagsJson : existing?.riskFlagsJson ?? null,
    documentsJson: data.documentsJson !== undefined ? data.documentsJson : existing?.documentsJson ?? null,
  };

  let intake;
  if (existing) {
    intake = await prisma.clinicIntake.update({
      where: { id: existing.id },
      data: {
        ...payload,
        status: computeIntakeStatus(payload),
      },
      include: { appointment: { select: { id: true, intakeStatus: true } } },
    });
  } else {
    intake = await prisma.clinicIntake.create({
      data: {
        ...payload,
        createdByUserId: userId ?? null,
        status: computeIntakeStatus(payload),
      },
      include: { appointment: { select: { id: true, intakeStatus: true } } },
    });
  }

  const newStatus = computeIntakeStatus(intake);
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { intakeStatus: newStatus },
  });

  return prisma.clinicIntake.findUnique({
    where: { appointmentId },
    include: {
      appointment: {
        select: {
          id: true,
          intakeStatus: true,
          patientId: true,
          petId: true,
          doctorId: true,
          scheduledStartAt: true,
          source: true,
          status: true,
          patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
          pet: { select: { id: true, name: true, animalType: { select: { name: true } }, breed: { select: { name: true } }, sex: true, dateOfBirth: true } },
          doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
        },
      },
    },
  });
}

/**
 * Fetch intake for a visit (via visit.appointmentId).
 */
async function getIntakeForVisit(
  orgId: number,
  branchId: number,
  visitId: number
): Promise<any | null> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, orgId, branchId },
    select: { appointmentId: true },
  });
  if (!visit || !visit.appointmentId) return null;
  return getIntakeByAppointmentId(orgId, branchId, visit.appointmentId);
}

module.exports = {
  getIntakeByAppointmentId,
  upsertIntake,
  getIntakeForVisit,
  computeIntakeStatus,
  INTAKE_STATUS,
};
