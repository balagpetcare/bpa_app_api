import prisma from "../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import type { PaymentProviderCode } from "../providers/paymentProvider.config";

export type PaymentTransactionPhase = "CREATE" | "VERIFY" | "WEBHOOK" | "RECOVERY";
export type PaymentTransactionStatus = "PENDING" | "SUCCESS" | "FAILED";

export type LogPaymentTransactionInput = {
  orderId?: number;
  provider: PaymentProviderCode | string;
  referenceId: string;
  providerTxId?: string;
  eventId?: string;
  phase: PaymentTransactionPhase;
  status: PaymentTransactionStatus;
  amount?: number;
  requestJson?: Record<string, unknown>;
  responseJson?: Record<string, unknown>;
  errorMessage?: string;
  idempotencyKey?: string;
};

export async function logPaymentTransaction(input: LogPaymentTransactionInput): Promise<number> {
  const row = await prisma.paymentTransactionLog.create({
    data: {
      orderId: input.orderId,
      provider: input.provider,
      referenceId: input.referenceId,
      providerTxId: input.providerTxId,
      eventId: input.eventId,
      phase: input.phase,
      status: input.status,
      amount: input.amount != null ? input.amount : undefined,
      requestJson: input.requestJson as Prisma.InputJsonValue | undefined,
      responseJson: input.responseJson as Prisma.InputJsonValue | undefined,
      errorMessage: input.errorMessage,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return row.id;
}

export async function updatePaymentTransactionLog(
  logId: number,
  patch: Partial<
    Pick<
      LogPaymentTransactionInput,
      "status" | "providerTxId" | "eventId" | "responseJson" | "errorMessage" | "referenceId" | "amount"
    >
  >
): Promise<void> {
  await prisma.paymentTransactionLog.update({
    where: { id: logId },
    data: {
      status: patch.status,
      referenceId: patch.referenceId,
      providerTxId: patch.providerTxId,
      eventId: patch.eventId,
      amount: patch.amount != null ? patch.amount : undefined,
      responseJson: patch.responseJson as Prisma.InputJsonValue | undefined,
      errorMessage: patch.errorMessage,
    },
  });
}

export async function findRecoverableTransactionLogs(limit = 50) {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  return prisma.paymentTransactionLog.findMany({
    where: {
      phase: "CREATE",
      status: "SUCCESS",
      createdAt: { lt: cutoff },
      order: {
        paymentStatus: "PENDING",
        status: "PENDING",
      },
    },
    include: { order: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function findPendingVerifyLogs(limit = 50) {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  return prisma.paymentTransactionLog.findMany({
    where: {
      phase: "VERIFY",
      status: "PENDING",
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}
