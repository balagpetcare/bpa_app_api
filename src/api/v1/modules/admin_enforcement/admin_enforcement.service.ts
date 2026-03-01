/**
 * Trust & Safety / Enforcement: case-centric complaint and enforcement actions.
 * Trace code -> batch -> product -> org; apply/revert actions with audit.
 */

import type { PrismaClient } from "@prisma/client";
import { hmacHash } from "../../utils/authCodeHasher";
import * as auditGov from "../../services/governance/auditGovernance.service";

const NOTIFICATION_TYPE_BY_ACTION: Record<string, "ENFORCEMENT_CODE_BLOCKED" | "ENFORCEMENT_BATCH_QUARANTINED" | "ENFORCEMENT_PRODUCT_DEACTIVATED" | "ENFORCEMENT_ORG_SUSPENDED" | "ENFORCEMENT_ACTION_REVERTED"> = {
  CODE_BLOCKED: "ENFORCEMENT_CODE_BLOCKED",
  CODE_REVOKED: "ENFORCEMENT_CODE_BLOCKED",
  BATCH_QUARANTINED: "ENFORCEMENT_BATCH_QUARANTINED",
  BATCH_FROZEN: "ENFORCEMENT_BATCH_QUARANTINED",
  PRODUCT_DEACTIVATED: "ENFORCEMENT_PRODUCT_DEACTIVATED",
  PRODUCT_RESET_UNAPPROVED: "ENFORCEMENT_PRODUCT_DEACTIVATED",
  ORG_SUSPENDED: "ENFORCEMENT_ORG_SUSPENDED",
  ORG_KYC_REVERIFY: "ENFORCEMENT_ORG_SUSPENDED",
  ORG_BAN: "ENFORCEMENT_ORG_SUSPENDED",
};

async function notifyProducerOrgEnforcement(
  prisma: PrismaClient,
  producerOrgId: number,
  kind: "APPLIED" | "REVERTED",
  payload: { actionType: string; caseNo: string; targetType?: string; targetId?: string }
) {
  const org = await prisma.producerOrg.findUnique({
    where: { id: producerOrgId },
    select: { ownerUserId: true },
  });
  if (!org?.ownerUserId) return;
  const { createNotification } = require("../../services/notification.service");
  const notifType = kind === "REVERTED" ? "ENFORCEMENT_ACTION_REVERTED" : NOTIFICATION_TYPE_BY_ACTION[payload.actionType] ?? "ENFORCEMENT_ORG_SUSPENDED";
  const title = kind === "REVERTED" ? `Enforcement action reverted (Case ${payload.caseNo})` : `Enforcement action applied (Case ${payload.caseNo})`;
  const message =
    kind === "REVERTED"
      ? `An enforcement action was reverted for case ${payload.caseNo}.`
      : `Action ${payload.actionType} was applied. Case: ${payload.caseNo}.`;
  await createNotification({
    userId: org.ownerUserId,
    type: notifType as any,
    title,
    message,
    meta: { caseNo: payload.caseNo, actionType: payload.actionType, targetType: payload.targetType, targetId: payload.targetId },
    priority: "P1",
    source: "enforcement",
    actionUrl: `/producer/notifications`,
  });
}

const CASE_NO_PREFIX = "TSE-";
const SOURCES = ["CONSUMER", "ADMIN", "PARTNER", "AUTO"] as const;
const ENTITY_TYPES = ["CODE", "BATCH", "PRODUCT", "ORG"] as const;
const CASE_STATUSES = ["OPEN", "INVESTIGATING", "ACTIONED", "RESOLVED", "REJECTED"] as const;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const EVIDENCE_TYPES = ["TEXT", "IMAGE", "VIDEO", "DOC", "URL"] as const;
const ACTION_TYPES = [
  "CODE_BLOCKED",
  "CODE_REVOKED",
  "BATCH_QUARANTINED",
  "BATCH_FROZEN",
  "BATCH_UNQUARANTINED",
  "BATCH_UNFROZEN",
  "PRODUCT_DEACTIVATED",
  "PRODUCT_RESET_UNAPPROVED",
  "PRODUCT_RESTORED",
  "ORG_SUSPENDED",
  "ORG_KYC_REVERIFY",
  "ORG_BAN",
  "ORG_UNSUSPENDED",
] as const;

export type CaseSource = (typeof SOURCES)[number];
export type CaseEntityType = (typeof ENTITY_TYPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type ActionType = (typeof ACTION_TYPES)[number];

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function nextCaseNo(prisma: PrismaClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${CASE_NO_PREFIX}${year}-`;
  return prisma.complaintCase
    .findFirst({
      where: { caseNo: { startsWith: prefix } },
      orderBy: { caseNo: "desc" },
      select: { caseNo: true },
    })
    .then((last) => {
      const num = last ? parseInt(last.caseNo.replace(prefix, ""), 10) || 0 : 0;
      return `${prefix}${String(num + 1).padStart(5, "0")}`;
    });
}

export async function listCases(
  prisma: PrismaClient,
  params: {
    entityType?: string;
    producerOrgId?: number;
    orgId?: number;
    status?: string;
    severity?: string;
    q?: string;
    dateFrom?: Date | string | null;
    dateTo?: Date | string | null;
    page?: number;
    limit?: number;
  }
) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 20));
  const page = Math.max(1, params.page ?? 1);
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  const orgId = params.producerOrgId ?? params.orgId;
  if (orgId != null) where.producerOrgId = orgId;
  if (params.entityType && ENTITY_TYPES.includes(params.entityType as CaseEntityType))
    where.entityType = params.entityType;
  if (params.status && CASE_STATUSES.includes(params.status as CaseStatus)) where.status = params.status;
  if (params.severity && SEVERITIES.includes(params.severity as Severity)) where.severity = params.severity;
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {};
    if (params.dateFrom) {
      const d = typeof params.dateFrom === "string" ? new Date(params.dateFrom) : params.dateFrom;
      if (!isNaN(d.getTime())) (where.createdAt as Record<string, Date>).gte = d;
    }
    if (params.dateTo) {
      const d = typeof params.dateTo === "string" ? new Date(params.dateTo) : params.dateTo;
      if (!isNaN(d.getTime())) {
        const end = new Date(d);
        end.setUTCHours(23, 59, 59, 999);
        (where.createdAt as Record<string, Date>).lte = end;
      }
    }
  }
  if (params.q && params.q.trim()) {
    where.OR = [
      { caseNo: { contains: params.q.trim(), mode: "insensitive" } },
      { summary: { contains: params.q.trim(), mode: "insensitive" } },
      { details: { contains: params.q.trim(), mode: "insensitive" } },
    ];
  }
  const [data, total] = await Promise.all([
    prisma.complaintCase.findMany({
      where,
      include: { producerOrg: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.complaintCase.count({ where }),
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
}

export async function getCaseStats(prisma: PrismaClient) {
  const [total, open, investigating, actioned, resolved, rejected, critical] = await Promise.all([
    prisma.complaintCase.count(),
    prisma.complaintCase.count({ where: { status: "OPEN" } }),
    prisma.complaintCase.count({ where: { status: "INVESTIGATING" } }),
    prisma.complaintCase.count({ where: { status: "ACTIONED" } }),
    prisma.complaintCase.count({ where: { status: "RESOLVED" } }),
    prisma.complaintCase.count({ where: { status: "REJECTED" } }),
    prisma.complaintCase.count({ where: { severity: "CRITICAL" } }),
  ]);
  return { total, open, investigating, actioned, resolved, rejected, critical };
}

/** Resolve producerOrgId from entityType + entityId when creating a case (CODE/BATCH/PRODUCT). */
async function resolveProducerOrgIdFromEntity(
  prisma: PrismaClient,
  entityType: string,
  entityId: string
): Promise<number | null> {
  const idNum = toInt(entityId);
  if (entityType === "CODE" && entityId) {
    const trace = await traceByCode(prisma, entityId);
    return trace?.producerOrg?.id ?? null;
  }
  if (entityType === "BATCH" && idNum != null) {
    const batch = await prisma.authBatch.findUnique({
      where: { id: idNum },
      select: { authProduct: { select: { producerOrgId: true } } },
    });
    return batch?.authProduct?.producerOrgId ?? null;
  }
  if (entityType === "PRODUCT" && idNum != null) {
    const product = await prisma.authProduct.findUnique({
      where: { id: idNum },
      select: { producerOrgId: true },
    });
    return product?.producerOrgId ?? null;
  }
  if (entityType === "ORG" && idNum != null) {
    const org = await prisma.producerOrg.findUnique({
      where: { id: idNum },
      select: { id: true },
    });
    return org?.id ?? null;
  }
  return null;
}

export async function createCase(
  prisma: PrismaClient,
  params: {
    source?: string;
    entityType: string;
    entityId: string;
    producerOrgId?: number | null;
    severity?: string;
    summary: string;
    details?: string | null;
    createdByUserId: number;
  }
) {
  if (!params.summary || params.summary.trim().length < 3) {
    const err = new Error("summary required (min 3 characters)") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }
  if (!SOURCES.includes((params.source ?? "ADMIN") as CaseSource)) params.source = "ADMIN";
  if (!ENTITY_TYPES.includes(params.entityType as CaseEntityType)) {
    const err = new Error("entityType must be CODE | BATCH | PRODUCT | ORG") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }
  let producerOrgId = params.producerOrgId != null && params.producerOrgId > 0 ? params.producerOrgId : null;
  if (producerOrgId == null && params.entityType && params.entityId) {
    producerOrgId = await resolveProducerOrgIdFromEntity(prisma, params.entityType, String(params.entityId));
  }
  if (producerOrgId == null) {
    const err = new Error("producerOrgId required or could not be resolved from entityType/entityId") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }
  const caseNo = await nextCaseNo(prisma);
  const severity = params.severity && SEVERITIES.includes(params.severity as Severity) ? params.severity : "MEDIUM";
  const c = await prisma.complaintCase.create({
    data: {
      caseNo,
      source: params.source ?? "ADMIN",
      entityType: params.entityType,
      entityId: String(params.entityId),
      producerOrgId,
      severity,
      summary: params.summary.trim().slice(0, 256),
      details: params.details?.trim() || null,
      createdByUserId: params.createdByUserId,
    },
    include: { producerOrg: { select: { id: true, name: true } } },
  });
  return c;
}

export async function getCaseById(prisma: PrismaClient, caseId: number) {
  const c = await prisma.complaintCase.findUnique({
    where: { id: caseId },
    include: {
      producerOrg: { select: { id: true, name: true, status: true } },
      evidence: true,
      actions: { orderBy: { appliedAt: "desc" } },
    },
  });
  return c;
}

export async function updateCase(
  prisma: PrismaClient,
  caseId: number,
  params: { status?: string; assignedToUserId?: number | null; severity?: string; resolutionNote?: string | null; resolvedByUserId?: number | null }
) {
  const data: Record<string, unknown> = {};
  if (params.status && CASE_STATUSES.includes(params.status as CaseStatus)) data.status = params.status;
  if (params.assignedToUserId !== undefined) data.assignedToUserId = params.assignedToUserId;
  if (params.severity && SEVERITIES.includes(params.severity as Severity)) data.severity = params.severity;
  if (params.resolutionNote !== undefined) data.resolutionNote = params.resolutionNote;
  if (params.status === "RESOLVED" || params.status === "REJECTED") {
    data.resolvedAt = new Date();
    if (params.resolvedByUserId !== undefined) data.resolvedByUserId = params.resolvedByUserId;
  }
  if (Object.keys(data).length === 0) {
    const existing = await prisma.complaintCase.findUnique({ where: { id: caseId } });
    return existing;
  }
  return prisma.complaintCase.update({
    where: { id: caseId },
    data,
    include: { producerOrg: { select: { id: true, name: true } } },
  });
}

export async function addEvidence(
  prisma: PrismaClient,
  caseId: number,
  params: { type: string; url?: string | null; note?: string | null; createdByUserId: number }
) {
  if (!EVIDENCE_TYPES.includes(params.type as EvidenceType)) {
    const err = new Error("type must be TEXT | IMAGE | VIDEO | DOC | URL") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }
  const caseExists = await prisma.complaintCase.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!caseExists) {
    const err = new Error("Case not found") as Error & { statusCode?: number; code?: string };
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  return prisma.caseEvidence.create({
    data: {
      caseId,
      type: params.type,
      url: params.url?.trim() || null,
      note: params.note?.trim() || null,
      createdByUserId: params.createdByUserId,
    },
  });
}

/** Trace by code string: lookup AuthCode by hash -> batch -> product -> producerOrg */
export async function traceByCode(prisma: PrismaClient, publicCode: string) {
  const codeStr = String(publicCode || "").trim();
  if (!codeStr) return null;
  const codeHash = hmacHash(codeStr);
  const code = await prisma.authCode.findUnique({
    where: { codeHash },
    include: {
      batch: {
        include: {
          authProduct: {
            include: { producerOrg: { select: { id: true, name: true, status: true } } },
          },
        },
      },
    },
  });
  if (!code) return null;
  return {
    code: {
      id: code.id,
      status: code.status,
      codeHash: code.codeHash.slice(0, 12) + "...",
    },
    batch: code.batch
      ? {
          id: code.batch.id,
          batchNo: code.batch.batchNo,
          status: code.batch.status,
          frozenAt: code.batch.frozenAt,
          quarantinedAt: (code.batch as { quarantinedAt?: Date | null }).quarantinedAt ?? null,
        }
      : null,
    product: code.batch?.authProduct
      ? {
          id: code.batch.authProduct.id,
          productName: code.batch.authProduct.productName,
          sku: code.batch.authProduct.sku,
          status: code.batch.authProduct.status,
        }
      : null,
    producerOrg: code.batch?.authProduct?.producerOrg ?? null,
  };
}

/** Resolve entity from case entityType/entityId to batch/product/org for trace display */
export async function getCaseTrace(prisma: PrismaClient, c: { entityType: string; entityId: string; producerOrgId: number }) {
  const entityId = toInt(c.entityId);
  if (c.entityType === "CODE" && c.entityId) {
    const trace = await traceByCode(prisma, c.entityId);
    return trace;
  }
  if (c.entityType === "BATCH" && entityId != null) {
    const batch = await prisma.authBatch.findUnique({
      where: { id: entityId },
      include: {
        authProduct: {
          include: { producerOrg: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!batch || batch.authProduct?.producerOrgId !== c.producerOrgId) return null;
    return {
      code: null,
      batch: {
        id: batch.id,
        batchNo: batch.batchNo,
        status: batch.status,
        frozenAt: batch.frozenAt,
        quarantinedAt: (batch as { quarantinedAt?: Date | null }).quarantinedAt ?? null,
      },
      product: batch.authProduct
        ? { id: batch.authProduct.id, productName: batch.authProduct.productName, sku: batch.authProduct.sku, status: batch.authProduct.status }
        : null,
      producerOrg: batch.authProduct?.producerOrg ?? null,
    };
  }
  if (c.entityType === "PRODUCT" && entityId != null) {
    const product = await prisma.authProduct.findUnique({
      where: { id: entityId },
      include: { producerOrg: { select: { id: true, name: true, status: true } } },
    });
    if (!product || product.producerOrgId !== c.producerOrgId) return null;
    return {
      code: null,
      batch: null,
      product: { id: product.id, productName: product.productName, sku: product.sku, status: product.status },
      producerOrg: product.producerOrg ?? null,
    };
  }
  if (c.entityType === "ORG") {
    const org = await prisma.producerOrg.findUnique({
      where: { id: c.producerOrgId },
      select: { id: true, name: true, status: true },
    });
    if (!org) return null;
    return { code: null, batch: null, product: null, producerOrg: org };
  }
  return null;
}

export async function applyAction(
  prisma: PrismaClient,
  params: {
    caseId: number;
    targetType: string;
    targetId: string;
    actionType: string;
    reason: string;
    meta?: Record<string, unknown> | null;
    appliedByUserId: number;
    actorRole?: string;
    traceId?: string | null;
    ip?: string | null;
  }
) {
  const { caseId, targetType, targetId, actionType, reason, appliedByUserId } = params;
  if (!reason || reason.trim().length < 5) {
    const err = new Error("reason required (min 5 characters)") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "REASON_REQUIRED";
    throw err;
  }
  const complaintCase = await prisma.complaintCase.findUnique({
    where: { id: caseId },
    include: { producerOrg: { select: { id: true } } },
  });
  if (!complaintCase) {
    const err = new Error("Case not found") as Error & { statusCode?: number; code?: string };
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const producerOrgId = complaintCase.producerOrgId;
  const targetIdNum = toInt(targetId);

  const action = await prisma.$transaction(async (tx) => {
    switch (actionType) {
      case "CODE_BLOCKED":
      case "CODE_REVOKED": {
        if (targetType === "CODE") {
          const codeHash = hmacHash(targetId);
          const code = await tx.authCode.findUnique({ where: { codeHash }, select: { id: true } });
          if (code) {
            await tx.authCode.update({ where: { id: code.id }, data: { status: "BLOCKED" } });
          }
        } else if (targetType === "BATCH" && targetIdNum != null) {
          await tx.authCode.updateMany({ where: { batchId: targetIdNum }, data: { status: "BLOCKED" } });
        }
        break;
      }
      case "BATCH_QUARANTINED": {
        if (targetIdNum == null) throw new Error("Invalid batch id");
        await tx.authBatch.update({
          where: { id: targetIdNum },
          data: { quarantinedAt: new Date() },
        });
        break;
      }
      case "BATCH_FROZEN": {
        if (targetIdNum == null) throw new Error("Invalid batch id");
        await tx.authBatch.update({
          where: { id: targetIdNum },
          data: { frozenAt: new Date() },
        });
        break;
      }
      case "PRODUCT_DEACTIVATED": {
        if (targetIdNum == null) throw new Error("Invalid product id");
        await tx.authProduct.update({
          where: { id: targetIdNum },
          data: { status: "INACTIVE" },
        });
        break;
      }
      case "PRODUCT_RESET_UNAPPROVED": {
        if (targetIdNum == null) throw new Error("Invalid product id");
        await tx.authProduct.update({
          where: { id: targetIdNum },
          data: { status: "DRAFT" },
        });
        break;
      }
      case "ORG_SUSPENDED":
      case "ORG_KYC_REVERIFY":
      case "ORG_BAN": {
        if (targetIdNum == null) throw new Error("Invalid org id");
        await tx.producerOrg.update({
          where: { id: targetIdNum },
          data: { status: "SUSPENDED" },
        });
        break;
      }
      default:
        break;
    }

    const actionRecord = await tx.enforcementAction.create({
      data: {
        caseId,
        targetType,
        targetId: String(targetId),
        actionType,
        reason: reason.trim(),
        meta: params.meta ?? undefined,
        status: "APPLIED",
        appliedByUserId,
      },
    });

    await tx.governanceIncident.create({
      data: {
        entityType: targetType === "ORG" ? "PRODUCER_ORG" : targetType === "BATCH" ? "BATCH" : targetType === "PRODUCT" ? "PRODUCT" : "AUTH_CODE",
        entityId: targetIdNum ?? 0,
        producerOrgId,
        incidentType: "POLICY_VIOLATION",
        severity: "HIGH",
        actionTaken: actionType,
        reason: reason.trim(),
        ticketId: complaintCase.caseNo,
        createdByUserId: appliedByUserId,
      },
    });

    await tx.complaintCase.update({
      where: { id: caseId },
      data: { status: "ACTIONED" },
    });

    return actionRecord;
  });

  await auditGov.createAuditEvent(prisma, {
    actorUserId: appliedByUserId,
    actorRole: params.actorRole ?? "platform.admin",
    actionKey: "admin.enforcement.action.apply",
    entityType: "ENFORCEMENT_ACTION",
    entityId: String(action.id),
    orgId: producerOrgId,
    metadata: { caseId, caseNo: complaintCase.caseNo, actionType, targetType, targetId },
    traceId: params.traceId ?? undefined,
    ip: params.ip ?? undefined,
  });

  notifyProducerOrgEnforcement(prisma, producerOrgId, "APPLIED", { actionType, caseNo: complaintCase.caseNo, targetType, targetId }).catch((err: unknown) =>
    console.warn("[enforcement] notifyProducerOrgEnforcement apply:", (err as Error)?.message)
  );

  return prisma.enforcementAction.findUnique({
    where: { id: action.id },
    include: { case: { select: { caseNo: true } } },
  });
}

export async function revertAction(
  prisma: PrismaClient,
  actionId: number,
  params: {
    revertedByUserId: number;
    revertNote: string;
    actorRole?: string;
    traceId?: string | null;
    ip?: string | null;
  }
) {
  const action = await prisma.enforcementAction.findUnique({
    where: { id: actionId },
    include: { case: { select: { id: true, caseNo: true, producerOrgId: true } } },
  });
  if (!action || action.status !== "APPLIED") {
    const err = new Error("Action not found or already reverted") as Error & { statusCode?: number; code?: string };
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!params.revertNote || params.revertNote.trim().length < 5) {
    const err = new Error("revertNote required (min 5 characters)") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "REVERT_NOTE_REQUIRED";
    throw err;
  }
  const targetIdNum = toInt(action.targetId);
  const producerOrgId = action.case.producerOrgId;

  await prisma.$transaction(async (tx) => {
    switch (action.actionType) {
      case "CODE_BLOCKED":
      case "CODE_REVOKED":
        if (action.targetType === "BATCH" && targetIdNum != null) {
          await tx.authCode.updateMany({
            where: { batchId: targetIdNum },
            data: { status: "UNUSED" },
          });
        }
        break;
      case "BATCH_QUARANTINED":
        if (targetIdNum != null) {
          await tx.authBatch.update({
            where: { id: targetIdNum },
            data: { quarantinedAt: null },
          });
        }
        break;
      case "BATCH_FROZEN":
        if (targetIdNum != null) {
          await tx.authBatch.update({
            where: { id: targetIdNum },
            data: { frozenAt: null },
          });
        }
        break;
      case "PRODUCT_DEACTIVATED":
        if (targetIdNum != null) {
          await tx.authProduct.update({
            where: { id: targetIdNum },
            data: { status: "ACTIVE" },
          });
        }
        break;
      case "PRODUCT_RESET_UNAPPROVED":
        // Revert = set back to APPROVED or ACTIVE as appropriate; simplest is ACTIVE
        if (targetIdNum != null) {
          await tx.authProduct.update({
            where: { id: targetIdNum },
            data: { status: "ACTIVE" },
          });
        }
        break;
      case "ORG_SUSPENDED":
      case "ORG_KYC_REVERIFY":
      case "ORG_BAN":
        if (targetIdNum != null) {
          await tx.producerOrg.update({
            where: { id: targetIdNum },
            data: { status: "VERIFIED" },
          });
        }
        break;
      default:
        break;
    }

    await tx.enforcementAction.update({
      where: { id: actionId },
      data: {
        status: "REVERTED",
        revertedByUserId: params.revertedByUserId,
        revertedAt: new Date(),
        revertNote: params.revertNote.trim(),
      },
    });
  });

  await auditGov.createAuditEvent(prisma, {
    actorUserId: params.revertedByUserId,
    actorRole: params.actorRole ?? "platform.admin",
    actionKey: "admin.enforcement.action.revert",
    entityType: "ENFORCEMENT_ACTION",
    entityId: String(actionId),
    orgId: producerOrgId,
    metadata: { caseNo: action.case.caseNo, actionType: action.actionType, revertNote: params.revertNote.trim() },
    traceId: params.traceId ?? undefined,
    ip: params.ip ?? undefined,
  });

  notifyProducerOrgEnforcement(prisma, producerOrgId, "REVERTED", { actionType: action.actionType, caseNo: action.case.caseNo }).catch((err: unknown) =>
    console.warn("[enforcement] notifyProducerOrgEnforcement revert:", (err as Error)?.message)
  );

  return prisma.enforcementAction.findUnique({
    where: { id: actionId },
    include: { case: { select: { caseNo: true } } },
  });
}
