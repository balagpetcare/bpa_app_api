/**
 * Clinic billing: link Visit to Order (invoice). Build summary from visit + prescriptions for frontend to create order.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const orderService = require("../orders/orders.service");

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function listVaccinationBillingOptions(branchId: number): Promise<{ services: any[] }> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, orgId: true },
  });
  if (!branch) return { services: [] };

  const services = await prisma.service.findMany({
    where: {
      branchId,
      orgId: branch.orgId,
      status: "ACTIVE",
      category: "VACCINATION",
    },
    include: {
      pricingVariants: {
        where: { isActive: true },
        orderBy: [{ species: "asc" }, { sex: "asc" }],
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return {
    services: services.map((service: any) => {
      const activeVariants = Array.isArray(service.pricingVariants) ? service.pricingVariants : [];
      const singleVariant = activeVariants.length === 1 ? activeVariants[0] : null;
      return {
        serviceId: service.id,
        name: service.name,
        category: service.category,
        price: singleVariant?.price != null ? Number(singleVariant.price) : Number(service.price ?? 0),
        pricingVariantId: singleVariant?.id ?? null,
        currency: null,
        pricingVariants: activeVariants.map((variant: any) => ({
          pricingVariantId: variant.id,
          species: variant.species,
          sex: variant.sex ?? null,
          price: variant.price != null ? Number(variant.price) : 0,
        })),
      };
    }),
  };
}

async function prepareVaccinationBilling(data: {
  branchId: number;
  petId: number;
  vaccinationId?: number | null;
  vaccineTypeId: number;
  batchId: number;
  batchNumber?: string | null;
  visitId?: number | null;
  appointmentId?: number | null;
  serviceId?: number | null;
  pricingVariantId?: number | null;
  unitPrice?: number | null;
  quantity?: number | null;
  discountAmount?: number | null;
  billingNotes?: string | null;
}) {
  const branchId = Number(data.branchId);
  const petId = Number(data.petId);
  const vaccineTypeId = Number(data.vaccineTypeId);
  const batchId = Number(data.batchId);
  const serviceId = data.serviceId != null ? Number(data.serviceId) : NaN;
  const pricingVariantId = data.pricingVariantId != null ? Number(data.pricingVariantId) : null;
  const visitId = data.visitId != null ? Number(data.visitId) : null;
  const appointmentId = data.appointmentId != null ? Number(data.appointmentId) : null;
  const quantity = data.quantity != null ? Number(data.quantity) : 1;
  const discountAmount = data.discountAmount != null ? roundMoney(Number(data.discountAmount)) : 0;

  if (!Number.isFinite(branchId) || branchId <= 0) throw new Error("Invalid branchId");
  if (!Number.isFinite(petId) || petId <= 0) throw new Error("Invalid petId");
  if (!Number.isFinite(vaccineTypeId) || vaccineTypeId <= 0) throw new Error("Invalid vaccineTypeId");
  if (!Number.isFinite(batchId) || batchId <= 0) throw new Error("Invalid batchId");
  if (!Number.isFinite(serviceId) || serviceId <= 0) throw new Error("Valid vaccination billing service is required");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be a positive number");
  if (quantity !== 1) throw new Error("Vaccination billing quantity must be 1 in this phase");
  if (!Number.isFinite(discountAmount) || discountAmount < 0) throw new Error("discountAmount must be a non-negative number");

  const [branch, pet, service, vaccineType] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, orgId: true },
    }),
    prisma.pet.findUnique({
      where: { id: petId },
      select: {
        id: true,
        userId: true,
        sex: true,
        animalType: { select: { id: true, name: true } },
      },
    }),
    prisma.service.findFirst({
      where: {
        id: serviceId,
        branchId,
        status: "ACTIVE",
        category: "VACCINATION",
      },
      include: {
        pricingVariants: {
          where: { isActive: true },
          orderBy: [{ species: "asc" }, { sex: "asc" }],
        },
      },
    }),
    prisma.vaccineType.findUnique({
      where: { id: vaccineTypeId },
      select: { id: true, name: true },
    }),
  ]);

  if (!branch) throw new Error("Branch not found");
  if (!pet) throw new Error("Pet not found");
  if (!service) throw new Error("Vaccination billing service not found for this branch");
  if (!vaccineType) throw new Error("Vaccine type not found");

  const pricingVariants = Array.isArray(service.pricingVariants) ? service.pricingVariants : [];
  let selectedPricingVariant: any = null;
  if (pricingVariantId != null) {
    selectedPricingVariant = pricingVariants.find((variant: any) => Number(variant.id) === pricingVariantId) ?? null;
    if (!selectedPricingVariant) throw new Error("Selected pricing variant is not valid for this vaccination service");
  } else {
    const petSpecies = String(pet.animalType?.name ?? "").trim().toLowerCase();
    const petSex = String(pet.sex ?? "").trim().toLowerCase();
    selectedPricingVariant =
      pricingVariants.find((variant: any) => {
        const species = String(variant.species ?? "").trim().toLowerCase();
        const sex = String(variant.sex ?? "").trim().toLowerCase();
        const speciesMatch = !!petSpecies && species === petSpecies;
        const sexMatch = !sex || !petSex || sex === petSex;
        return speciesMatch && sexMatch;
      }) ?? (pricingVariants.length === 1 ? pricingVariants[0] : null);
  }

  const defaultUnitPrice =
    selectedPricingVariant?.price != null ? Number(selectedPricingVariant.price) : Number(service.price ?? 0);
  const unitPrice = data.unitPrice != null ? roundMoney(Number(data.unitPrice)) : roundMoney(defaultUnitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("unitPrice must be a non-negative number");

  const subtotalAmount = roundMoney(unitPrice * quantity);
  if (discountAmount > subtotalAmount) throw new Error("discountAmount cannot exceed the service subtotal");
  const totalAmount = roundMoney(subtotalAmount - discountAmount);

  let visit: any = null;
  if (visitId != null) {
    if (!Number.isFinite(visitId) || visitId <= 0) throw new Error("Invalid visitId");
    visit = await prisma.visit.findFirst({
      where: { id: visitId, branchId },
      select: { id: true, petId: true, patientId: true, appointmentId: true },
    });
    if (!visit) throw new Error("Visit not found for this branch");
    if (Number(visit.petId) !== petId) throw new Error("Selected visit does not belong to this pet");
    if (Number(visit.patientId) !== Number(pet.userId)) throw new Error("Selected visit does not match this pet owner");
    if (appointmentId != null && visit.appointmentId != null && Number(visit.appointmentId) !== appointmentId) {
      throw new Error("Selected appointment does not match the visit");
    }
  }

  let appointment: any = null;
  if (appointmentId != null) {
    if (!Number.isFinite(appointmentId) || appointmentId <= 0) throw new Error("Invalid appointmentId");
    appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, branchId },
      select: { id: true, petId: true, patientId: true },
    });
    if (!appointment) throw new Error("Appointment not found for this branch");
    if (appointment.petId != null && Number(appointment.petId) !== petId) {
      throw new Error("Selected appointment does not belong to this pet");
    }
    if (appointment.patientId != null && Number(appointment.patientId) !== Number(pet.userId)) {
      throw new Error("Selected appointment does not match this pet owner");
    }
  }

  return {
    branchId,
    orgId: branch.orgId,
    customerId: Number(pet.userId),
    petId,
    vaccineTypeId,
    vaccineTypeName: vaccineType.name,
    batchId,
    batchNumber: data.batchNumber ?? null,
    vaccinationId: data.vaccinationId != null ? Number(data.vaccinationId) : null,
    visitId: visit?.id ?? null,
    appointmentId: appointment?.id ?? appointmentId ?? null,
    serviceId: service.id,
    serviceName: service.name,
    pricingVariantId: selectedPricingVariant?.id ?? null,
    unitPrice,
    quantity,
    discountAmount,
    subtotalAmount,
    totalAmount,
    billingNotes: data.billingNotes ? String(data.billingNotes).trim() : "",
  };
}

async function createVaccinationBillingOrder(
  plan: {
    branchId: number;
    customerId: number;
    petId: number;
    vaccineTypeId: number;
    vaccineTypeName: string;
    batchId: number;
    batchNumber?: string | null;
    vaccinationId?: number | null;
    visitId?: number | null;
    appointmentId?: number | null;
    serviceId: number;
    serviceName: string;
    pricingVariantId?: number | null;
    unitPrice: number;
    quantity: number;
    discountAmount: number;
    subtotalAmount: number;
    totalAmount: number;
    billingNotes?: string;
  },
  createdByUserId: number
) {
  const noteParts = [
    `Vaccination #${plan.vaccinationId ?? "pending"}`,
    `Pet #${plan.petId}`,
    `VaccineType #${plan.vaccineTypeId}`,
    plan.batchNumber ? `Batch ${plan.batchNumber}` : `BatchId ${plan.batchId}`,
    plan.appointmentId ? `Appointment #${plan.appointmentId}` : null,
    plan.billingNotes || null,
  ].filter(Boolean);

  const order = await orderService.createOrder({
    branchId: plan.branchId,
    customerId: plan.customerId,
    items: [
      {
        serviceId: plan.serviceId,
        quantity: plan.quantity,
        price: plan.unitPrice,
      },
    ],
    notes: noteParts.join(" | "),
    createdByUserId,
    orderSource: "CLINIC",
    visitId: plan.visitId ?? undefined,
    orderTotals: {
      subtotalAmount: plan.subtotalAmount,
      discountPercent: null,
      discountAmount: plan.discountAmount,
      taxPercent: null,
      taxAmount: 0,
      totalAmount: plan.totalAmount,
    },
  });

  return {
    order,
    billing: {
      status: "CREATED",
      orderId: order.id,
      invoiceId: null,
      amount: plan.totalAmount,
      visitId: plan.visitId ?? null,
      serviceId: plan.serviceId,
      pricingVariantId: plan.pricingVariantId ?? null,
      message: `Clinic billing order created for service ${plan.serviceName}`,
    },
  };
}

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

/**
 * Get open vial availability for a variant at branch (for Smart Billing open vial panel).
 * Returns session with remaining mL, usable_until, status (OPEN/LOW_BALANCE/EXPIRED), enough/not enough vs requiredMl.
 */
async function getOpenVialAvailability(branchId: number, variantId: number, requiredMl?: number) {
  const dispenseControl = require("./dispenseControl.service");
  const session = await dispenseControl.checkExistingActiveVial(branchId, variantId);
  if (!session) {
    return { available: false, session: null, enough: false, remainingMl: 0, usableUntil: null, status: null };
  }
  const remaining = Number(session.remainingQty ?? 0);
  const validUntil = session.validUntil ? new Date(session.validUntil) : null;
  const isExpired = validUntil != null && validUntil < new Date();
  const status = isExpired ? "EXPIRED" : remaining <= 0 ? "EMPTY" : (requiredMl != null && remaining < requiredMl ? "LOW_BALANCE" : "OPEN");
  const enough = requiredMl == null ? remaining > 0 : remaining >= requiredMl && !isExpired;
  return {
    available: !isExpired && remaining > 0,
    session: { id: session.id, remainingQty: session.remainingQty, validUntil: session.validUntil, variantId: session.variantId },
    enough,
    remainingMl: remaining,
    usableUntil: validUntil,
    status,
  };
}

/**
 * Treatment billing summary: today's due medicines from course + open vial availability per item + charge hints.
 */
async function getTreatmentBillingSummary(courseId: number, branchId: number) {
  const dailyDue = require("./dailyDueMedicine.service");
  const { course, currentDay, todayDueItems, expectedMedicineCount } = await dailyDue.getTodayDueMedicines(courseId, branchId);
  const openVialByVariant = {};
  for (const item of todayDueItems) {
    const availability = await getOpenVialAvailability(branchId, item.variantId, Number(item.dosageMl ?? 0));
    openVialByVariant[item.variantId] = availability;
  }
  const locationPrices = await prisma.locationPrice.findMany({
    where: {
      location: { branchId },
      variantId: { in: todayDueItems.map((i) => i.variantId) },
    },
    include: { variant: { select: { id: true, title: true } } },
  }).catch(() => []);
  const priceByVariant = {};
  for (const lp of locationPrices) {
    if (lp.variantId && lp.sellingPrice != null) priceByVariant[lp.variantId] = Number(lp.sellingPrice);
  }
  const lineItems = todayDueItems.map((item) => ({
    treatmentDayItemId: item.id,
    variantId: item.variantId,
    medicineName: item.medicineName,
    dosageMl: item.dosageMl,
    route: item.route,
    quantity: 1,
    unitPrice: priceByVariant[item.variantId] ?? 0,
    openVial: openVialByVariant[item.variantId],
  }));
  const totalMedicineAmount = lineItems.reduce((sum, i) => sum + (i.unitPrice * (i.quantity || 1)), 0);
  return {
    course,
    currentDay,
    todayDueItems: lineItems,
    expectedMedicineCount,
    totalMedicineAmount,
    serviceFee: 0,
    totalAmount: totalMedicineAmount,
  };
}

/**
 * Create order (bill) for today's treatment day: line items from day items + optional service fee.
 */
async function createTreatmentDayBill(
  courseId: number,
  branchId: number,
  data: {
    customerId: number;
    treatmentDayId: number;
    serviceFee?: number;
    visitId?: number | null;
    paymentMethod?: string;
    notes?: string;
  },
  createdByUserId: number
) {
  const dailyDue = require("./dailyDueMedicine.service");
  const { currentDay, todayDueItems } = await dailyDue.getTodayDueMedicines(courseId, branchId);
  if (!currentDay || currentDay.id !== data.treatmentDayId) throw new Error("Treatment day not found or not due today");
  const orderService = require("../orders/orders.service");
  const locationPrices = await prisma.locationPrice.findMany({
    where: {
      location: { branchId },
      variantId: { in: todayDueItems.map((i) => i.variantId) },
    },
  }).catch(() => []);
  const priceByVariant = {};
  for (const lp of locationPrices) {
    if (lp.variantId != null && lp.sellingPrice != null) priceByVariant[lp.variantId] = Number(lp.sellingPrice);
  }
  const variantProduct = await prisma.productVariant.findMany({
    where: { id: { in: todayDueItems.map((i) => i.variantId) } },
    select: { id: true, productId: true },
  });
  const productByVariant = {};
  for (const v of variantProduct) productByVariant[v.id] = v.productId;
  const items = todayDueItems
    .map((item) => ({
      productId: productByVariant[item.variantId],
      variantId: item.variantId,
      quantity: 1,
      price: priceByVariant[item.variantId] ?? 0,
    }))
    .filter((i) => i.productId != null);
  if (data.serviceFee && data.serviceFee > 0) {
    const consultService = await prisma.service.findFirst({ where: { branchId }, select: { id: true } });
    if (consultService) {
      items.push({ productId: null, variantId: null, quantity: 1, price: data.serviceFee, serviceId: consultService.id });
    }
  }
  const orderItems = items.map((item) =>
    item.serviceId != null
      ? { serviceId: item.serviceId, quantity: item.quantity, price: item.price }
      : { productId: item.productId, variantId: item.variantId, quantity: item.quantity, price: item.price }
  );
  const order = await orderService.createOrder({
    branchId,
    customerId: data.customerId,
    items: orderItems,
    paymentMethod: data.paymentMethod,
    notes: data.notes ?? `Treatment day #${data.treatmentDayId}`,
    createdByUserId,
    orderSource: "CLINIC",
    visitId: data.visitId ?? undefined,
  });
  return order;
}

module.exports = {
  getBillingSummaryForVisit,
  getVisitServicePaymentStatus,
  createInvoiceFromVisit,
  getOrdersForVisit,
  getPrescriptionItemsForOrder,
  getOpenVialAvailability,
  getTreatmentBillingSummary,
  createTreatmentDayBill,
  listVaccinationBillingOptions,
  prepareVaccinationBilling,
  createVaccinationBillingOrder,
};
