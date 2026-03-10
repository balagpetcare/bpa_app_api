/**
 * Service-wise payment gate: "work cannot start without payment slip".
 * Checks that for a given visit + service there is a completed order (receipt) for that service.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

/**
 * Verify that the given service has been paid for in this visit (when payment gate rule requires it).
 * Returns { passed, reason?, orderId?, receiptNumber? }.
 */
async function verifyPaymentGate(visitId: number, serviceId: number) {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true, paymentGateRule: true },
  });
  if (!service) {
    return { passed: false, reason: "Service not found" };
  }

  const rule = (service.paymentGateRule || "PAY_BEFORE_SERVICE").toUpperCase();
  if (rule === "NO_GATE") {
    return { passed: true };
  }

  if (rule !== "PAY_BEFORE_SERVICE") {
    return { passed: true };
  }

  const order = await prisma.order.findFirst({
    where: {
      visitId,
      paymentStatus: "COMPLETED",
      status: { not: "CANCELLED" },
      items: {
        some: { serviceId },
      },
    },
    include: {
      items: { where: { serviceId }, take: 1 },
      posInvoice: { select: { invoiceNumber: true } },
    },
  });

  if (!order) {
    return { passed: false, reason: "Payment required before this service" };
  }

  const receiptNumber = order.posInvoice?.invoiceNumber ?? order.invoiceNumber ?? order.orderNumber ?? undefined;
  return { passed: true, orderId: order.id, receiptNumber };
}

/**
 * Assert payment gate; throws if not passed.
 */
async function assertPaymentGate(visitId: number, serviceId: number): Promise<{ orderId?: number; receiptNumber?: string }> {
  const result = await verifyPaymentGate(visitId, serviceId);
  if (!result.passed) {
    const err = new Error(result.reason || "Payment required before service") as Error & { statusCode?: number };
    err.statusCode = 402;
    throw err;
  }
  return { orderId: result.orderId, receiptNumber: result.receiptNumber };
}

module.exports = {
  verifyPaymentGate,
  assertPaymentGate,
};
