import { prisma } from "../../lib/prisma";
import type { Prisma } from "@prisma/client";

type DraftInput = {
  businessName: string;
  nidNumber: string;
  tradeLicenseNo?: string;
  docsJson?: any;
};

export async function getMyApplication(userId: number) {
  return prisma.partnerApplication.findFirst({ where: { userId }, orderBy: { id: "desc" as const } });
}

export async function getOrCreateDraft(userId: number) {
  let item = await prisma.partnerApplication.findFirst({ where: { userId, status: "NOT_APPLIED" as any } });
  if (!item) {
    item = await prisma.partnerApplication.create({
      data: {
        userId,
        status: "NOT_APPLIED" as any,
        businessName: "Draft",
        nidNumber: "N/A",
        tradeLicenseNo: null,
        docsJson: {},
      } as any,
    });
  }
  return item;
}

export async function saveDraft(userId: number, input: Partial<DraftInput>) {
  const item = await getOrCreateDraft(userId);
  return prisma.partnerApplication.update({
    where: { id: item.id },
    data: {
      businessName: input.businessName ?? item.businessName,
      nidNumber: input.nidNumber ?? item.nidNumber,
      tradeLicenseNo: input.tradeLicenseNo ?? item.tradeLicenseNo,
      docsJson: input.docsJson ?? item.docsJson,
    } as any,
  });
}

export async function submit(userId: number) {
  const item = await getOrCreateDraft(userId);
  return prisma.partnerApplication.update({
    where: { id: item.id },
    data: { status: "PENDING_REVIEW" as any, submittedAt: new Date() } as any,
  });
}


export async function createOrGetDraft(userId: number, body: Partial<DraftInput>) {
  // create draft if missing, then apply incoming data
  await getOrCreateDraft(userId);
  return saveDraft(userId, body || {});
}

export async function listMine(userId: number) {
  return prisma.partnerApplication.findMany({ where: { userId }, orderBy: { id: "desc" as const } });
}

export async function getOneMine(userId: number, id: any) {
  const pid = Number(id);
  return prisma.partnerApplication.findFirst({ where: { id: pid, userId } });
}

export async function updateDraftMine(userId: number, id: any, body: Partial<DraftInput>) {
  const pid = Number(id);
  const item = await prisma.partnerApplication.findFirst({ where: { id: pid, userId } });
  if (!item) throw Object.assign(new Error("Application not found"), { statusCode: 404 });
  // allow update only when still draft-ish
  return prisma.partnerApplication.update({
    where: { id: pid },
    data: {
      businessName: body.businessName ?? item.businessName,
      nidNumber: body.nidNumber ?? item.nidNumber,
      tradeLicenseNo: body.tradeLicenseNo ?? item.tradeLicenseNo,
      docsJson: body.docsJson ?? item.docsJson,
    } as any,
  });
}

export async function submitMine(userId: number, id: any) {
  const pid = Number(id);
  const item = await prisma.partnerApplication.findFirst({ where: { id: pid, userId } });
  if (!item) throw Object.assign(new Error("Application not found"), { statusCode: 404 });
  return prisma.partnerApplication.update({
    where: { id: pid },
    data: { status: "PENDING_REVIEW" as any, submittedAt: new Date() } as any,
  });
}
