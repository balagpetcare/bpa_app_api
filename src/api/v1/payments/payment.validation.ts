import { z } from "zod";

export const createPaymentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("BDT"),
  referenceId: z.string().min(1).max(128),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url().optional(),
  orderId: z.number().int().positive().optional(),
  idempotencyKey: z.string().max(128).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const verifyPaymentSchema = z.object({
  referenceId: z.string().min(1).max(128),
  providerTxId: z.string().max(128).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  query: z.record(z.string(), z.string()).optional(),
});
