/**
 * Dose Consumption Service (CCMLPA) — record medication administration and link to vial session.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as openVialService from "./openVial.service";

export type RecordAdministrationInput = {
  patientId: number;
  visitId?: number | null;
  surgeryCaseId?: number | null;
  variantId: number;
  vialSessionId?: number | null;
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
  if (data.vialSessionId) {
    await openVialService.recordDose(data.vialSessionId, {
      quantityDelta: -Number(data.administeredDose),
      performedByUserId: data.administeredByUserId ?? null,
      witnessUserId: data.witnessedByUserId ?? null,
    });
  }
  const admin = await prisma.medicationAdministration.create({
    data: {
      patientId: data.patientId,
      visitId: data.visitId ?? null,
      surgeryCaseId: data.surgeryCaseId ?? null,
      variantId: data.variantId,
      vialSessionId: data.vialSessionId ?? null,
      prescribedDose: data.prescribedDose != null ? data.prescribedDose : null,
      administeredDose: data.administeredDose,
      unit: data.unit ?? null,
      route: data.route ?? null,
      administeredByUserId: data.administeredByUserId ?? null,
      witnessedByUserId: data.witnessedByUserId ?? null,
    },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      vialSession: { select: { id: true, remainingQty: true } },
    },
  });
  return admin;
}

export async function getConsumptionByVisit(visitId: number): Promise<any[]> {
  return prisma.medicationAdministration.findMany({
    where: { visitId },
    include: {
      variant: { select: { id: true, title: true, sku: true } },
      vialSession: { select: { id: true } },
      administeredBy: { select: { id: true }, profile: { select: { displayName: true } } },
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
      patient: { select: { id: true }, profile: { select: { displayName: true } } },
    },
    orderBy: { administeredAt: "asc" },
  });
}
