/**
 * Vendor module validation (zod).
 */
import { z } from "zod";

const vendorTypeEnum = z.enum([
  "DISTRIBUTOR",
  "WHOLESALER",
  "IMPORTER",
  "LOCAL",
  "MANUFACTURER",
  "OTHER",
]);
const vendorStatusEnum = z.enum(["ACTIVE", "INACTIVE", "BLACKLISTED"]);
const attachmentTypeEnum = z.enum(["TRADE_LICENSE", "INVOICE", "CHALLAN", "OTHER"]);

export const createVendorSchema = z.object({
  orgId: z.number().int().positive(),
  code: z.string().max(50).optional(),
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  addressLine1: z.string().max(500).optional(),
  addressLine2: z.string().max(500).optional(),
  district: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  vendorType: vendorTypeEnum.optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  creditLimit: z.number().min(0).optional(),
  openingBalance: z.number().optional(),
  notes: z.string().max(2000).optional(),
});

/** Accept number, numeric string, "", null, undefined; coerce ""/undefined -> null, "30" -> 30. */
const optionalNullableNumCoerce = (s: z.ZodNumber) =>
  z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v))
    .pipe(s.nullable());
/** Accept number, numeric string, "", undefined; coerce ""/undefined -> undefined (omit). */
const optionalNumCoerce = (s: z.ZodNumber) =>
  z
    .union([z.literal(""), z.undefined(), z.coerce.number()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v))
    .pipe(s.optional());

export const updateVendorSchema = z.object({
  code: z.string().max(50).optional().nullable(),
  name: z.string().min(1).max(255).optional(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable().or(z.literal("")),
  addressLine1: z.string().max(500).optional().nullable(),
  addressLine2: z.string().max(500).optional().nullable(),
  district: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  vendorType: vendorTypeEnum.optional().nullable(),
  defaultPaymentTermsDays: optionalNullableNumCoerce(z.number().int().min(0).max(365)).optional(),
  creditLimit: optionalNullableNumCoerce(z.number().min(0)).optional(),
  openingBalance: optionalNumCoerce(z.number()).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const vendorStatusSchema = z.object({
  status: vendorStatusEnum,
});

export const addAttachmentSchema = z.object({
  fileKey: z.string().min(1),
  type: attachmentTypeEnum.optional(),
  note: z.string().max(500).optional(),
});

export type CreateVendorDto = z.infer<typeof createVendorSchema>;
export type UpdateVendorDto = z.infer<typeof updateVendorSchema>;
export type VendorStatusDto = z.infer<typeof vendorStatusSchema>;
export type AddAttachmentDto = z.infer<typeof addAttachmentSchema>;
