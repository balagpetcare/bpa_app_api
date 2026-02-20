/**
 * Producer KYC service: VerificationCase (PRODUCER_ORG) + ProducerOrgDocument.
 * Replaces docsJson-only flow; backward compatible with legacy submitKyc.
 */

const prisma = require("../../../../infrastructure/db/prismaClient");

/** Doc types allowed for Producer KYC upload */
export const PRODUCER_KYC_ALLOWED_DOC_TYPES = [
  "NID_FRONT",
  "NID_BACK",
  "SELFIE_WITH_NID",
  "TRADE_LICENSE",
  "INCORPORATION_CERT",
  "OTHER",
] as const;

/** Business-proof: at least one required for submit */
export const PRODUCER_KYC_BUSINESS_DOC_TYPES = ["TRADE_LICENSE", "INCORPORATION_CERT", "OTHER"];

/** Identity: at least one required for submit */
export const PRODUCER_KYC_IDENTITY_DOC_TYPES = ["NID_FRONT", "SELFIE_WITH_NID"];

/** MIME types allowed for Producer KYC documents (images + PDF) */
export const PRODUCER_KYC_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export function getAllowedMimes(): string[] {
  return [...PRODUCER_KYC_ALLOWED_MIMES];
}

export function isAllowedMime(mime: string): boolean {
  const n = String(mime || "").toLowerCase().trim();
  return PRODUCER_KYC_ALLOWED_MIMES.some((a) => a === n);
}

export function isAllowedDocType(type: string): boolean {
  const t = String(type || "").toUpperCase().trim();
  return (PRODUCER_KYC_ALLOWED_DOC_TYPES as readonly string[]).includes(t);
}

export async function getProducerOrgByUser(userId: number) {
  return prisma.producerOrg.findFirst({
    where: { ownerUserId: userId },
    select: { id: true, name: true, status: true },
  });
}

/**
 * Get or create VerificationCase for PRODUCER_ORG.
 * @param createIfRejected - when true and latest case is REJECTED, create new DRAFT for re-submit (used by upload/submit)
 */
export async function getOrCreateProducerVerificationCase(
  producerOrgId: number,
  options?: { createIfRejected?: boolean }
) {
  const existing = await prisma.verificationCase.findFirst({
    where: { entityType: "PRODUCER_ORG", entityId: producerOrgId },
    orderBy: { createdAt: "desc" },
    include: { documents: { include: { media: true } } },
  });
  if (existing && existing.status !== "REJECTED") return existing;
  if (existing?.status === "REJECTED" && options?.createIfRejected) {
    return prisma.verificationCase.create({
      data: {
        entityType: "PRODUCER_ORG",
        entityId: producerOrgId,
        status: "DRAFT",
      },
      include: { documents: { include: { media: true } } },
    });
  }
  if (existing) return existing;

  return prisma.verificationCase.create({
    data: {
      entityType: "PRODUCER_ORG",
      entityId: producerOrgId,
      status: "DRAFT",
    },
    include: { documents: { include: { media: true } } },
  });
}

/** Compute missing required doc types for submit. */
export function getMissingDocTypes(docTypesPresent: string[]): string[] {
  const set = new Set(docTypesPresent.map((t) => String(t).toUpperCase()));
  const missing: string[] = [];
  const hasBusiness = PRODUCER_KYC_BUSINESS_DOC_TYPES.some((t) => set.has(t));
  const hasIdentity = PRODUCER_KYC_IDENTITY_DOC_TYPES.some((t) => set.has(t));
  if (!hasBusiness) missing.push("One of: TRADE_LICENSE, INCORPORATION_CERT, OTHER");
  if (!hasIdentity) missing.push("One of: NID_FRONT, SELFIE_WITH_NID");
  return missing;
}

/** GET /api/v1/producer/kyc/status shape */
export async function getProducerKycStatus(userId: number): Promise<{
  producerOrgId: number | null;
  verificationCaseId: number | null;
  status: string;
  missingDocs: string[];
  canSubmit: boolean;
  documents: Array<{ id: number; docType: string; status: string; mediaId: number }>;
  legacyStatus?: string;
}> {
  const org = await getProducerOrgByUser(userId);
  if (!org) {
    return {
      producerOrgId: null,
      verificationCaseId: null,
      status: "NO_ORG",
      missingDocs: ["One of: TRADE_LICENSE, INCORPORATION_CERT, OTHER", "One of: NID_FRONT, SELFIE_WITH_NID"],
      canSubmit: false,
      documents: [],
    };
  }

  const vc = await getOrCreateProducerVerificationCase(org.id);
  const docTypes = (vc.documents || []).map((d: { docType: string }) => d.docType);
  const missingDocs = getMissingDocTypes(docTypes);
  const canSubmit =
    vc.status === "DRAFT" && missingDocs.length === 0 && (vc.documents?.length ?? 0) > 0;

  return {
    producerOrgId: org.id,
    verificationCaseId: vc.id,
    status: vc.status,
    missingDocs,
    canSubmit,
    documents: (vc.documents || []).map((d: { id: number; docType: string; status: string; mediaId: number }) => ({
      id: d.id,
      docType: d.docType,
      status: d.status,
      mediaId: d.mediaId,
    })),
    legacyStatus: org.status,
  };
}

/** Submit Producer KYC: set VerificationCase to SUBMITTED. If latest case is REJECTED, create new DRAFT and submit. */
export async function submitProducerKyc(userId: number): Promise<{ verificationCase: any }> {
  const org = await getProducerOrgByUser(userId);
  if (!org) {
    const err = new Error("Producer org not found");
    (err as any).statusCode = 404;
    throw err;
  }

  let vc = await getOrCreateProducerVerificationCase(org.id);
  if (vc.status === "SUBMITTED") {
    return { verificationCase: vc };
  }
  if (vc.status === "APPROVED") {
    const err = new Error("Already approved");
    (err as any).statusCode = 400;
    throw err;
  }
  if (vc.status === "REJECTED") {
    // Re-submit: create new DRAFT case and use it
    vc = await prisma.verificationCase.create({
      data: {
        entityType: "PRODUCER_ORG",
        entityId: org.id,
        status: "DRAFT",
      },
      include: { documents: { include: { media: true } } },
    });
  }

  const docTypes = (vc.documents || []).map((d: { docType: string }) => d.docType);
  const missingDocs = getMissingDocTypes(docTypes);
  if (missingDocs.length > 0) {
    const err = new Error(`Missing required documents: ${missingDocs.join("; ")}`);
    (err as any).statusCode = 400;
    throw err;
  }
  if ((vc.documents?.length ?? 0) === 0) {
    const err = new Error("At least one document is required");
    (err as any).statusCode = 400;
    throw err;
  }

  const updated = await prisma.verificationCase.update({
    where: { id: vc.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
    include: { documents: { include: { media: true } } },
  });

  await prisma.verificationCaseEvent.create({
    data: {
      caseId: updated.id,
      action: "SUBMIT",
      from: vc.status,
      to: "SUBMITTED",
    },
  });

  return { verificationCase: updated };
}

module.exports = {
  PRODUCER_KYC_ALLOWED_DOC_TYPES,
  PRODUCER_KYC_BUSINESS_DOC_TYPES,
  PRODUCER_KYC_IDENTITY_DOC_TYPES,
  PRODUCER_KYC_ALLOWED_MIMES,
  getAllowedMimes,
  isAllowedMime,
  isAllowedDocType,
  getProducerOrgByUser,
  getOrCreateProducerVerificationCase,
  getMissingDocTypes,
  getProducerKycStatus,
  submitProducerKyc,
};
