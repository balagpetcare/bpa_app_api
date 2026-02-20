/**
 * Stock workflow audit helper.
 * Writes to AuditLog for StockRequest, StockDispatch, GRN actions.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { writeAudit } from "../../../../middlewares/auditWriter";

const ENTITY = {
  STOCK_REQUEST: "STOCK_REQUEST",
  STOCK_DISPATCH: "STOCK_DISPATCH",
  GRN: "GRN",
};

async function auditStockRequest(req, action, entityId, before, after) {
  try {
    await writeAudit({
      prisma,
      req,
      action,
      entityType: ENTITY.STOCK_REQUEST,
      entityId: String(entityId),
      before,
      after,
    });
  } catch (e) {
    console.warn("auditStockRequest", e?.message);
  }
}

async function auditStockDispatch(req, action, entityId, before, after) {
  try {
    await writeAudit({
      prisma,
      req,
      action,
      entityType: ENTITY.STOCK_DISPATCH,
      entityId: String(entityId),
      before,
      after,
    });
  } catch (e) {
    console.warn("auditStockDispatch", e?.message);
  }
}

async function auditGrn(req, action, entityId, before, after) {
  try {
    await writeAudit({
      prisma,
      req,
      action,
      entityType: ENTITY.GRN,
      entityId: String(entityId),
      before,
      after,
    });
  } catch (e) {
    console.warn("auditGrn", e?.message);
  }
}

/**
 * Best-effort: write one AuditLog when receive recorded damaged/short (discrepancy).
 * Metadata: dispatchId, grnId, branchId, userId, lines (variantId + quantityDamaged + quantityShort only).
 * Does not block response on failure.
 */
async function auditDiscrepancy(req, payload) {
  try {
    await writeAudit({
      prisma,
      req,
      action: "DISCREPANCY_RECORDED",
      entityType: ENTITY.GRN,
      entityId: String(payload.grnId),
      before: null,
      after: {
        dispatchId: payload.dispatchId,
        grnId: payload.grnId,
        branchId: payload.branchId ?? null,
        userId: payload.userId ?? null,
        lines: payload.lines ?? [],
      },
    });
  } catch (e) {
    console.warn("auditDiscrepancy", e?.message);
  }
}

export { auditStockRequest, auditStockDispatch, auditGrn, auditDiscrepancy };
