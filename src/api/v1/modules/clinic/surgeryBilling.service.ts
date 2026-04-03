/**
 * Surgery billing: estimate (Order + ClinicInvoice linked to SurgeryCase), finalize, get billing summary.
 * Reuses ClinicInvoice + Order; snapshot strategy for pricing.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const ordersService = require("../orders/orders.service");
const clinicInvoiceService = require("./clinicInvoice.service");
const doctorSettlementService = require("./doctorSettlement.service");

function assertSurgeryCaseInBranch(caseRow: { branchId: number } | null, branchId: number): void {
  if (!caseRow) throw new Error("SURGERY_CASE_NOT_FOUND");
  if (caseRow.branchId !== branchId) throw new Error("SURGERY_CASE_NOT_FOUND");
}

/**
 * Get billing summary for a surgery case (invoice + order if any).
 */
async function getBillingSummary(branchId: number, surgeryCaseId: number) {
  const surgeryCase = await prisma.surgeryCase.findFirst({
    where: { id: surgeryCaseId, branchId },
    include: {
      service: { select: { id: true, name: true, price: true } },
      clinicInvoices: {
        include: {
          order: { select: { id: true, orderNumber: true, totalAmount: true, paymentStatus: true } },
          costSheets: true,
        },
      },
    },
  });
  assertSurgeryCaseInBranch(surgeryCase, branchId);
  const invoice = surgeryCase?.clinicInvoices?.[0] ?? null;
  return {
    surgeryCase: surgeryCase
      ? {
          id: surgeryCase.id,
          caseNumber: surgeryCase.caseNumber,
          estimatedAmount: surgeryCase.estimatedAmount,
          advancePaid: surgeryCase.advancePaid,
          service: surgeryCase.service,
        }
      : null,
    invoice: invoice
      ? {
          id: invoice.id,
          orderId: invoice.orderId,
          billingStatus: invoice.billingStatus,
          doctorFeeAmount: invoice.doctorFeeAmount,
          clinicShareAmount: invoice.clinicShareAmount,
          consumableCost: invoice.consumableCost,
          anesthesiaCharge: invoice.anesthesiaCharge,
          otCharge: invoice.otCharge,
          order: invoice.order,
          costSheets: invoice.costSheets,
        }
      : null,
  };
}

/**
 * Create estimate: create Order (service line) + ClinicInvoice linked to surgery case with billingStatus ESTIMATE.
 */
async function createEstimate(
  branchId: number,
  surgeryCaseId: number,
  userId: number,
  body: {
    totalAmount?: number;
    doctorFeeAmount?: number;
    clinicShareAmount?: number;
    consumableCost?: number;
    anesthesiaCharge?: number;
    otCharge?: number;
  }
) {
  const surgeryCase = await prisma.surgeryCase.findFirst({
    where: { id: surgeryCaseId, branchId },
    include: { service: { select: { id: true, name: true, price: true } } },
  });
  assertSurgeryCaseInBranch(surgeryCase, branchId);

  const existing = await clinicInvoiceService.getClinicInvoiceBySurgeryCaseId(surgeryCaseId);
  if (existing) throw new Error("SURGERY_ALREADY_HAS_BILL");

  const servicePrice = Number(surgeryCase!.service?.price ?? 0);
  const totalAmount = body.totalAmount != null ? Number(body.totalAmount) : (surgeryCase!.estimatedAmount ? Number(surgeryCase!.estimatedAmount) : servicePrice);
  const doctorFee = body.doctorFeeAmount != null ? Number(body.doctorFeeAmount) : 0;
  const clinicShare = body.clinicShareAmount != null ? Number(body.clinicShareAmount) : totalAmount - doctorFee;
  const consumableCost = body.consumableCost != null ? Number(body.consumableCost) : 0;
  const anesthesiaCharge = body.anesthesiaCharge != null ? Number(body.anesthesiaCharge) : 0;
  const otCharge = body.otCharge != null ? Number(body.otCharge) : 0;

  const order = await ordersService.createOrder({
    branchId,
    customerId: surgeryCase!.patientId,
    items: [{ serviceId: surgeryCase!.serviceId, quantity: 1, price: totalAmount }],
    notes: `Surgery ${surgeryCase!.caseNumber}`,
    createdByUserId: userId,
    orderSource: "CLINIC",
  });

  const invoice = await clinicInvoiceService.createOrUpdateClinicInvoice({
    orderId: order.id,
    surgeryCaseId,
    surgeryPackageId: surgeryCase!.surgeryPackageId ?? undefined,
    doctorFeeAmount: doctorFee,
    clinicShareAmount: clinicShare,
    supportFeeAmount: 0,
    consumableCost,
    anesthesiaCharge,
    otCharge,
    billingStatus: "ESTIMATE",
  });

  return getBillingSummary(branchId, surgeryCaseId);
}

/**
 * Finalize bill: set billingStatus to FINALIZED and generate payout ledger entries.
 */
async function finalizeBill(branchId: number, surgeryCaseId: number) {
  const surgeryCase = await prisma.surgeryCase.findFirst({
    where: { id: surgeryCaseId, branchId },
  });
  assertSurgeryCaseInBranch(surgeryCase, branchId);

  const invoice = await clinicInvoiceService.getClinicInvoiceBySurgeryCaseId(surgeryCaseId);
  if (!invoice) throw new Error("SURGERY_NO_BILL");
  if (invoice.billingStatus === "FINALIZED") return getBillingSummary(branchId, surgeryCaseId);

  await prisma.clinicInvoice.update({
    where: { id: invoice.id },
    data: { billingStatus: "FINALIZED" },
  });

  if (typeof doctorSettlementService.createSettlementLedgerForSurgeryCase === "function") {
    await doctorSettlementService.createSettlementLedgerForSurgeryCase(surgeryCaseId).catch(() => {});
  }

  return getBillingSummary(branchId, surgeryCaseId);
}

module.exports = { getBillingSummary, createEstimate, finalizeBill };
