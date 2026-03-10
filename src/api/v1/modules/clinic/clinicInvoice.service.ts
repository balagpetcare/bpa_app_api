/**
 * Clinic Invoice: package-aware invoice record (links Order to ClinicalCase/SurgeryPackage),
 * internal cost sheet (revenue, direct cost, margin, doctor/clinic/support share).
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const caseCostService = require("./caseCost.service");
const { emit, DOMAIN_EVENTS } = require("../../services/domainEvents.service");

/** Create or update clinic invoice and cost sheet for an order */
export async function createOrUpdateClinicInvoice(data: {
  orderId: number;
  clinicalCaseId?: number | null;
  surgeryPackageId?: number | null;
  doctorFeeAmount?: number | null;
  clinicShareAmount?: number | null;
  supportFeeAmount?: number | null;
  consumableCost?: number | null;
  discountApplied?: number | null;
}) {
  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: {
      id: true,
      totalAmount: true,
      discountAmount: true,
      branchId: true,
    },
  });
  if (!order) throw new Error("Order not found");

  const revenue = Number(order.totalAmount ?? 0);
  const discountApplied = Number(data.discountApplied ?? order.discountAmount ?? 0);
  const netRevenue = revenue - discountApplied;

  const doctorFee = data.doctorFeeAmount != null ? Number(data.doctorFeeAmount) : 0;
  const clinicShare = data.clinicShareAmount != null ? Number(data.clinicShareAmount) : 0;
  const supportFee = data.supportFeeAmount != null ? Number(data.supportFeeAmount) : 0;
  const directCost = data.consumableCost != null ? Number(data.consumableCost) : 0;
  const distributableMargin = netRevenue - directCost;

  const existing = await prisma.clinicInvoice.findUnique({
    where: { orderId: data.orderId },
  });

  const invoice = existing
    ? await prisma.clinicInvoice.update({
        where: { orderId: data.orderId },
        data: {
          clinicalCaseId: data.clinicalCaseId ?? undefined,
          surgeryPackageId: data.surgeryPackageId ?? undefined,
          doctorFeeAmount: doctorFee,
          clinicShareAmount: clinicShare,
          supportFeeAmount: supportFee,
          consumableCost: directCost,
          discountApplied: discountApplied || undefined,
        },
      })
    : await prisma.clinicInvoice.create({
        data: {
          orderId: data.orderId,
          clinicalCaseId: data.clinicalCaseId ?? undefined,
          surgeryPackageId: data.surgeryPackageId ?? undefined,
          doctorFeeAmount: doctorFee,
          clinicShareAmount: clinicShare,
          supportFeeAmount: supportFee,
          consumableCost: directCost,
          discountApplied: discountApplied || undefined,
        },
      });

  const costSheetData = {
    revenue: netRevenue,
    directCost,
    distributableMargin,
    doctorShare: doctorFee,
    clinicShare,
    supportShare,
    grossProfit: distributableMargin,
    snapshotJson: {
      orderTotal: revenue,
      discountApplied,
      netRevenue,
      directCost,
      doctorShare: doctorFee,
      clinicShare,
      supportShare,
    },
  };
  const existingSheet = await prisma.invoiceCostSheet.findFirst({
    where: { clinicInvoiceId: invoice.id },
    orderBy: { id: "desc" },
  });
  if (existingSheet) {
    await prisma.invoiceCostSheet.update({
      where: { id: existingSheet.id },
      data: costSheetData,
    });
  } else {
    await prisma.invoiceCostSheet.create({
      data: { clinicInvoiceId: invoice.id, ...costSheetData },
    });
  }

  if (data.clinicalCaseId) {
    await caseCostService.buildCaseCostSheet(data.clinicalCaseId).catch(() => {});
  }

  emit(DOMAIN_EVENTS.INVOICE_GENERATED, {
    orderId: data.orderId,
    clinicInvoiceId: invoice.id,
    branchId: order.branchId,
    clinicalCaseId: data.clinicalCaseId ?? null,
    surgeryPackageId: data.surgeryPackageId ?? null,
    revenue: netRevenue,
  });

  return prisma.clinicInvoice.findUnique({
    where: { id: invoice.id },
    include: { costSheets: true },
  });
}

/** Get clinic invoice by order id */
export async function getClinicInvoiceByOrderId(orderId: number) {
  return prisma.clinicInvoice.findUnique({
    where: { orderId },
    include: {
      clinicalCase: { select: { id: true, status: true } },
      surgeryPackage: { select: { id: true, packageCode: true, packageName: true } },
      costSheets: true,
    },
  });
}

/** Get internal cost sheet for an order (for reporting) */
export async function getInvoiceCostSheet(orderId: number) {
  const inv = await prisma.clinicInvoice.findUnique({
    where: { orderId },
    include: { costSheets: true },
  });
  return inv?.costSheets?.[0] ?? null;
}
