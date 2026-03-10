/**
 * Procedures/Services delivery tracking: link service to visit, checklist, consumables.
 * Enforces payment gate: PAY_BEFORE_SERVICE services require a completed order for this visit+service.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const paymentGate = require("./paymentGate.service");

async function recordDelivery(
  visitId: number,
  data: { serviceId: number; status?: string; checklistJson?: any; consumablesJson?: any; notes?: string },
  opts?: { verifiedByUserId?: number }
): Promise<any> {
  const serviceId = data.serviceId;
  const gate = await paymentGate.assertPaymentGate(visitId, serviceId);

  const now = new Date();
  return prisma.serviceDelivery.create({
    data: {
      visitId,
      serviceId,
      status: data.status ?? "SCHEDULED",
      deliveredAt: data.status === "DELIVERED" ? now : null,
      checklistJson: data.checklistJson ?? null,
      consumablesJson: data.consumablesJson ?? null,
      notes: data.notes ?? null,
      orderId: gate.orderId ?? null,
      paymentVerified: true,
      paymentVerifiedAt: now,
      verifiedByUserId: opts?.verifiedByUserId ?? null,
    },
    include: { service: true },
  });
}

async function listByVisit(visitId: number): Promise<any[]> {
  return prisma.serviceDelivery.findMany({
    where: { visitId },
    include: { service: true },
    orderBy: { createdAt: "desc" },
  });
}

module.exports = { recordDelivery, listByVisit };
