import prisma from "../../../../infrastructure/db/prismaClient";

export async function assertOrg(userId: number, orgId: number) {
  const owner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId }, select: { id: true } });
  if (owner) return;
  const m = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" } });
  if (!m) throw new Error("Forbidden: org access");
}

export async function createCampaign(params: {
  orgId: number;
  title: string;
  externalRef?: string;
  severity: "STANDARD" | "URGENT" | "CRITICAL";
  metaJson?: object;
  createdByUserId: number;
}) {
  return prisma.recallCampaign.create({
    data: {
      orgId: params.orgId,
      title: params.title,
      externalRef: params.externalRef,
      severity: params.severity,
      metaJson: params.metaJson as any,
      createdByUserId: params.createdByUserId,
    },
    include: {
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

export async function listCampaigns(orgId: number) {
  return prisma.recallCampaign.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { recalls: true } },
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

export async function attachRecallToCampaign(params: { orgId: number; campaignId: number; recallId: number }) {
  const camp = await prisma.recallCampaign.findFirst({
    where: { id: params.campaignId, orgId: params.orgId },
    select: { id: true },
  });
  if (!camp) throw new Error("Campaign not found");
  const rec = await prisma.batchRecall.findFirst({
    where: { id: params.recallId, orgId: params.orgId },
    select: { id: true, campaignId: true },
  });
  if (!rec) throw new Error("Recall not found");
  return prisma.batchRecall.update({
    where: { id: params.recallId },
    data: { campaignId: params.campaignId },
    include: {
      lot: { select: { id: true, lotCode: true, variantId: true } },
      campaign: { select: { id: true, title: true, status: true } },
    },
  });
}

export async function getCampaignDetail(orgId: number, campaignId: number) {
  return prisma.recallCampaign.findFirst({
    where: { id: campaignId, orgId },
    include: {
      recalls: {
        include: {
          lot: { select: { id: true, lotCode: true, expDate: true, variant: { select: { sku: true, title: true } } } },
          initiatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        },
      },
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}
