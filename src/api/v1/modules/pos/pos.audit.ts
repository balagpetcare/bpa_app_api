/**
 * POS-specific audit helper. Wraps writeAudit with POS action/entity conventions.
 * Uses TRANSACTION entity type until POS_SALE/POS_REFUND/POS_INVOICE are added to AuditEntityType.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeAudit } = require("../../../../middlewares/auditWriter");

export const POS_AUDIT_ACTIONS = {
  POS_SALE_CREATED: "POS_SALE_CREATED",
  POS_SALE_FINALIZED: "POS_SALE_FINALIZED",
  POS_RECEIPT_VIEWED: "POS_RECEIPT_VIEWED",
  POS_REFUND_INITIATED: "POS_REFUND_INITIATED",
  POS_REFUND_COMPLETED: "POS_REFUND_COMPLETED",
  POS_INVOICE_GENERATED: "POS_INVOICE_GENERATED",
  POS_SHIFT_OPENED: "POS_SHIFT_OPENED",
  POS_SHIFT_CLOSED: "POS_SHIFT_CLOSED",
} as const;

const ENTITY = {
  POS_SALE: "POS_SALE",
  POS_REFUND: "POS_REFUND",
  POS_INVOICE: "POS_INVOICE",
  POS_SHIFT: "POS_SHIFT",
} as const;

export interface WritePosAuditParams {
  req: any;
  action: string;
  entityType?: "POS_SALE" | "POS_REFUND" | "POS_INVOICE" | "POS_SHIFT";
  entityId: string | number;
  before?: any;
  after?: any;
}

/**
 * Write a POS audit log entry. action should be one of POS_AUDIT_ACTIONS.
 */
async function writePosAudit(params: WritePosAuditParams): Promise<void> {
  try {
    const entityType = params.entityType && ENTITY[params.entityType]
      ? ENTITY[params.entityType]
      : ENTITY.POS_SALE;
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
    console.error("pos.audit writePosAudit error:", (e as Error)?.message || e);
  }
}

module.exports = { writePosAudit, POS_AUDIT_ACTIONS, ENTITY };
