/**
 * Campaign included vaccines — branded display for landing / booking pages.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import { CampaignErrors, ValidationErrors } from "./campaign.errors";
import { logCampaignAudit } from "./campaign.service";

export type CampaignIncludedVaccineDto = {
  id: number;
  name: string;
  description: string | null;
  coveredDiseases: string[];
  displayOrder: number;
};

function normalizeDiseases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0);
}

export function mapIncludedVaccineRow(row: {
  id: number;
  name: string;
  description: string | null;
  coveredDiseases: unknown;
  displayOrder: number;
}): CampaignIncludedVaccineDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coveredDiseases: normalizeDiseases(row.coveredDiseases),
    displayOrder: row.displayOrder,
  };
}

export const includedVaccineInclude = {
  where: { isActive: true },
  orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
};

export async function listIncludedVaccinesForCampaign(
  campaignId: number,
  options?: { includeInactive?: boolean }
) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) throw CampaignErrors.NOT_FOUND(campaignId);

  const rows = await prisma.campaignIncludedVaccine.findMany({
    where: {
      campaignId,
      ...(options?.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
  });

  return rows.map(mapIncludedVaccineRow);
}

export async function createIncludedVaccine(
  campaignId: number,
  input: {
    name: string;
    description?: string | null;
    coveredDiseases: string[];
    displayOrder?: number;
  },
  actorUserId?: number
) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw CampaignErrors.NOT_FOUND(campaignId);

  const maxOrder = await prisma.campaignIncludedVaccine.aggregate({
    where: { campaignId },
    _max: { displayOrder: true },
  });
  const displayOrder =
    input.displayOrder ?? (maxOrder._max.displayOrder != null ? maxOrder._max.displayOrder + 1 : 0);

  const row = await prisma.campaignIncludedVaccine.create({
    data: {
      campaignId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      coveredDiseases: input.coveredDiseases as Prisma.InputJsonValue,
      displayOrder,
    },
  });

  await logCampaignAudit({
    campaignId,
    actorUserId,
    action: "INCLUDED_VACCINE_CREATED",
    entityType: "CampaignIncludedVaccine",
    entityId: row.id,
    afterJson: mapIncludedVaccineRow(row) as unknown as Record<string, unknown>,
  });

  return mapIncludedVaccineRow(row);
}

export async function updateIncludedVaccine(
  id: number,
  input: {
    name?: string;
    description?: string | null;
    coveredDiseases?: string[];
    displayOrder?: number;
    isActive?: boolean;
  },
  actorUserId?: number
) {
  const existing = await prisma.campaignIncludedVaccine.findUnique({ where: { id } });
  if (!existing) {
    throw CampaignErrors.NOT_FOUND(id);
  }

  const row = await prisma.campaignIncludedVaccine.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.coveredDiseases !== undefined
        ? { coveredDiseases: input.coveredDiseases as Prisma.InputJsonValue }
        : {}),
      ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  await logCampaignAudit({
    campaignId: existing.campaignId,
    actorUserId,
    action: "INCLUDED_VACCINE_UPDATED",
    entityType: "CampaignIncludedVaccine",
    entityId: row.id,
    afterJson: mapIncludedVaccineRow(row) as unknown as Record<string, unknown>,
  });

  return mapIncludedVaccineRow(row);
}

export async function deleteIncludedVaccine(id: number, actorUserId?: number) {
  const existing = await prisma.campaignIncludedVaccine.findUnique({ where: { id } });
  if (!existing) {
    throw CampaignErrors.NOT_FOUND(id);
  }

  await prisma.campaignIncludedVaccine.delete({ where: { id } });

  await logCampaignAudit({
    campaignId: existing.campaignId,
    actorUserId,
    action: "INCLUDED_VACCINE_DELETED",
    entityType: "CampaignIncludedVaccine",
    entityId: id,
    beforeJson: mapIncludedVaccineRow(existing) as unknown as Record<string, unknown>,
  });

  return { deleted: true };
}

export async function reorderIncludedVaccines(
  campaignId: number,
  orderedIds: number[],
  actorUserId?: number
) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw CampaignErrors.NOT_FOUND(campaignId);

  const rows = await prisma.campaignIncludedVaccine.findMany({
    where: { campaignId },
    select: { id: true },
  });
  const validIds = new Set(rows.map((r) => r.id));
  if (orderedIds.length !== validIds.size || orderedIds.some((id) => !validIds.has(id))) {
    throw ValidationErrors.INVALID_INPUT(
      "orderedIds must list every included vaccine for this campaign exactly once"
    );
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.campaignIncludedVaccine.update({
        where: { id },
        data: { displayOrder: index },
      })
    )
  );

  await logCampaignAudit({
    campaignId,
    actorUserId,
    action: "INCLUDED_VACCINES_REORDERED",
    entityType: "Campaign",
    entityId: campaignId,
    afterJson: { orderedIds },
  });

  return listIncludedVaccinesForCampaign(campaignId, { includeInactive: true });
}
