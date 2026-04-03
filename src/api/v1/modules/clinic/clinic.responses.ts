/**
 * Standardized Clinic (Appointment + Queue) API response envelopes and error codes.
 */
export const CLINIC_ERROR_CODES = {
  BRANCH_ACCESS_DENIED: "BRANCH_ACCESS_DENIED",
  UNAUTHORIZED: "UNAUTHORIZED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  APPOINTMENT_NOT_FOUND: "APPOINTMENT_NOT_FOUND",
  APPOINTMENT_ALREADY_CANCELLED: "APPOINTMENT_ALREADY_CANCELLED",
  QUEUE_SESSION_CLOSED: "QUEUE_SESSION_CLOSED",
  TICKET_NOT_FOUND: "TICKET_NOT_FOUND",
  DOUBLE_BOOKING: "DOUBLE_BOOKING",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  LEAD_TIME_VIOLATION: "LEAD_TIME_VIOLATION",
  CANCEL_WINDOW_EXPIRED: "CANCEL_WINDOW_EXPIRED",
  NOT_A_CLINIC_BRANCH: "NOT_A_CLINIC_BRANCH",
  CLINIC_MODULE_DISABLED: "CLINIC_MODULE_DISABLED",
  PATIENT_NOT_FOUND: "PATIENT_NOT_FOUND",
  /** Pet exists but has no appointment, visit, or clinic registration at this branch */
  PATIENT_NOT_IN_BRANCH: "PATIENT_NOT_IN_BRANCH",
  OWNER_NOT_FOUND: "OWNER_NOT_FOUND",
  VISIT_NOT_FOUND: "VISIT_NOT_FOUND",
  PAST_DATETIME_NOT_ALLOWED: "PAST_DATETIME_NOT_ALLOWED",
  ADVANCE_BOOKING_LIMIT_EXCEEDED: "ADVANCE_BOOKING_LIMIT_EXCEEDED",
  PAYMENT_ALREADY_COLLECTED: "PAYMENT_ALREADY_COLLECTED",
  DOCTOR_REQUIRED: "DOCTOR_REQUIRED",
  APPOINTMENT_DOCTOR_ALREADY_ASSIGNED: "APPOINTMENT_DOCTOR_ALREADY_ASSIGNED",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_INACTIVE: "ROOM_INACTIVE",
  ROOM_NOT_BOOKABLE: "ROOM_NOT_BOOKABLE",
  ROOM_BLOCKED: "ROOM_BLOCKED",
  ROOM_DOUBLE_BOOKED: "ROOM_DOUBLE_BOOKED",
  ROOM_TYPE_INCOMPATIBLE: "ROOM_TYPE_INCOMPATIBLE",
  ROOM_REQUIRED_FOR_CONFIRMATION: "ROOM_REQUIRED_FOR_CONFIRMATION",
  ROOM_MISMATCH: "ROOM_MISMATCH",
  SNAPSHOT_ONLY_CANNOT_CHECK_IN: "SNAPSHOT_ONLY_CANNOT_CHECK_IN",
  PET_OWNER_MISMATCH: "PET_OWNER_MISMATCH",
  DUPLICATE_PET: "DUPLICATE_PET",
  SURGERY_CASE_NOT_FOUND: "SURGERY_CASE_NOT_FOUND",
  COMPLETION_REQUIREMENTS_NOT_MET: "COMPLETION_REQUIREMENTS_NOT_MET",
  /** Only branch members with clinic staff profile staffType=DOCTOR may author prescriptions */
  PRESCRIPTION_FORBIDDEN: "PRESCRIPTION_FORBIDDEN",
  /** Finalized or dispensed prescriptions cannot be edited without an amendment workflow */
  PRESCRIPTION_NOT_EDITABLE: "PRESCRIPTION_NOT_EDITABLE",
} as const;

export function sendClinicError(
  res: any,
  statusCode: number,
  message: string,
  code: string = CLINIC_ERROR_CODES.VALIDATION_ERROR,
  meta?: { requiredPermission?: string; unmet?: string[] }
): void {
  const body: Record<string, unknown> = { success: false, message, code };
  if (meta?.requiredPermission) body.requiredPermission = meta.requiredPermission;
  if (meta?.unmet && meta.unmet.length) body.unmet = meta.unmet;
  res.status(statusCode).json(body);
}

export function sendClinicSuccess(
  res: any,
  statusCode: number,
  data: any,
  message?: string
): void {
  res.status(statusCode).json({
    success: true,
    data,
    ...(message ? { message } : {}),
  });
}
