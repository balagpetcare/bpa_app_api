import { z } from "zod";
import { dateSchema, phoneSchema } from "./campaign.validation";

export const createRolloutPhaseSchema = z.object({
  campaignId: z.number().int(),
  phaseCode: z.enum(["PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4"]),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["PLANNED", "ACTIVE", "COMPLETED"]).optional(),
  sortOrder: z.number().int().optional(),
  nationwideGoalPets: z.number().int().min(0).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
});

export const updateRolloutPhaseSchema = createRolloutPhaseSchema.partial().omit({
  campaignId: true,
  phaseCode: true,
});

export const createRolloutRegionSchema = z.object({
  phaseId: z.number().int(),
  campaignId: z.number().int(),
  divisionId: z.number().int().optional().nullable(),
  districtId: z.number().int().optional().nullable(),
  upazilaId: z.number().int().optional().nullable(),
  city: z.string().max(200).optional(),
  venueName: z.string().max(200).optional(),
  venueAddress: z.string().max(500).optional(),
  locationId: z.number().int().optional().nullable(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  targetCapacity: z.number().int().min(0),
  isActive: z.boolean().optional(),
});

export const updateRolloutRegionSchema = createRolloutRegionSchema.partial().omit({
  phaseId: true,
  campaignId: true,
});

export const preRegisterSchema = z.object({
  campaignId: z.number().int().optional(),
  campaignSlug: z.string().optional(),
  divisionId: z.number().int(),
  districtId: z.number().int(),
  upazilaId: z.number().int(),
  phone: phoneSchema,
  catCount: z.number().int().min(1).max(10),
});

export const areaCheckSchema = z.object({
  campaignId: z.number().int().optional(),
  campaignSlug: z.string().optional(),
  divisionId: z.number().int(),
  districtId: z.number().int().optional(),
  upazilaId: z.number().int().optional(),
});

export const notifyPreRegisteredSchema = z.object({
  regionId: z.number().int().optional(),
  phaseId: z.number().int().optional(),
  campaignId: z.number().int(),
});
