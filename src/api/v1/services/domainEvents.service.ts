/**
 * Lightweight domain event emitter for clinic/settlement flows.
 * Events: case.opened, package.applied, discount.requested, discount.approved,
 * procedure.completed, inventory.consumed, invoice.generated, invoice.paid,
 * settlement.accrued, settlement.approved, settlement.paid, refund.processed.
 * Subscribers can perform audit logging, notifications, inventory reconciliation.
 */
const EventEmitter = require("events");

export const DOMAIN_EVENTS = {
  CASE_OPENED: "case.opened",
  PACKAGE_APPLIED: "package.applied",
  DISCOUNT_REQUESTED: "discount.requested",
  DISCOUNT_APPROVED: "discount.approved",
  PROCEDURE_COMPLETED: "procedure.completed",
  INVENTORY_CONSUMED: "inventory.consumed",
  INVOICE_GENERATED: "invoice.generated",
  INVOICE_PAID: "invoice.paid",
  SETTLEMENT_ACCRUED: "settlement.accrued",
  SETTLEMENT_APPROVED: "settlement.approved",
  SETTLEMENT_PAID: "settlement.paid",
  REFUND_PROCESSED: "refund.processed",
} as const;

type DomainEventName = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

/** Emit a domain event (fire-and-forget; errors in listeners are caught and logged). */
export function emit(eventName: DomainEventName, payload: Record<string, unknown>): void {
  setImmediate(() => {
    try {
      emitter.emit(eventName, payload);
    } catch (e) {
      try {
        // eslint-disable-next-line no-console
        console.error("[domainEvents] listener error", eventName, e);
      } catch (_) {}
    }
  });
}

/** Subscribe to a domain event. Returns unsubscribe function. */
export function on(
  eventName: DomainEventName,
  handler: (payload: Record<string, unknown>) => void | Promise<void>
): () => void {
  const wrapped = (payload: Record<string, unknown>) => {
    try {
      const result = handler(payload);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[domainEvents] async listener error", eventName, err);
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[domainEvents] listener error", eventName, e);
    }
  };
  emitter.on(eventName, wrapped);
  return () => emitter.off(eventName, wrapped);
}

/** Remove all listeners for an event (or all events if no name). */
export function removeAllListeners(eventName?: DomainEventName): void {
  if (eventName) emitter.removeAllListeners(eventName);
  else emitter.removeAllListeners();
}
