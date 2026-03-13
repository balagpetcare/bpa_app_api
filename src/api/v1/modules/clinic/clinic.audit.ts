/**
 * Clinic (Appointment + Queue) audit helper. Wraps writeAudit with clinic action/entity conventions.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeAudit } = require("../../../../middlewares/auditWriter");

export const CLINIC_AUDIT_ACTIONS = {
  APPOINTMENT_CREATED: "APPOINTMENT_CREATED",
  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",
  APPOINTMENT_CHECKED_IN: "APPOINTMENT_CHECKED_IN",
  APPOINTMENT_CANCELLED: "APPOINTMENT_CANCELLED",
  APPOINTMENT_RESCHEDULED: "APPOINTMENT_RESCHEDULED",
  APPOINTMENT_NO_SHOW: "APPOINTMENT_NO_SHOW",
  QUEUE_SESSION_OPENED: "QUEUE_SESSION_OPENED",
  QUEUE_SESSION_CLOSED: "QUEUE_SESSION_CLOSED",
  TICKET_ISSUED: "TICKET_ISSUED",
  TICKET_CALLED: "TICKET_CALLED",
  TICKET_SKIPPED: "TICKET_SKIPPED",
  TICKET_STARTED: "TICKET_STARTED",
  TICKET_COMPLETED: "TICKET_COMPLETED",
  TICKET_PRIORITY_CHANGED: "TICKET_PRIORITY_CHANGED",
  PATIENT_REGISTERED: "PATIENT_REGISTERED",
  PATIENT_UPDATED: "PATIENT_UPDATED",
  INTAKE_CREATED: "INTAKE_CREATED",
  INTAKE_UPDATED: "INTAKE_UPDATED",
  TREATMENT_CODE_GENERATED: "TREATMENT_CODE_GENERATED",
  INJECTION_TOKEN_GENERATED: "INJECTION_TOKEN_GENERATED",
  INJECTION_TOKEN_VALIDATED: "INJECTION_TOKEN_VALIDATED",
  INJECTION_TOKEN_CANCELLED: "INJECTION_TOKEN_CANCELLED",
  INJECTION_TOKEN_USED: "INJECTION_TOKEN_USED",
  MEDICATION_ADMINISTERED: "MEDICATION_ADMINISTERED",
} as const;

const ENTITY = {
  APPOINTMENT: "APPOINTMENT",
  QUEUE_SESSION: "QUEUE_SESSION",
  QUEUE_TICKET: "QUEUE_TICKET",
  PATIENT: "PATIENT",
  CLINIC_INTAKE: "CLINIC_INTAKE",
  INJECTION_TOKEN: "INJECTION_TOKEN",
  MEDICATION_ADMINISTRATION: "MEDICATION_ADMINISTRATION",
} as const;

export type ClinicAuditEntityType = keyof typeof ENTITY;

export interface WriteClinicAuditParams {
  req: any;
  action: string;
  entityType?: ClinicAuditEntityType;
  entityId: string | number;
  before?: any;
  after?: any;
}

/**
 * Write a clinic audit log entry. action should be one of CLINIC_AUDIT_ACTIONS.
 * Uses TRANSACTION or a generic entity type if AuditEntityType does not yet include clinic entities.
 */
async function writeClinicAudit(params: WriteClinicAuditParams): Promise<void> {
  try {
    const entityType: string =
      params.entityType && ENTITY[params.entityType as keyof typeof ENTITY]
        ? ENTITY[params.entityType as keyof typeof ENTITY]
        : ENTITY.APPOINTMENT;
    await writeAudit({
      prisma,
      req: params.req,
      action: params.action,
      entityType,
      entityId: String(params.entityId),
      before: params.before ?? null,
      after: params.after ?? null,
    });
  } catch (e) {
    console.error(
      "clinic.audit writeClinicAudit error:",
      (e as Error)?.message || e
    );
  }
}

module.exports = { writeClinicAudit, CLINIC_AUDIT_ACTIONS, ENTITY };
