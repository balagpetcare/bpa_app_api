/**
 * Injection Token Service
 * Anti-fraud gate between billing and dose administration.
 */
import crypto from "crypto";
import prisma from "../../../../infrastructure/db/prismaClient";
import type { InjectionEncounterKind, InjectionTokenStatus, MedicineSource } from "@prisma/client";
import * as branchPolicyService from "../../services/branchPolicy.service";
import { normalizeMedicineSourceInput } from "./medicineSource.util";
import { computeInjectionLifecycleLabel } from "./injectionTokenLifecycle.util";

type TxClient = any;

/** Optional walk-in: creates a lightweight visit (no appointment) before billing. Doctor optional for outside-Rx-only administration. */
export type InjectionWalkInInput = {
  patientId: number;
  petId: number;
  /** When omitted, visit is created with no assigned doctor (injection / outside prescription path). */
  doctorBranchMemberId?: number | null;
};

/** One row in billing checkout for clinic-stock medicine (maps to OrderItem). */
export type BillingMedicineLineInput = {
  variantId: number;
  quantity?: number | null;
  unitPrice: number;
};

/**
 * Creates real Order + OrderItem rows (and optional COMPLETED payment) before token creation.
 * Use for injection-only / walk-in flows or to attach lines to an existing visit in one step.
 */
export type BillingCheckoutInput = {
  walkIn?: InjectionWalkInInput;
  injectionServiceId?: number | null;
  servicePrice?: number | null;
  medicineVariantId?: number | null;
  medicineQuantity?: number | null;
  medicineUnitPrice?: number | null;
  /** When set, adds multiple clinic medicine order lines (outside medicine must not appear here). */
  medicineLineBillings?: BillingMedicineLineInput[] | null;
  consumablesServiceId?: number | null;
  consumablesPrice?: number | null;
  paymentMethod?: string | null;
  /** Required when line total > 0 — records payment as COMPLETED on the new order. */
  markPaid: boolean;
  notes?: string | null;
};

/** API / service-normalized medication administration line (persisted on injection_token_medication_lines). */
export type MedicationLineInput = {
  medicineSource: MedicineSource;
  variantId: number | null;
  manualMedicineName: string | null;
  manualStrength: string | null;
  manualBatch: string | null;
  manualManufacturer: string | null;
  route: string;
  expectedDose: number;
  unit: string | null;
  durationText: string | null;
  frequencyText: string | null;
  longevityNote: string | null;
  lineNote: string | null;
  selectedVialSessionId: number | null;
  medicineFeeSnapshot: number | null;
};

export type GenerateTokenInput = {
  branchId: number;
  /** Required unless billingCheckout.walkIn creates the visit. */
  visitId?: number | null;
  /** Legacy single medicine; ignored when medicationLines is non-empty. */
  variantId?: number | null;
  expectedDose?: number | null;
  /** Multi-medicine intake (preferred). When empty, variantId + expectedDose are used to synthesize one line. */
  medicationLines?: Partial<MedicationLineInput>[] | null;
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
  encounterKind?: InjectionEncounterKind;
  externalPrescriberName?: string | null;
  externalPrescriberClinic?: string | null;
  externalRxNotes?: string | null;
  externalRxEvidenceUrl?: string | null;
  serviceChargeAmount?: number | null;
  medicineChargeAmount?: number | null;
  consumablesChargeAmount?: number | null;
  billingCheckout?: BillingCheckoutInput | null;
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
  medicineSource?: MedicineSource;
  encounterKind?: InjectionEncounterKind;
  /** Filter by user who validated the token (operator accountability). */
  validatedByUserId?: number | null;
  /** Filter by user who generated the token (operator accountability). */
  generatedByUserId?: number | null;
};

function normalizeEncounterKindInput(raw: unknown): InjectionEncounterKind {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  if (s === "EXTERNAL_WALK_IN") return "EXTERNAL_WALK_IN";
  return "INTERNAL_VISIT";
}

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function aggregateMedicineSourceFromLines(lines: MedicationLineInput[]): MedicineSource {
  if (lines.length === 0) return "INTERNAL_CLINIC";
  const set = new Set(lines.map((l) => l.medicineSource));
  if (set.size === 1) return lines[0].medicineSource;
  const allOutside = lines.every((l) => l.medicineSource === "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT");
  if (allOutside) return "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT";
  return "INTERNAL_CLINIC";
}

/**
 * Normalize legacy single-medicine payload or multi-line payload into validated MedicationLineInput[].
 */
function normalizeMedicationLinesInput(input: GenerateTokenInput): MedicationLineInput[] {
  const raw = input.medicationLines;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((row, idx) => {
      const src = normalizeMedicineSourceInput((row as any).medicineSource, "INTERNAL_CLINIC");
      const route = trimOrNull((row as any).route) ?? "SQ";
      const dose = Number((row as any).expectedDose);
      if (!Number.isFinite(dose) || dose <= 0) {
        throw new Error(`medicationLines[${idx}]: expectedDose must be a positive number`);
      }
      const isOutside = src === "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT";
      const variantId = (row as any).variantId != null ? Number((row as any).variantId) : null;
      const manualName = trimOrNull((row as any).manualMedicineName);
      if (!isOutside) {
        if (variantId == null || variantId <= 0) {
          throw new Error(`medicationLines[${idx}]: variantId is required for clinic medicine lines`);
        }
      } else {
        if (!manualName) {
          throw new Error(`medicationLines[${idx}]: manualMedicineName is required for patient-brought lines`);
        }
      }
      const feeRaw = (row as any).medicineFeeSnapshot;
      const billPrice = (row as any).billingUnitPrice;
      const medicineFeeSnapshot =
        feeRaw != null && Number.isFinite(Number(feeRaw)) && Number(feeRaw) >= 0
          ? Number(feeRaw)
          : billPrice != null && Number.isFinite(Number(billPrice)) && Number(billPrice) >= 0
            ? Number(billPrice)
            : null;
      const vialRaw = (row as any).selectedVialSessionId;
      const selectedVialSessionId =
        vialRaw != null && vialRaw !== "" && Number.isFinite(Number(vialRaw)) ? Number(vialRaw) : null;
      return {
        medicineSource: src,
        variantId: isOutside ? null : variantId,
        manualMedicineName: isOutside ? manualName : null,
        manualStrength: trimOrNull((row as any).manualStrength),
        manualBatch: trimOrNull((row as any).manualBatch),
        manualManufacturer: trimOrNull((row as any).manualManufacturer),
        route,
        expectedDose: dose,
        unit: trimOrNull((row as any).unit) ?? input.unit ?? "ml",
        durationText: trimOrNull((row as any).durationText),
        frequencyText: trimOrNull((row as any).frequencyText),
        longevityNote: trimOrNull((row as any).longevityNote),
        lineNote: trimOrNull((row as any).lineNote),
        selectedVialSessionId,
        medicineFeeSnapshot,
      };
    });
  }

  const vIdRaw = input.variantId != null ? Number(input.variantId) : NaN;
  const dose = input.expectedDose != null ? Number(input.expectedDose) : NaN;
  if (!Number.isFinite(dose) || dose <= 0) {
    throw new Error("Provide medicationLines (at least one row) or legacy variantId + expectedDose");
  }
  const src = normalizeMedicineSourceInput(input.medicineSource, "INTERNAL_CLINIC");
  const isOutside = src === "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT";
  const vId = Number.isFinite(vIdRaw) && vIdRaw > 0 ? vIdRaw : null;
  if (!isOutside && (vId == null || vId <= 0)) {
    throw new Error("Provide medicationLines (at least one row) or legacy variantId + expectedDose");
  }
  const vialRaw = input.selectedVialSessionId;
  const selectedVialSessionId =
    vialRaw != null && Number.isFinite(Number(vialRaw)) && Number(vialRaw) > 0 ? Number(vialRaw) : null;
  return [
    {
      medicineSource: src,
      variantId: isOutside ? null : vId,
      manualMedicineName: null,
      manualStrength: null,
      manualBatch: null,
      manualManufacturer: null,
      route: "SQ",
      expectedDose: dose,
      unit: trimOrNull(input.unit) ?? "ml",
      durationText: null,
      frequencyText: null,
      longevityNote: null,
      lineNote: null,
      selectedVialSessionId,
      medicineFeeSnapshot: null,
    },
  ];
}

function attachLifecycle<T extends { status: InjectionTokenStatus; validatedAt: Date | null; usedAt?: Date | null }>(
  row: T
): T & { lifecycleLabel: string } {
  return { ...row, lifecycleLabel: computeInjectionLifecycleLabel(row) };
}

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

function makeOrderNumber(): string {
  const prefix = "BPA";
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

async function generateNextTreatmentCodeTx(tx: TxClient, branchId: number): Promise<string> {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const prefix = `TRT-${yyyy}${mm}${dd}-`;
  const existing = await (tx as TxClient).visit.findMany({
    where: { branchId, treatmentCode: { startsWith: prefix } },
    select: { treatmentCode: true },
    orderBy: { id: "desc" },
    take: 1,
  });
  let seq = 1;
  if (existing.length > 0 && existing[0].treatmentCode) {
    const tail = String(existing[0].treatmentCode).replace(prefix, "");
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

type BuiltLine = {
  productId: number | null;
  variantId: number | null;
  serviceId: number | null;
  quantity: number;
  price: number;
};

async function buildInjectionBillingLines(
  tx: TxClient,
  branchId: number,
  checkout: BillingCheckoutInput,
  medSource: MedicineSource
): Promise<{ lines: BuiltLine[]; serviceSnapshot: number; medicineSnapshot: number; consumablesSnapshot: number }> {
  const lines: BuiltLine[] = [];
  let serviceSnapshot = 0;
  let medicineSnapshot = 0;
  let consumablesSnapshot = 0;

  const svcPrice = Number(checkout.servicePrice ?? 0);
  const svcId = checkout.injectionServiceId;
  if (svcPrice > 0) {
    if (svcId == null) throw new Error("billingCheckout.injectionServiceId is required when servicePrice > 0");
    const svc = await (tx as TxClient).service.findFirst({
      where: { id: svcId, branchId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!svc) throw new Error("Injection service not found or inactive for this branch");
    lines.push({ productId: null, variantId: null, serviceId: svcId, quantity: 1, price: svcPrice });
    serviceSnapshot += svcPrice;
  }

  const multiBill = Array.isArray(checkout.medicineLineBillings) && checkout.medicineLineBillings.length > 0;
  if (multiBill) {
    if (medSource === "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT") {
      throw new Error(
        "Patient-brought-only token cannot include clinic medicine order lines; omit billingCheckout.medicineLineBillings"
      );
    }
    for (const lb of checkout.medicineLineBillings!) {
      const medVar = Number(lb.variantId);
      const medQty = Math.max(1, Math.floor(Number(lb.quantity ?? 1)));
      const medUnit = Number(lb.unitPrice ?? 0);
      if (!Number.isFinite(medVar) || medVar <= 0) throw new Error("billingCheckout.medicineLineBillings: invalid variantId");
      if (!(medUnit > 0)) throw new Error("billingCheckout.medicineLineBillings: unitPrice must be > 0");
      const variantRow = await (tx as TxClient).productVariant.findUnique({
        where: { id: medVar },
        select: { id: true, productId: true },
      });
      if (!variantRow?.productId) throw new Error("Medicine variant not found");
      lines.push({
        productId: variantRow.productId,
        variantId: variantRow.id,
        serviceId: null,
        quantity: medQty,
        price: medUnit,
      });
      medicineSnapshot += medUnit * medQty;
    }
  } else {
    const medQty = Math.max(1, Math.floor(Number(checkout.medicineQuantity ?? 1)));
    const medUnit = Number(checkout.medicineUnitPrice ?? 0);
    const medVar = checkout.medicineVariantId;
    if (medVar != null || medUnit > 0) {
      if (medSource === "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT") {
        throw new Error(
          "Patient-brought outside medicine cannot include clinic medicine order lines; omit billingCheckout medicine fields"
        );
      }
      if (medVar == null) throw new Error("billingCheckout.medicineVariantId is required when billing clinic medicine");
      if (!(medUnit > 0)) throw new Error("billingCheckout.medicineUnitPrice must be > 0 when billing clinic medicine");
      const variantRow = await (tx as TxClient).productVariant.findUnique({
        where: { id: medVar },
        select: { id: true, productId: true },
      });
      if (!variantRow?.productId) throw new Error("Medicine variant not found");
      lines.push({
        productId: variantRow.productId,
        variantId: variantRow.id,
        serviceId: null,
        quantity: medQty,
        price: medUnit,
      });
      medicineSnapshot += medUnit * medQty;
    }
  }

  const consPrice = Number(checkout.consumablesPrice ?? 0);
  const consSvc = checkout.consumablesServiceId;
  if (consPrice > 0) {
    if (consSvc == null) throw new Error("billingCheckout.consumablesServiceId is required when consumablesPrice > 0");
    const svc = await (tx as TxClient).service.findFirst({
      where: { id: consSvc, branchId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!svc) throw new Error("Consumables service not found or inactive for this branch");
    lines.push({ productId: null, variantId: null, serviceId: consSvc, quantity: 1, price: consPrice });
    consumablesSnapshot += consPrice;
  }

  return { lines, serviceSnapshot, medicineSnapshot, consumablesSnapshot };
}

export async function generateToken(input: GenerateTokenInput): Promise<any> {
  if (!input.branchId) {
    throw new Error("branchId is required");
  }
  const medLines = normalizeMedicationLinesInput(input);
  const medSourceAgg = aggregateMedicineSourceFromLines(medLines);
  const legacyVariantId = medLines.find((l) => l.variantId != null)?.variantId ?? null;
  const legacyExpectedDose = medLines[0].expectedDose;
  const legacyUnit = medLines[0].unit;
  const legacyVialFromLines =
    medLines.find((l) => l.selectedVialSessionId != null)?.selectedVialSessionId ?? input.selectedVialSessionId ?? null;

  const hasWalkIn = Boolean(input.billingCheckout?.walkIn);
  const needsVisitId = !hasWalkIn;
  if (needsVisitId && (input.visitId == null || Number(input.visitId) <= 0)) {
    throw new Error("visitId is required unless billingCheckout.walkIn is used to create a visit");
  }
  let settlementOrderId: number | null = null;

  const token = await prisma.$transaction(async (tx) => {
    let visitId = input.visitId != null ? Number(input.visitId) : 0;
    let visitRow: { id: number; patientId: number; petId: number } | null = null;
    let checkoutSnaps = { s: 0, m: 0, c: 0 };
    let createdBillingOrderId: number | null = null;

    const medSourceEarly = medSourceAgg;

    if (input.billingCheckout) {
      const checkout = input.billingCheckout;
      if (checkout.walkIn) {
        const { patientId, petId, doctorBranchMemberId } = checkout.walkIn;
        const branch = await (tx as TxClient).branch.findUnique({
          where: { id: input.branchId },
          select: { orgId: true },
        });
        if (!branch?.orgId) throw new Error("Branch not found");
        const pet = await (tx as TxClient).pet.findFirst({
          where: { id: petId, userId: patientId },
          select: { id: true },
        });
        if (!pet) throw new Error("Pet not found or does not belong to this patient (owner)");
        let doctorId: number | null = null;
        if (doctorBranchMemberId != null && Number(doctorBranchMemberId) > 0) {
          const bm = await (tx as TxClient).branchMember.findFirst({
            where: { id: Number(doctorBranchMemberId), branchId: input.branchId },
            select: { id: true },
          });
          if (!bm) throw new Error("Branch member not found for this branch (use doctor BranchMember id)");
          doctorId = bm.id;
        }
        const treatmentCode = await generateNextTreatmentCodeTx(tx, input.branchId);
        const createdVisit = await (tx as TxClient).visit.create({
          data: {
            orgId: branch.orgId,
            branchId: input.branchId,
            petId,
            patientId,
            doctorId,
            treatmentCode,
            status: "CHECKED_IN",
          },
          select: { id: true, patientId: true, petId: true },
        });
        visitId = createdVisit.id;
        visitRow = createdVisit;
      } else {
        const v = await (tx as TxClient).visit.findFirst({
          where: { id: visitId, branchId: input.branchId },
          select: { id: true, patientId: true, petId: true },
        });
        if (!v) throw new Error("Visit not found in this branch");
        visitRow = v;
      }

      const { lines, serviceSnapshot, medicineSnapshot, consumablesSnapshot } = await buildInjectionBillingLines(
        tx,
        input.branchId,
        checkout,
        medSourceEarly
      );
      checkoutSnaps = { s: serviceSnapshot, m: medicineSnapshot, c: consumablesSnapshot };

      const totalAmount = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
      const markPaid = checkout.markPaid === true;
      if (totalAmount > 0 && !markPaid) {
        throw new Error(
          "billingCheckout: order total > 0 requires markPaid: true after collecting payment (or use clinic billing first)"
        );
      }

      const customerId = checkout.walkIn ? checkout.walkIn.patientId : visitRow!.patientId;
      const orderNumber = makeOrderNumber();
      const paymentMethod = markPaid ? String(checkout.paymentMethod ?? "CASH").slice(0, 64) : null;
      const paymentStatus = totalAmount === 0 || markPaid ? "COMPLETED" : "PENDING";
      const orderStatus = totalAmount === 0 || markPaid ? "CONFIRMED" : "PENDING";

      const baseOrderNote = trimOrNull(checkout.notes) ?? `Injection billing — visit #${visitId}`;
      const orderCreateData: any = {
        orderNumber,
        branchId: input.branchId,
        customerId,
        status: orderStatus,
        totalAmount,
        paymentMethod: markPaid ? paymentMethod : null,
        paymentStatus,
        notes: `${baseOrderNote} [BPA_INJECTION_CHECKOUT:v1]`,
        createdByUserId: input.generatedByUserId,
        orderSource: "CLINIC",
        visitId,
      };
      if (lines.length > 0) {
        orderCreateData.items = {
          create: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            serviceId: l.serviceId,
            quantity: l.quantity,
            price: l.price,
            total: l.price * l.quantity,
          })),
        };
      }

      const newOrder = await (tx as TxClient).order.create({
        data: orderCreateData,
        select: { id: true, paymentStatus: true, totalAmount: true },
      });

      if (totalAmount > 0 && markPaid) {
        settlementOrderId = newOrder.id;
      }

      createdBillingOrderId = newOrder.id;
    }

    if (!visitRow) {
      visitRow = await (tx as TxClient).visit.findFirst({
        where: { id: visitId, branchId: input.branchId },
        select: { id: true, patientId: true, petId: true },
      });
    }
    if (!visitRow) throw new Error("Visit not found in this branch");

    if (legacyVariantId != null) {
      const variant = await (tx as TxClient).productVariant.findUnique({
        where: { id: legacyVariantId },
        select: { id: true },
      });
      if (!variant) throw new Error("Medicine variant not found");
    }

    let order = null as any;
    if (createdBillingOrderId != null) {
      order = await (tx as TxClient).order.findFirst({
        where: { id: createdBillingOrderId, branchId: input.branchId, visitId },
        select: { id: true, paymentStatus: true },
      });
    } else if (input.orderId != null) {
      order = await (tx as TxClient).order.findFirst({
        where: { id: input.orderId, branchId: input.branchId, visitId },
        select: { id: true, paymentStatus: true },
      });
    } else {
      order = await (tx as TxClient).order.findFirst({
        where: {
          branchId: input.branchId,
          visitId,
          paymentStatus: "COMPLETED",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, paymentStatus: true },
      });
    }

    if (!order) {
      throw new Error(
        "Paid order is required before generating injection token. Use clinic billing, or pass billingCheckout to create order lines and markPaid in one request."
      );
    }
    if (order.paymentStatus !== "COMPLETED") throw new Error("Order payment is not completed");

    if (input.prescriptionId != null) {
      const prescription = await (tx as TxClient).prescription.findFirst({
        where: { id: input.prescriptionId, visitId },
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

    const medSource = medSourceAgg;
    let encounterKind = normalizeEncounterKindInput(input.encounterKind);
    if (input.billingCheckout?.walkIn) {
      encounterKind = "EXTERNAL_WALK_IN";
    }

    const lineMedicineFeeSum = medLines.reduce((acc, l) => acc + (l.medicineFeeSnapshot != null ? l.medicineFeeSnapshot : 0), 0);

    const serviceSnap =
      checkoutSnaps.s > 0
        ? checkoutSnaps.s
        : input.serviceChargeAmount != null && Number.isFinite(Number(input.serviceChargeAmount))
          ? Number(input.serviceChargeAmount)
          : null;
    const medicineSnap =
      checkoutSnaps.m > 0
        ? checkoutSnaps.m
        : lineMedicineFeeSum > 0
          ? lineMedicineFeeSum
          : input.medicineChargeAmount != null && Number.isFinite(Number(input.medicineChargeAmount))
            ? Number(input.medicineChargeAmount)
            : null;
    const consumSnap =
      checkoutSnaps.c > 0
        ? checkoutSnaps.c
        : input.consumablesChargeAmount != null && Number.isFinite(Number(input.consumablesChargeAmount))
          ? Number(input.consumablesChargeAmount)
          : null;

    const created = await (tx as TxClient).injectionToken.create({
      data: {
        tokenCode,
        branchId: input.branchId,
        visitId,
        prescriptionId: input.prescriptionId ?? null,
        orderId: order.id,
        patientId: input.patientId ?? visitRow.patientId,
        petId: input.petId ?? visitRow.petId,
        variantId: legacyVariantId,
        treatmentCourseId: input.treatmentCourseId ?? null,
        treatmentDayId: input.treatmentDayId ?? null,
        selectedVialSessionId: legacyVialFromLines,
        expectedDose: legacyExpectedDose,
        unit: legacyUnit,
        medicineSource: medSource,
        encounterKind,
        externalPrescriberName: trimOrNull(input.externalPrescriberName),
        externalPrescriberClinic: trimOrNull(input.externalPrescriberClinic),
        externalRxNotes: trimOrNull(input.externalRxNotes),
        externalRxEvidenceUrl: trimOrNull(input.externalRxEvidenceUrl),
        serviceChargeAmount: serviceSnap,
        medicineChargeAmount: medicineSnap,
        consumablesChargeAmount: consumSnap,
        status: "PENDING",
        generatedByUserId: input.generatedByUserId,
        expiresAt,
      },
      select: { id: true },
    });

    await (tx as TxClient).injectionTokenMedicationLine.createMany({
      data: medLines.map((l, idx) => ({
        injectionTokenId: created.id,
        lineIndex: idx,
        medicineSource: l.medicineSource,
        variantId: l.variantId,
        manualMedicineName: l.manualMedicineName,
        manualStrength: l.manualStrength,
        manualBatch: l.manualBatch,
        manualManufacturer: l.manualManufacturer,
        route: l.route,
        expectedDose: l.expectedDose,
        unit: l.unit,
        durationText: l.durationText,
        frequencyText: l.frequencyText,
        longevityNote: l.longevityNote,
        lineNote: l.lineNote,
        selectedVialSessionId: l.selectedVialSessionId,
        medicineFeeSnapshot: l.medicineFeeSnapshot != null ? l.medicineFeeSnapshot : null,
      })),
    });

    const full = await (tx as TxClient).injectionToken.findFirst({
      where: { id: created.id },
      include: {
        variant: { select: { id: true, title: true, sku: true } },
        visit: { select: { id: true, treatmentCode: true, doctorId: true } },
        order: { select: { id: true, orderNumber: true, paymentStatus: true } },
        treatmentCourse: { select: { id: true, durationDays: true, status: true } },
        treatmentDay: { select: { id: true, dayNumber: true, scheduledDate: true } },
        selectedVialSession: { select: { id: true, remainingQty: true, validUntil: true } },
        medicationLines: {
          orderBy: { lineIndex: "asc" },
          include: {
            variant: { select: { id: true, title: true, sku: true } },
            selectedVialSession: { select: { id: true, remainingQty: true, validUntil: true } },
          },
        },
      },
    });
    return attachLifecycle(full as any);
  });

  /**
   * Post-commit accrual: same path as `orders.service` `processPayment`.
   * `createSettlementLedgerForOrder` uses **order.totalAmount** and the **visit-attending doctor** (whole order, not per line).
   * No ledger row is created if the visit doctor is missing or not staffType DOCTOR — revenue still exists on `orders`.
   */
  if (settlementOrderId != null) {
    try {
      const { createSettlementLedgerForOrder } = require("./doctorSettlement.service");
      await createSettlementLedgerForOrder(settlementOrderId);
    } catch (err) {
      console.error("[injectionToken] createSettlementLedgerForOrder failed after checkout", {
        orderId: settlementOrderId,
        branchId: input.branchId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return token;
}

/** Get token with full treatment context for injection room UI and detail drawer (includes audit fields). */
export async function getTokenWithTreatmentContext(tokenId: number, branchId: number): Promise<any> {
  const row = await prisma.injectionToken.findFirst({
    where: { id: tokenId, branchId },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      visit: { select: { id: true, treatmentCode: true, doctorId: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          paymentStatus: true,
          totalAmount: true,
          status: true,
          items: {
            select: {
              id: true,
              quantity: true,
              price: true,
              total: true,
              serviceId: true,
              productId: true,
              variantId: true,
              service: { select: { id: true, name: true } },
              product: { select: { id: true, name: true } },
              variant: { select: { id: true, title: true, sku: true } },
            },
          },
        },
      },
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
      medicationLines: {
        orderBy: { lineIndex: "asc" },
        include: {
          variant: { select: { id: true, title: true, sku: true } },
          selectedVialSession: { select: { id: true, remainingQty: true, validUntil: true } },
        },
      },
      generatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      usedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      cancelledBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  if (!row) return null;
  return attachLifecycle(row);
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
      visit: { select: { id: true, treatmentCode: true, doctorId: true } },
      order: { select: { id: true, paymentStatus: true } },
      validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      medicationLines: {
        orderBy: { lineIndex: "asc" },
        include: { variant: { select: { id: true, title: true, sku: true } } },
      },
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
        visit: { select: { id: true, treatmentCode: true, doctorId: true } },
        order: { select: { id: true, paymentStatus: true } },
        validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        medicationLines: {
          orderBy: { lineIndex: "asc" },
          include: { variant: { select: { id: true, title: true, sku: true } } },
        },
      },
    });
  }

  return {
    valid: true,
    token: attachLifecycle(token as any),
    alreadyValidated: alreadyValidated || undefined,
  };
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

  if (opts?.expectedVariantId != null) {
    const exp = Number(opts.expectedVariantId);
    if (token.variantId != null && Number(token.variantId) !== exp) {
      throw new Error("Injection token is for a different medicine");
    }
    if (token.variantId == null) {
      const lines = await (tx as TxClient).injectionTokenMedicationLine.findMany({
        where: { injectionTokenId: token.id, variantId: exp },
        select: { id: true },
        take: 1,
      });
      if (lines.length === 0) {
        throw new Error("Injection token is for a different medicine");
      }
    }
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
  if (opts?.medicineSource) where.medicineSource = opts.medicineSource;
  if (opts?.encounterKind) where.encounterKind = opts.encounterKind;

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
        medicationLines: {
          orderBy: { lineIndex: "asc" },
          include: { variant: { select: { id: true, title: true, sku: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.injectionToken.count({ where }),
  ]);

  return {
    list: list.map((row) => attachLifecycle(row)),
    total,
  };
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
