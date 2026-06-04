import prisma from "../../../infrastructure/db/prismaClient";
import { getPaymentTimeoutMinutes } from "../providers/paymentProvider.config";
import { verifyUnifiedPayment } from "./paymentOrchestrator.service";
import {
  findRecoverableTransactionLogs,
  logPaymentTransaction,
  updatePaymentTransactionLog,
} from "./paymentTransaction.service";

/**
 * Recovery job: re-verify stale pending orders and expire abandoned checkouts.
 */
export async function runPaymentRecoveryJob(): Promise<{
  verified: number;
  expired: number;
  errors: number;
}> {
  let verified = 0;
  let expired = 0;
  let errors = 0;

  const staleOrders = await findStalePendingOrders();
  for (const order of staleOrders) {
    try {
      const logId = await logPaymentTransaction({
        orderId: order.id,
        provider: String(order.paymentMethod || "unknown").toLowerCase(),
        referenceId: order.orderNumber,
        phase: "RECOVERY",
        status: "PENDING",
      });

      const result = await verifyUnifiedPayment({
        referenceId: order.orderNumber,
        providerTxId: order.orderPayments?.[0]?.reference || undefined,
      });

      if (result.success) {
        verified += 1;
        await updatePaymentTransactionLog(logId, { status: "SUCCESS" });
      } else if (isOrderExpired(order.createdAt)) {
        await expirePendingOrder(order.id);
        expired += 1;
        await updatePaymentTransactionLog(logId, {
          status: "FAILED",
          errorMessage: "Expired after recovery attempt",
        });
      } else {
        await updatePaymentTransactionLog(logId, {
          status: "FAILED",
          errorMessage: result.error || "Recovery verify failed",
        });
      }
    } catch (err) {
      errors += 1;
      console.warn("[PaymentRecovery] order", order.id, (err as Error).message);
    }
  }

  const recoverableLogs = await findRecoverableTransactionLogs(25);
  for (const log of recoverableLogs) {
    if (!log.order || log.order.paymentStatus !== "PENDING") continue;
    try {
      const result = await verifyUnifiedPayment({
        referenceId: log.referenceId,
        providerTxId: log.providerTxId || undefined,
      });
      if (result.success) verified += 1;
    } catch {
      errors += 1;
    }
  }

  return { verified, expired, errors };
}

function isOrderExpired(createdAt: Date): boolean {
  const timeoutMin = getPaymentTimeoutMinutes();
  return createdAt.getTime() < Date.now() - timeoutMin * 60 * 1000;
}

async function findStalePendingOrders() {
  const minAge = new Date(Date.now() - 3 * 60 * 1000);
  const maxAge = new Date(Date.now() - getPaymentTimeoutMinutes() * 60 * 1000);

  return prisma.order.findMany({
    where: {
      paymentStatus: "PENDING",
      status: "PENDING",
      createdAt: { gte: maxAge, lt: minAge },
      OR: [
        { notes: { contains: "campaign_booking:" } },
        { notes: { contains: "campaign_checkout:" } },
      ],
    },
    include: { orderPayments: { take: 1, orderBy: { id: "desc" } } },
    take: 30,
    orderBy: { createdAt: "asc" },
  });
}

async function expirePendingOrder(orderId: number): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.paymentStatus !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: "FAILED", status: "CANCELLED" },
    });

    const bookingMatch = order.notes?.match(/campaign_booking:(\d+)/);
    if (bookingMatch) {
      const bookingId = Number(bookingMatch[1]);
      await tx.campaignBooking.updateMany({
        where: {
          id: bookingId,
          paymentStatus: { notIn: ["COMPLETED", "REFUNDED"] },
        },
        data: { paymentStatus: "FAILED" },
      });
    }

    const checkoutMatch = order.notes?.match(/campaign_checkout:([a-z0-9]+)/i);
    if (checkoutMatch) {
      await tx.campaignCheckoutSession.updateMany({
        where: { id: checkoutMatch[1], status: { in: ["PENDING", "PAID"] } },
        data: { status: "FAILED" },
      });
    }
  });
}
