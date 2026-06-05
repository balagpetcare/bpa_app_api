import { z } from "zod";

export const epsInitiateSchema = z.object({
  referenceId: z.string().min(1).max(128),
  amount: z.number().positive(),
  bookingId: z.number().int().positive().optional(),
  returnUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z
    .object({
      merchantTransactionId: z.string().max(128).optional(),
      phone: z.string().max(20).optional(),
      name: z.string().max(120).optional(),
      email: z.string().email().optional(),
      description: z.string().max(256).optional(),
      orderId: z.string().max(64).optional(),
    })
    .optional(),
});

export const epsValidateSchema = z.object({
  merchantTransactionId: z.string().max(128).optional(),
  epsTransactionId: z.string().max(128).optional(),
  bookingId: z.number().int().positive().optional(),
});
