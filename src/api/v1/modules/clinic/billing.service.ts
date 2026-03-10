/**
 * Clinic billing: link Visit to Order (invoice). Build summary from visit + prescriptions for frontend to create order.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const orderService = require("../orders/orders.service");

/**
 * Per-service payment status for a visit (for payment gate UI).
 * Returns services delivered or expected (appointment service) and whether each is paid.
 */
async function getVisitServicePaymentStatus(visitId: number, branchId: number): Promise<
  { serviceId: number; serviceName: string; paid: boolean; orderId?: number; receiptNumber?: string; deliveryId?: number }[]
> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    include: { appointment: { include: { service: { select: { id: true, name: true } } } } },
  });
  const deliveries = await prisma.serviceDelivery.findMany({
    where: { visitId },
    include: { service: { select: { id: true, name: true } } },
  });
  const completedOrders = await prisma.order.findMany({
    where: { visitId, branchId, paymentStatus: "COMPLETED" },
    include: { items: { where: { serviceId: { not: null } }, include: { service: { select: { id: true, name: true } } } } },
  });
  const paidByServiceId = new Map();
  for (const order of completedOrders) {
    const receiptNumber = order.orderNumber || order.invoiceNumber || `#${order.id}`;
    for (const item of order.items) {
      if (item.serviceId && item.service) {
        paidByServiceId.set(item.serviceId, {
          orderId: order.id,
          receiptNumber,
          serviceName: item.service.name,
        });
      }
    }
  }
  const seen = new Set();
  const result = [];
  if (visit?.appointment?.service) {
    const s = visit.appointment.service;
    seen.add(s.id);
    const paidInfo = paidByServiceId.get(s.id);
    result.push({
      serviceId: s.id,
      serviceName: s.name ?? `Service #${s.id}`,
      paid: !!paidInfo,
      orderId: paidInfo?.orderId,
      receiptNumber: paidInfo?.receiptNumber,
    });
  }
  for (const d of deliveries) {
    if (seen.has(d.serviceId)) continue;
    seen.add(d.serviceId);
    const paidInfo = paidByServiceId.get(d.serviceId);
    result.push({
      serviceId: d.serviceId,
      serviceName: d.service?.name ?? `Service #${d.serviceId}`,
      paid: !!paidInfo || d.paymentVerified,
      orderId: paidInfo?.orderId ?? d.orderId ?? undefined,
      receiptNumber: paidInfo?.receiptNumber ?? undefined,
      deliveryId: d.id,
    });
  }
  return result;
}

/**
 * Get billing summary for a visit: visit, appointment (service), doctor fee hint, prescriptions, servicePaymentStatus.
 * Frontend uses this to build line items (productId, price, quantity) for createInvoiceFromVisit.
 */
async function getBillingSummaryForVisit(visitId: number, branchId: number): Promise<any | null> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    include: {
      pet: { select: { id: true, name: true } },
      patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
      doctor: { select: { id: true, clinicStaffProfile: { select: { defaultConsultationFee: true } } } },
      appointment: { include: { service: { select: { id: true, name: true, price: true } } } },
      prescriptions: { where: { status: "FINALIZED" }, include: { items: true } },
    },
  });
  if (!visit) return null;
  const servicePaymentStatus = await getVisitServicePaymentStatus(visitId, branchId);
  return { ...visit, servicePaymentStatus };
}

/**
 * Create an order from a visit (clinic invoice). Items can be product-based or service-based (serviceId for payment gate).
 * Optionally pass clinicalCaseId/surgeryPackageId and breakdown for internal cost sheet and settlement.
 */
async function createInvoiceFromVisit(
  visitId: number,
  branchId: number,
  data: {
    customerId: number;
    items: Array<
      | { productId: number; variantId?: number; quantity: number; price: number }
      | { serviceId: number; quantity: number; price: number }
    >;
    paymentMethod?: string;
    notes?: string;
    clinicalCaseId?: number | null;
    surgeryPackageId?: number | null;
    doctorFeeAmount?: number | null;
    clinicShareAmount?: number | null;
    supportFeeAmount?: number | null;
    consumableCost?: number | null;
    discountApplied?: number | null;
  },
  createdByUserId: number
): Promise<any> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
  });
  if (!visit) throw new Error("Visit not found");

  const items = data.items.map((item: any) =>
    "serviceId" in item && item.serviceId != null
      ? { serviceId: item.serviceId, quantity: item.quantity, price: item.price }
      : { productId: item.productId, variantId: item.variantId ?? null, quantity: item.quantity, price: item.price }
  );

  const order = await orderService.createOrder({
    branchId,
    customerId: data.customerId,
    items,
    paymentMethod: data.paymentMethod,
    notes: data.notes ?? `Clinic visit #${visitId}`,
    createdByUserId,
    orderSource: "CLINIC",
    visitId,
  });

  if (
    data.clinicalCaseId != null ||
    data.surgeryPackageId != null ||
    data.doctorFeeAmount != null
  ) {
    try {
      const clinicInvoice = require("./clinicInvoice.service");
      await clinicInvoice.createOrUpdateClinicInvoice({
        orderId: order.id,
        clinicalCaseId: data.clinicalCaseId ?? null,
        surgeryPackageId: data.surgeryPackageId ?? null,
        doctorFeeAmount: data.doctorFeeAmount ?? null,
        clinicShareAmount: data.clinicShareAmount ?? null,
        supportFeeAmount: data.supportFeeAmount ?? null,
        consumableCost: data.consumableCost ?? null,
        discountApplied: data.discountApplied ?? null,
      });
    } catch (_) {
      // optional: do not fail order creation if clinic invoice fails
    }
  }

  return order;
}

/**
 * Get orders linked to a visit.
 */
async function getOrdersForVisit(visitId: number, branchId: number): Promise<any[]> {
  return prisma.order.findMany({
    where: { visitId, branchId },
    include: { items: { include: { product: true, variant: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get prescription items as order line candidates (for pharmacy auto-pick when creating invoice).
 * Returns items with productId, variantId, quantity; price can be looked up from product/variant.
 */
async function getPrescriptionItemsForOrder(prescriptionId: number): Promise<{ productId: number; productVariantId: number; medicineName: string; quantity: number; price?: number }[]> {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId, status: "FINALIZED" },
    include: { items: true },
  });
  if (!prescription) return [];
  const out: { productId: number; productVariantId: number; medicineName: string; quantity: number; price?: number }[] = [];
  for (const i of prescription.items) {
    if (i.productVariantId == null || i.quantity == null) continue;
    const v = await prisma.productVariant.findUnique({ where: { id: i.productVariantId }, include: { product: true } });
    if (v?.productId) out.push({ productId: v.productId, productVariantId: i.productVariantId, medicineName: i.medicineName, quantity: i.quantity });
  }
  return out;
}

module.exports = {
  getBillingSummaryForVisit,
  getVisitServicePaymentStatus,
  createInvoiceFromVisit,
  getOrdersForVisit,
  getPrescriptionItemsForOrder,
};
