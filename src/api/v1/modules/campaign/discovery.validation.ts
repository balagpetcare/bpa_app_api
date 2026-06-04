import { z } from "zod";

export const discoveryWindowSchema = z.enum(["today", "this_week", "this_month"]);

export const upcomingCampaignsQuerySchema = z.object({
  window: discoveryWindowSchema.default("this_week"),
  campaignId: z.coerce.number().int().optional(),
  campaignSlug: z.string().optional(),
});

export const locatorSearchSchema = z.object({
  campaignId: z.coerce.number().int().optional(),
  campaignSlug: z.string().optional(),
  divisionId: z.coerce.number().int().optional(),
  districtId: z.coerce.number().int().optional(),
  district: z.string().max(200).optional(),
  city: z.string().max(200).optional(),
  area: z.string().max(200).optional(),
  postalCode: z.string().max(20).optional(),
  upazilaId: z.coerce.number().int().optional(),
});

export const discoveryScheduleQuerySchema = z.object({
  campaignId: z.coerce.number().int().optional(),
  campaignSlug: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  divisionId: z.coerce.number().int().optional(),
  districtId: z.coerce.number().int().optional(),
  upazilaId: z.coerce.number().int().optional(),
});

export const bdAreasQuerySchema = z.object({
  districtId: z.coerce.number().int().optional(),
  upazilaId: z.coerce.number().int().optional(),
  q: z.string().max(100).optional(),
});
