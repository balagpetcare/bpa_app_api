/**
 * Centralized appointment state machine. Single source of truth for allowed status transitions.
 * Used by appointment.service for all mutations that change status.
 */

export const APPOINTMENT_STATUS = [
  "DRAFT",
  "PRE_BOOKED",
  "BOOKED",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_QUEUE",
  "CALLED",
  "IN_CONSULT",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export type AppointmentStatusType = (typeof APPOINTMENT_STATUS)[number];

export const APPOINTMENT_ACTION = [
  "CREATE",
  "DRAFT_CREATE",
  "PRE_BOOK",
  "PROMOTE",
  "CONFIRM",
  "CHECK_IN",
  "ENQUEUE",
  "CALL",
  "START_CONSULT",
  "COMPLETE",
  "CANCEL",
  "NO_SHOW",
  "RESCHEDULE",
] as const;

export type AppointmentActionType = (typeof APPOINTMENT_ACTION)[number];

/** Result of canTransition. ok: true -> toStatus is the new status; ok: false -> code + message for client. */
export type TransitionResult =
  | { ok: true; toStatus: AppointmentStatusType }
  | { ok: false; code: string; message: string };

/** Error thrown by assertTransition on invalid transition. Controllers should map to HTTP 409. */
export class InvalidTransitionError extends Error {
  statusCode = 409;
  code = "INVALID_STATUS_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

const TRANSITIONS: Record<AppointmentActionType, { from: AppointmentStatusType[]; to: AppointmentStatusType }> = {
  CREATE: { from: [], to: "BOOKED" },
  DRAFT_CREATE: { from: [], to: "DRAFT" },
  PRE_BOOK: { from: [], to: "PRE_BOOKED" },
  PROMOTE: { from: ["DRAFT", "PRE_BOOKED"], to: "BOOKED" },
  CONFIRM: { from: ["BOOKED"], to: "CONFIRMED" },
  CHECK_IN: { from: ["BOOKED", "CONFIRMED"], to: "CHECKED_IN" },
  ENQUEUE: { from: ["CHECKED_IN"], to: "IN_QUEUE" },
  CALL: { from: ["IN_QUEUE"], to: "CALLED" },
  START_CONSULT: { from: ["CALLED"], to: "IN_CONSULT" },
  COMPLETE: { from: ["IN_CONSULT"], to: "COMPLETED" },
  CANCEL: { from: ["BOOKED", "CONFIRMED", "DRAFT", "PRE_BOOKED"], to: "CANCELLED" },
  NO_SHOW: { from: ["BOOKED", "CONFIRMED", "DRAFT", "PRE_BOOKED"], to: "NO_SHOW" },
  RESCHEDULE: { from: ["BOOKED", "CONFIRMED"], to: "CANCELLED" }, // old -> CANCELLED; new -> BOOKED
};

/**
 * Check whether a transition from the given status with the given action is allowed.
 */
export function canTransition(
  fromStatus: string,
  action: AppointmentActionType
): TransitionResult {
  const normalizedFrom = fromStatus?.toUpperCase?.() as AppointmentStatusType;
  const rule = TRANSITIONS[action];
  if (!rule) {
    return { ok: false, code: "INVALID_STATUS_TRANSITION", message: `Unknown action: ${action}` };
  }
  if (rule.from.length > 0 && !rule.from.includes(normalizedFrom)) {
    const message = `Invalid transition: cannot ${action.replace(/_/g, " ")} when status is ${normalizedFrom}`;
    return { ok: false, code: "INVALID_STATUS_TRANSITION", message };
  }
  return { ok: true, toStatus: rule.to };
}

/**
 * Assert that the transition is allowed; throw InvalidTransitionError (409) if not.
 */
export function assertTransition(fromStatus: string, action: AppointmentActionType): void {
  const result = canTransition(fromStatus, action);
  if (!result.ok) {
    const err = result as { ok: false; code: string; message: string };
    throw new InvalidTransitionError(err.message);
  }
}
