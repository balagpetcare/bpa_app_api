/**
 * E-Prescription: create, finalize, list by visit; medicine search; QR token for verification.
 * When markDispensed is called with createDispenseRequest, a CCMLPA DispenseRequest is created from prescription items (productVariantId).
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { randomUUID } = require("crypto");
const dispenseControlService = require("./dispenseControl.service");
const countryMedicineCatalog = require("../../services/countryMedicineCatalog.service");

const countryMedicineBrandItemInclude = {
  select: {
    id: true,
    packageMarkDisplay: true,
    brand: { select: { displayName: true, manufacturer: { select: { displayName: true } } } },
    presentation: {
      select: {
        strengthDisplay: true,
        generic: { select: { displayName: true } },
        dosageForm: { select: { displayName: true } },
      },
    },
  },
};

export type PrescriptionItemInput = {
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity?: number;
  instructions?: string;
  productVariantId?: number;
  clinicalItemVariantId?: number;
  countryMedicineBrandId?: number | null;
};

function generateQrToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
}

async function createPrescription(
  visitId: number,
  data: { petId: number; doctorId: number; notes?: string; items: PrescriptionItemInput[] }
): Promise<any> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: { branchId: true },
  });
  if (!visit) throw countryMedicineCatalog.visitNotFoundError();
  const catalogErr = await countryMedicineCatalog.validatePrescriptionItemsForBranch(visit.branchId, data.items);
  if (catalogErr) throw countryMedicineCatalog.rxCatalogValidationError(catalogErr);

  const qrToken = generateQrToken();
  const prescription = await prisma.prescription.create({
    data: {
      visitId,
      petId: data.petId,
      doctorId: data.doctorId,
      qrToken,
      status: "DRAFT",
      notes: data.notes ?? null,
      items: {
        create: data.items.map((item) => ({
          medicineName: item.medicineName,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
          quantity: item.quantity ?? null,
          instructions: item.instructions ?? null,
          productVariantId: item.productVariantId ?? null,
          clinicalItemVariantId: item.clinicalItemVariantId ?? null,
          countryMedicineBrandId: item.countryMedicineBrandId ?? null,
        })),
      },
    },
    include: {
      items: {
        include: {
          clinicalItemVariant: { select: { id: true, variantName: true, sku: true } },
          countryMedicineBrand: countryMedicineBrandItemInclude,
        },
      },
      doctor: { select: { id: true } },
      pet: { select: { id: true, name: true } },
    },
  });
  return prescription;
}

async function getPrescriptionById(prescriptionId: number): Promise<any | null> {
  return prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      items: {
        include: {
          clinicalItemVariant: { select: { id: true, variantName: true, sku: true, item: { select: { name: true, itemCode: true } } } },
          countryMedicineBrand: countryMedicineBrandItemInclude,
        },
      },
      visit: true,
      pet: true,
      doctor: { include: { user: { select: { profile: { select: { displayName: true } } } } } },
    },
  });
}

async function getPrescriptionByQrToken(qrToken: string): Promise<any | null> {
  return prisma.prescription.findUnique({
    where: { qrToken },
    include: {
      items: {
        include: {
          clinicalItemVariant: { select: { id: true, variantName: true, sku: true } },
          countryMedicineBrand: countryMedicineBrandItemInclude,
        },
      },
      visit: true,
      pet: true,
      doctor: { include: { user: { select: { profile: { select: { displayName: true } } } } } },
    },
  });
}

async function listByVisit(visitId: number): Promise<any[]> {
  return prisma.prescription.findMany({
    where: { visitId },
    include: {
      items: {
        include: {
          clinicalItemVariant: { select: { id: true, variantName: true } },
          countryMedicineBrand: countryMedicineBrandItemInclude,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Update a DRAFT prescription (notes and/or items). Only DRAFT can be updated.
 */
async function updatePrescription(
  prescriptionId: number,
  data: { notes?: string; items?: PrescriptionItemInput[] }
): Promise<any | null> {
  const p = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { items: true, visit: { select: { branchId: true } } },
  });
  if (!p || p.status !== "DRAFT") return null;

  const updateData: Record<string, unknown> = {};
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.items !== undefined && Array.isArray(data.items) && data.items.length >= 0) {
    const catalogErr = await countryMedicineCatalog.validatePrescriptionItemsForBranch(p.visit.branchId, data.items);
    if (catalogErr) throw countryMedicineCatalog.rxCatalogValidationError(catalogErr);
    await prisma.prescriptionItem.deleteMany({ where: { prescriptionId } });
    updateData.items = {
      create: data.items.map((item) => ({
        medicineName: item.medicineName,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        quantity: item.quantity ?? null,
        instructions: item.instructions ?? null,
        productVariantId: item.productVariantId ?? null,
        clinicalItemVariantId: item.clinicalItemVariantId ?? null,
        countryMedicineBrandId: item.countryMedicineBrandId ?? null,
      })),
    };
  }

  return prisma.prescription.update({
    where: { id: prescriptionId },
    data: updateData,
    include: {
      items: {
        include: {
          clinicalItemVariant: { select: { id: true, variantName: true, sku: true } },
          countryMedicineBrand: countryMedicineBrandItemInclude,
        },
      },
    },
  });
}

async function finalizePrescription(prescriptionId: number): Promise<any | null> {
  const p = await prisma.prescription.findUnique({ where: { id: prescriptionId } });
  if (!p || p.status !== "DRAFT") return null;
  return prisma.prescription.update({
    where: { id: prescriptionId },
    data: { status: "FINALIZED" },
    include: { items: true },
  });
}

/**
 * Mark prescription as dispensed. Optionally create a CCMLPA DispenseRequest from items that have productVariantId.
 * @param opts.requestedByUserId - Required when createDispenseRequest is true (user creating the dispense request).
 * @param opts.createDispenseRequest - If true and prescription has items with productVariantId, creates a dispense request for pharmacy.
 */
async function markDispensed(
  prescriptionId: number,
  opts?: { requestedByUserId?: number; createDispenseRequest?: boolean }
): Promise<any | null> {
  const p = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { items: true, visit: { select: { id: true, branchId: true, patientId: true, orgId: true } } },
  });
  if (!p || p.status !== "FINALIZED") return null;
  const updated = await prisma.prescription.update({
    where: { id: prescriptionId },
    data: { status: "DISPENSED" },
    include: { items: true },
  });
  if (opts?.createDispenseRequest && opts?.requestedByUserId && p.visit) {
    const itemsWithVariant = (p.items || []).filter((i) => i.productVariantId != null);
    if (itemsWithVariant.length > 0) {
      try {
        await dispenseControlService.createRequest({
          branchId: p.visit.branchId,
          orgId: p.visit.orgId,
          requestedByUserId: opts.requestedByUserId,
          patientId: p.visit.patientId,
          visitId: p.visit.id,
          prescriptionId: prescriptionId,
          transactionType: "CLINIC_USE",
          urgencyLevel: "NORMAL",
          items: itemsWithVariant.map((i) => ({
            variantId: i.productVariantId,
            clinicalItemVariantId: i.clinicalItemVariantId ?? null,
            requestedQty: i.quantity ?? 1,
            unit: null,
            reason: `Prescription #${prescriptionId}: ${i.medicineName}`,
          })),
        });
      } catch (_) {
        // Non-fatal: prescription is still marked dispensed; dispense request can be created manually
      }
    }
  }
  return updated;
}

/**
 * Search medicine from product variants (branch or org scope). Returns name, sku, productVariantId for picker.
 */
async function searchMedicine(branchId: number, query: string, limit: number = 20): Promise<any[]> {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim().toLowerCase();
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) return [];

  const variants = await prisma.productVariant.findMany({
    where: {
      product: { orgId: branch.orgId },
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { product: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    select: { id: true, sku: true, product: { select: { id: true, name: true } } },
    take: limit,
  });
  return variants.map((v) => ({ productVariantId: v.id, sku: v.sku, name: v.product?.name ?? v.sku }));
}

/**
 * Simple weight-based dose helper: dosePerKg * weightKg = total dose (for display only).
 */
function doseByWeight(dosePerKg: number, weightKg: number): number {
  return Math.round(dosePerKg * weightKg * 100) / 100;
}

module.exports = {
  generateQrToken,
  createPrescription,
  getPrescriptionById,
  getPrescriptionByQrToken,
  listByVisit,
  updatePrescription,
  finalizePrescription,
  markDispensed,
  searchMedicine,
  doseByWeight,
};
