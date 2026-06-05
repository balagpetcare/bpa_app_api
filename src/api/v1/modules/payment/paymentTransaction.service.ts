import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma, PaymentTransactionStatus } from "@prisma/client";

export type CreatePaymentTransactionInput = {
  bookingId?: number;
  transactionId: string;
  gateway: string;
  amount: number;
  status?: PaymentTransactionStatus;
  rawResponse?: Record<string, unknown>;
};

export async function createPaymentTransaction(
  input: CreatePaymentTransactionInput
): Promise<number> {
  const row = await prisma.paymentTransaction.create({
    data: {
      bookingId: input.bookingId,
      transactionId: input.transactionId,
      gateway: input.gateway,
      amount: input.amount,
      status: input.status ?? "PENDING",
      rawResponse: input.rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
  return row.id;
}

export async function findPaymentTransactionByGatewayTx(
  gateway: string,
  transactionId: string
) {
  return prisma.paymentTransaction.findUnique({
    where: {
      gateway_transactionId: { gateway, transactionId },
    },
  });
}

export async function updatePaymentTransaction(
  id: number,
  patch: {
    status?: PaymentTransactionStatus;
    bookingId?: number;
    rawResponse?: Record<string, unknown>;
  }
): Promise<void> {
  await prisma.paymentTransaction.update({
    where: { id },
    data: {
      status: patch.status,
      bookingId: patch.bookingId,
      rawResponse: patch.rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function upsertPaymentTransaction(
  input: CreatePaymentTransactionInput
): Promise<{ id: number; duplicate: boolean }> {
  const existing = await findPaymentTransactionByGatewayTx(
    input.gateway,
    input.transactionId
  );
  if (existing) {
    if (input.rawResponse) {
      await updatePaymentTransaction(existing.id, {
        rawResponse: input.rawResponse,
        status: input.status ?? existing.status,
        bookingId: input.bookingId ?? existing.bookingId ?? undefined,
      });
    }
    return { id: existing.id, duplicate: true };
  }

  const id = await createPaymentTransaction(input);
  return { id, duplicate: false };
}

export function mapWebhookStatusToTransactionStatus(
  status: "SUCCESS" | "FAILED" | "CANCELLED"
): PaymentTransactionStatus {
  if (status === "SUCCESS") return "SUCCESS";
  if (status === "CANCELLED") return "CANCELLED";
  return "FAILED";
}
