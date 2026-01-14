import { prisma } from "../../lib/prisma";

type DraftInput = {
  businessType?: "PET_SHOP" | "CLINIC" | "BOTH";
  orgName?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  description?: string;
  addressLine?: string;
};

const ALLOWED = new Set([
  "businessType",
  "orgName",
  "contactName",
  "contactPhone",
  "contactEmail",
  "description",
  "addressLine",
]);

function pickPatch(input: any) {
  const out: any = {};
  for (const k of Object.keys(input || {})) if (ALLOWED.has(k)) out[k] = input[k];
  return out;
}

export async function createOrGetDraft(applicantId: number, input: DraftInput) {
  const existing = await prisma.partnerApplication.findFirst({
    where: { applicantId, status: "DRAFT" },
    orderBy: { id: "desc" },
  });
  if (existing) return existing;

  return prisma.partnerApplication.create({
    data: { applicantId, status: "DRAFT", ...pickPatch(input) },
  });
}

export async function listMine(applicantId: number) {
  return prisma.partnerApplication.findMany({
    where: { applicantId },
    orderBy: { id: "desc" },
  });
}

export async function getOneMine(applicantId: number, id: number) {
  const item = await prisma.partnerApplication.findFirst({ where: { id, applicantId } });
  if (!item) {
    const e: any = new Error("Not found");
    e.statusCode = 404;
    throw e;
  }
  return item;
}

export async function updateDraftMine(applicantId: number, id: number, patch: DraftInput) {
  const item = await prisma.partnerApplication.findFirst({ where: { id, applicantId } });
  if (!item) {
    const e: any = new Error("Not found");
    e.statusCode = 404;
    throw e;
  }
  if (item.status !== "DRAFT") {
    const e: any = new Error("Only DRAFT can be updated");
    e.statusCode = 400;
    throw e;
  }

  return prisma.partnerApplication.update({
    where: { id },
    data: pickPatch(patch),
  });
}

function assertRequired(item: any) {
  const missing: string[] = [];
  if (!item.orgName) missing.push("orgName");
  if (!item.contactName) missing.push("contactName");
  if (!item.contactPhone) missing.push("contactPhone");
  if (missing.length) {
    const e: any = new Error("Missing required fields: " + missing.join(", "));
    e.statusCode = 400;
    throw e;
  }
}

export async function submitMine(applicantId: number, id: number) {
  const item = await prisma.partnerApplication.findFirst({ where: { id, applicantId } });
  if (!item) {
    const e: any = new Error("Not found");
    e.statusCode = 404;
    throw e;
  }
  if (item.status !== "DRAFT") {
    const e: any = new Error("Only DRAFT can be submitted");
    e.statusCode = 400;
    throw e;
  }

  assertRequired(item);

  return prisma.partnerApplication.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
}
