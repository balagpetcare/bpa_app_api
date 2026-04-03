/**
 * Dose Consumption Service (CCMLPA) — record medication administration and link to vial session.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as openVialService from "./openVial.service";
import * as injectionTokenService from "./injectionToken.service";
import * as outsideMedicineService from "./outsideMedicine.service";
import * as dispenseControl from "./dispenseControl.service";
import type { MedicineSource } from "@prisma/client";
import {
  normalizeMedicineSourceInput,
  medicineSourceRequiresClinicVial,
  medicineSourceIsPatientBroughtOutside,
} from "./medicineSource.util";

export type RecordAdministrationInput = {
  branchId: number;
  patientId: number;
  visitId?: number | null;
  surgeryCaseId?: number | null;
  variantId: number;
  vialSessionId?: number | null;
  injectionTokenId?: number | null;
  medicineSource?: MedicineSource;
  allowEmergencyBypass?: boolean;
  emergencyBypassReason?: string | null;
  medicineApprovalRequestId?: number | null;
  prescribedDose?: number | null;
  administeredDose: number;
  unit?: string | null;
  route?: string | null;
  administeredByUserId?: number | null;
  witnessedByUserId?: number | null;
};

/**
 * Record a dose administration. If vialSessionId provided, also decrements vial session via openVialService.recordDose.
 */
export async function recordAdministration(data: RecordAdministrationInput): Promise<any> {
  if (!data.branchId) throw new Error("branchId is required");
  if (!data.patientId || !data.variantId || data.administeredDose == null) {
    throw new Error("patientId, variantId and administeredDose are required");
  }

  return prisma.$transaction(async (tx) => {
    let resolvedSource: MedicineSource = normalizeMedicineSourceInput(data.medicineSource, "INTERNAL_CLINIC");
    let token: any = null;

    if (medicineSourceIsPatientBroughtOutside(resolvedSource) && data.allowEmergencyBypass) {
      throw new Error(
        "Patient-brought outside medicine cannot use emergency bypass; use a validated injection token and normal flow"
      );
    }
    if (medicineSourceIsPatientBroughtOutside(resolvedSource) && data.vialSessionId != null) {
      throw new Error("Patient-brought outside medicine cannot be linked to clinic vial session");
    }

    if (!data.allowEmergencyBypass) {
      if (!data.injectionTokenId) {
        throw new Error("injectionTokenId is required");
      }
      token = await injectionTokenService.getUsableTokenById(
        Number(data.injectionTokenId),
        Number(data.branchId),
        {
          tx,
          expectedVariantId: Number(data.variantId),
          expectedVisitId: data.visitId != null ? Number(data.visitId) : undefined,
        }
      );
      if (token.patientId !== Number(data.patientId)) {
        throw new Error("Injection token does not belong to this patient");
      }
      resolvedSource = token.medicineSource;
    } else if (data.injectionTokenId) {
      token = await injectionTokenService.getUsableTokenById(
        Number(data.injectionTokenId),
        Number(data.branchId),
        {
          tx,
          expectedVariantId: Number(data.variantId),
          expectedVisitId: data.visitId != null ? Number(data.visitId) : undefined,
        }
      );
      if (token.patientId !== Number(data.patientId)) {
        throw new Error("Injection token does not belong to this patient");
      }
      resolvedSource = token.medicineSource;
    }

    const needsClinicVial = medicineSourceRequiresClinicVial(resolvedSource);
    if (needsClinicVial && !data.allowEmergencyBypass && data.vialSessionId == null) {
      throw new Error("Vial session is required for clinic-supplied medicine dose administration");
    }

    if (medicineSourceIsPatientBroughtOutside(resolvedSource)) {
      const valid = await outsideMedicineService.hasValidOutsideReceive(
        Number(data.branchId),
        Number(data.variantId)
      );
      if (!valid) {
        throw new Error(
          "Patient-brought outside medicine requires a pharmacy verification (receive) record for this branch and variant before injection"
        );
      }
    }

    if (data.vialSessionId != null) {
      const [tokenWithVial, vialSession] = await Promise.all([
        token != null && data.injectionTokenId != null
          ? (tx as any).injectionToken.findFirst({
              where: { id: Number(data.injectionTokenId), branchId: data.branchId },
              select: {
                selectedVialSessionId: true,
                selectedVialSession: { select: { roomId: true } },
              },
            })
          : null,
        (tx as any).vialSession.findFirst({
          where: { id: Number(data.vialSessionId), branchId: data.branchId },
          select: { roomId: true, activatedFromDispenseRequestId: true, branchId: true },
        }),
      ]);
      const tokenWithVialRes = tokenWithVial ?? null;
      const vialSessionRes = vialSession ?? null;
      if (tokenWithVialRes && vialSessionRes) {
        const tokenRoomId = tokenWithVialRes?.selectedVialSession?.roomId ?? null;
        const selectedRoomId = vialSessionRes?.roomId ?? null;
        if (tokenRoomId != null && selectedRoomId != null && tokenRoomId !== selectedRoomId) {
          throw new Error("ROOM_MISMATCH");
        }
      }
      if (vialSessionRes?.activatedFromDispenseRequestId != null) {
        await dispenseControl.requireDispenseRequestReceived(
          vialSessionRes.activatedFromDispenseRequestId,
          data.branchId
        );
      }
    }

    let treatmentDayItemId: number | null = null;
    if (token?.treatmentDayId != null && token?.treatmentCourseId != null) {
      const dayItem = await (tx as any).treatmentDayItem.findFirst({
        where: {
          treatmentDayId: token.treatmentDayId,
          variantId: data.variantId,
          status: "DUE",
        },
      });
      if (dayItem) treatmentDayItemId = dayItem.id;
    }

    if (data.vialSessionId) {
      await openVialService.recordDose(
        data.vialSessionId,
        {
          quantityDelta: -Number(data.administeredDose),
          performedByUserId: data.administeredByUserId ?? null,
          witnessUserId: data.witnessedByUserId ?? null,
        },
        tx
      );
    }

    const admin = await (tx as any).medicationAdministration.create({
      data: {
        patientId: data.patientId,
        visitId: data.visitId ?? null,
        surgeryCaseId: data.surgeryCaseId ?? null,
        variantId: data.variantId,
        vialSessionId: data.vialSessionId ?? null,
        injectionTokenId: data.injectionTokenId ?? null,
        treatmentCourseId: token?.treatmentCourseId ?? null,
        treatmentDayItemId: treatmentDayItemId ?? null,
        prescribedDose: data.prescribedDose != null ? data.prescribedDose : null,
        administeredDose: data.administeredDose,
        unit: data.unit ?? null,
        medicineSource: resolvedSource,
        route: data.route ?? null,
        administeredByUserId: data.administeredByUserId ?? null,
        witnessedByUserId: data.witnessedByUserId ?? null,
        emergencyBypassReason: data.emergencyBypassReason ?? null,
        medicineApprovalRequestId: data.medicineApprovalRequestId ?? null,
      },
      include: {
        variant: { select: { id: true, title: true, sku: true } },
        vialSession: { select: { id: true, remainingQty: true } },
        injectionToken: { select: { id: true, tokenCode: true, status: true } },
      },
    });

    if (data.injectionTokenId) {
      await injectionTokenService.consumeToken(
        Number(data.injectionTokenId),
        data.administeredByUserId ?? null,
        {
          tx,
          expectedVariantId: Number(data.variantId),
          expectedVisitId: data.visitId != null ? Number(data.visitId) : undefined,
        }
      );
    }

    if (treatmentDayItemId) {
      await (tx as any).treatmentDayItem.update({
        where: { id: treatmentDayItemId },
        data: { status: "ADMINISTERED" },
      });
    }

    return admin;
  });
}

export async function getConsumptionByVisit(visitId: number): Promise<any[]> {
  return prisma.medicationAdministration.findMany({
    where: { visitId },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      vialSession: { select: { id: true } },
      administeredBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
    orderBy: { administeredAt: "desc" },
  });
}

export async function getConsumptionByVialSession(vialSessionId: number): Promise<any[]> {
  return prisma.medicationAdministration.findMany({
    where: { vialSessionId },
    include: {
      variant: { select: { id: true, title: true } },
      visit: { select: { id: true, treatmentCode: true } },
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
    },
    orderBy: { administeredAt: "asc" },
  });
}
