/**
 * Injection Token Service
 * Anti-fraud gate between billing and dose administration.
 */
import crypto from "crypto";
import prisma from "../../../../infrastructure/db/prismaClient";
import type { InjectionTokenStatus, MedicineSource } from "@prisma/client";
import * as branchPolicyService from "../../services/branchPolicy.service";

type TxClient = any;

export type GenerateTokenInput = {
  branchId: number;
  visitId: number;
  variantId: number;
  expectedDose: number;
  generatedByUserId: number;
  prescriptionId?: number | null;
  orderId?: number | null;
  patientId?: number | null;
  petId?: number | null;
  unit?: string | null;
  medicineSource?: MedicineSource;
  expiresInHours?: number;
  treatmentCourseId?: number | null;
  treatmentDayId?: number | null;
  selectedVialSessionId?: number | null; // pre-assigned vial from billing screen
};

export type ListTokenOptions = {
  status?: InjectionTokenStatus;
  visitId?: number;
  patientId?: number;
  tokenCode?: string;
  fromDate?: Date;
  toDate?: Date;
  skip?: number;
  take?: number;
  /** Filter by user who validated the token (operator accountability). */
  validatedByUserId?: number | null;
  /** Filter by user who generated the token (operator accountability). */
  generatedByUserId?: number | null;
};

function makeTokenCode(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `ITK${stamp}${rand}`.slice(0, 32);
}

async function generateUniqueTokenCode(tx: TxClient): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const code = makeTokenCode();
    const exists = await (tx as TxClient).injectionToken.findUnique({
      where: { tokenCode: code },
      select: { id: true },
    });
    if (!exists) return code;
  }
  throw new Error("Failed to generate unique token code");
}

export async function generateToken(input: GenerateTokenInput): Promise<any> {
  if (!input.branchId || !input.visitId || !input.variantId || input.expectedDose == null) {
    throw new Error("branchId, visitId, variantId, and expectedDose are required");
  }

  return prisma.$transaction(async (tx) => {
    const visit = await (tx as TxClient).visit.findFirst({
      where: { id: input.visitId, branchId: input.branchId },
      select: { id: true, patientId: true, petId: true },
    });
    if (!visit) throw new Error("Visit not found in this branch");

    const variant = await (tx as TxClient).productVariant.findUnique({
      where: { id: input.variantId },
      select: { id: true },
    });
    if (!variant) throw new Error("Medicine variant not found");

    let order = null as any;
    if (input.orderId != null) {
      order = await (tx as TxClient).order.findFirst({
        where: { id: input.orderId, branchId: input.branchId, visitId: input.visitId },
        select: { id: true, paymentStatus: true },
      });
    } else {
      order = await (tx as TxClient).order.findFirst({
        where: {
          branchId: input.branchId,
          visitId: input.visitId,
          paymentStatus: "COMPLETED",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, paymentStatus: true },
      });
    }

    if (!order) throw new Error("Paid order is required before generating injection token");
    if (order.paymentStatus !== "COMPLETED") throw new Error("Order payment is not completed");

    if (input.prescriptionId != null) {
      const prescription = await (tx as TxClient).prescription.findFirst({
        where: { id: input.prescriptionId, visitId: input.visitId },
        select: { id: true },
      });
      if (!prescription) throw new Error("Prescription does not belong to this visit");
    }

    const tokenCode = await generateUniqueTokenCode(tx);
    const expiresAt = new Date();
    const policy = await branchPolicyService.getBranchPolicy(input.branchId);
    const custom = (policy as any).customPoliciesJson as Record<string, unknown> | undefined;
    const tokenValiditySameDayOnly = custom?.tokenValiditySameDayOnly === true;
    if (tokenValiditySameDayOnly) {
      expiresAt.setHours(23, 59, 59, 999);
    } else {
      expiresAt.setHours(expiresAt.getHours() + (input.expiresInHours ?? 24));
    }

    return (tx as TxClient).injectionToken.create({
      data: {
        tokenCode,
        branchId: input.branchId,
        visitId: input.visitId,
        prescriptionId: input.prescriptionId ?? null,
        orderId: order.id,
        patientId: input.patientId ?? visit.patientId,
        petId: input.petId ?? visit.petId,
        variantId: input.variantId,
        treatmentCourseId: input.treatmentCourseId ?? null,
        treatmentDayId: input.treatmentDayId ?? null,
        selectedVialSessionId: input.selectedVialSessionId ?? null,
        expectedDose: input.expectedDose,
        unit: input.unit ?? null,
        medicineSource: input.medicineSource ?? "INTERNAL",
        status: "PENDING",
        generatedByUserId: input.generatedByUserId,
        expiresAt,
      },
      include: {
        variant: { select: { id: true, title: true, sku: true } },
        visit: { select: { id: true, treatmentCode: true } },
        order: { select: { id: true, orderNumber: true, paymentStatus: true } },
        treatmentCourse: { select: { id: true, durationDays: true, status: true } },
        treatmentDay: { select: { id: true, dayNumber: true, scheduledDate: true } },
        selectedVialSession: { select: { id: true, remainingQty: true, validUntil: true } },
      },
    });
  });
}

/** Get token with full treatment context for injection room UI and detail drawer (includes audit fields). */
export async function getTokenWithTreatmentContext(tokenId: number, branchId: number): Promise<any> {
  return prisma.injectionToken.findFirst({
    where: { id: tokenId, branchId },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      visit: { select: { id: true, treatmentCode: true } },
      order: { select: { id: true, orderNumber: true, paymentStatus: true } },
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      pet: { select: { id: true, name: true } },
      treatmentCourse: { select: { id: true, durationDays: true, status: true } },
      treatmentDay: { select: { id: true, dayNumber: true, scheduledDate: true, status: true } },
      selectedVialSession: {
        select: {
          id: true,
          remainingQty: true,
          validUntil: true,
          status: true,
          roomId: true,
          variant: { select: { id: true, title: true } },
          room: { select: { id: true, name: true, code: true } },
        },
      },
      generatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      usedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      cancelledBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

export async function validateToken(
  tokenCode: string,
  branchId: number,
  validatedByUserId?: number | null
): Promise<{ valid: boolean; reason?: string; token?: any; alreadyValidated?: boolean }> {
  if (!tokenCode || !branchId) return { valid: false, reason: "tokenCode and branchId are required" };

  let token = await prisma.injectionToken.findFirst({
    where: { tokenCode, branchId },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      visit: { select: { id: true, treatmentCode: true } },
      order: { select: { id: true, paymentStatus: true } },
      validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  if (!token) return { valid: false, reason: "Token not found" };

  if (token.expiresAt && token.expiresAt < new Date() && token.status === "PENDING") {
    await prisma.injectionToken.update({
      where: { id: token.id },
      data: { status: "EXPIRED" },
    });
    return { valid: false, reason: "Token expired" };
  }

  if (token.status !== "PENDING") {
    return { valid: false, reason: `Token is ${token.status}` };
  }

  if (token.order && token.order.paymentStatus !== "COMPLETED") {
    return { valid: false, reason: "Linked order payment is incomplete" };
  }

  const alreadyValidated = token.validatedAt != null;
  if (!alreadyValidated && validatedByUserId != null) {
    token = await prisma.injectionToken.update({
      where: { id: token.id },
      data: {
        validatedByUserId,
        validatedAt: new Date(),
      },
      include: {
        variant: { select: { id: true, title: true, sku: true } },
        visit: { select: { id: true, treatmentCode: true } },
        order: { select: { id: true, paymentStatus: true } },
        validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    });
  }

  return { valid: true, token, alreadyValidated: alreadyValidated || undefined };
}

export async function getUsableTokenById(
  tokenId: number,
  branchId: number,
  opts?: { tx?: TxClient; expectedVariantId?: number; expectedVisitId?: number }
): Promise<any> {
  const tx = opts?.tx ?? prisma;
  const token = await (tx as TxClient).injectionToken.findFirst({
    where: { id: tokenId, branchId },
  });
  if (!token) throw new Error("Injection token not found");

  if (token.expiresAt && token.expiresAt < new Date() && token.status === "PENDING") {
    await (tx as TxClient).injectionToken.update({
      where: { id: token.id },
      data: { status: "EXPIRED" },
    });
    throw new Error("Injection token expired");
  }

  if (token.status !== "PENDING") {
    throw new Error(`Injection token is ${token.status}`);
  }

  if (opts?.expectedVariantId != null && token.variantId !== opts.expectedVariantId) {
    throw new Error("Injection token is for a different medicine");
  }

  if (opts?.expectedVisitId != null && token.visitId !== opts.expectedVisitId) {
    throw new Error("Injection token is for a different visit");
  }

  return token;
}

export async function consumeToken(
  tokenId: number,
  usedByUserId?: number | null,
  opts?: { tx?: TxClient; expectedVariantId?: number; expectedVisitId?: number }
): Promise<any> {
  const tx = opts?.tx ?? prisma;
  const tokenBase = await (tx as TxClient).injectionToken.findUnique({
    where: { id: tokenId },
    select: { branchId: true },
  });
  if (!tokenBase) throw new Error("Injection token not found");

  const token = await getUsableTokenById(tokenId, tokenBase.branchId, {
    tx,
    expectedVariantId: opts?.expectedVariantId,
    expectedVisitId: opts?.expectedVisitId,
  });

  return (tx as TxClient).injectionToken.update({
    where: { id: token.id },
    data: {
      status: "USED",
      usedByUserId: usedByUserId ?? null,
      usedAt: new Date(),
    },
  });
}

export async function cancelToken(
  tokenId: number,
  branchId: number,
  cancelledByUserId?: number,
  cancelReason?: string | null
): Promise<any> {
  const token = await prisma.injectionToken.findFirst({
    where: { id: tokenId, branchId },
  });
  if (!token) throw new Error("Injection token not found");
  if (token.status !== "PENDING") throw new Error("Only pending tokens can be cancelled");

  return prisma.injectionToken.update({
    where: { id: tokenId },
    data: {
      status: "CANCELLED",
      cancelledByUserId: cancelledByUserId ?? null,
      cancelledAt: new Date(),
      cancelReason: cancelReason ?? null,
    },
  });
}

export async function listTokens(branchId: number, opts?: ListTokenOptions): Promise<{ list: any[]; total: number }> {
  const where: any = { branchId };
  if (opts?.status) where.status = opts.status;
  if (opts?.visitId != null) where.visitId = opts.visitId;
  if (opts?.patientId != null) where.patientId = opts.patientId;
  if (opts?.tokenCode) where.tokenCode = { contains: opts.tokenCode, mode: "insensitive" };
  if (opts?.validatedByUserId != null) where.validatedByUserId = opts.validatedByUserId;
  if (opts?.generatedByUserId != null) where.generatedByUserId = opts.generatedByUserId;
  if (opts?.fromDate || opts?.toDate) {
    where.createdAt = {};
    if (opts?.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts?.toDate) where.createdAt.lte = opts.toDate;
  }

  const [list, total] = await Promise.all([
    prisma.injectionToken.findMany({
      where,
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 50, 100),
      include: {
        variant: { select: { id: true, title: true, sku: true } },
        visit: { select: { id: true, treatmentCode: true } },
        patient: { select: { id: true } },
        validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        generatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.injectionToken.count({ where }),
  ]);

  return { list, total };
}

export async function expireStaleTokens(hours = 24): Promise<number> {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);

  const result = await prisma.injectionToken.updateMany({
    where: {
      status: "PENDING",
      OR: [
        { expiresAt: { lt: now } },
        { expiresAt: null, createdAt: { lt: cutoff } },
      ],
    },
    data: { status: "EXPIRED" },
  });

  return result.count;
}
