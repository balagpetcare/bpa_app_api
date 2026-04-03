/**
 * Branch/org isolation guards for appointment mutations.
 * Ensures a user with access to one branch cannot mutate appointments belonging to another.
 */
const prisma = require("../../../../../infrastructure/db/prismaClient").default ?? require("../../../../../infrastructure/db/prismaClient");
const { CLINIC_ERROR_CODES } = require("../clinic.responses");

/** Error thrown when appointment is not found or not in the given branch/org. Use 404 to avoid info leakage. */
export class AppointmentNotFoundError extends Error {
  statusCode = 404;
  code = CLINIC_ERROR_CODES.APPOINTMENT_NOT_FOUND;

  constructor(message: string = "Appointment not found") {
    super(message);
    this.name = "AppointmentNotFoundError";
  }
}

/**
 * Load an appointment by id and verify it belongs to the given org and branch.
 * Use for all mutation endpoints that accept appointmentId.
 * @returns The appointment row (at least id, status, orgId, branchId; include more if needed by caller).
 * @throws AppointmentNotFoundError (404) if not found or orgId/branchId mismatch.
 */
export async function requireAppointmentInBranch(params: {
  appointmentId: number;
  orgId: number;
  branchId: number;
  select?: Record<string, boolean>;
}): Promise<any> {
  const { appointmentId, orgId, branchId, select } = params;
  // Always include orgId and branchId in the select so the branch check is valid when caller passes a custom select.
  const mergedSelect = { ...(select ?? { id: true, status: true }), orgId: true, branchId: true };
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: mergedSelect,
  });
  if (!appointment) {
    throw new AppointmentNotFoundError("Appointment not found");
  }
  if (appointment.orgId !== orgId || appointment.branchId !== branchId) {
    throw new AppointmentNotFoundError("Appointment not found");
  }
  return appointment;
}
