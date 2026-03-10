/**
 * Doctor verification: create/update draft, add documents, submit.
 * Admin: list, get one, approve, reject.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

const DOCTOR_DOC_TYPES = new Set([
  "DOCTOR_REGISTRATION",
  "DOCTOR_DEGREE",
  "NID_FRONT",
  "NID_BACK",
  "DOCTOR_PHOTO",
  "VET_LICENSE",
  "VET_DEGREE",
  "GOV_ID_FRONT",
  "GOV_ID_BACK",
  "PROFILE_PHOTO",
  "SPECIALIZATION_CERT",
  "DEA_REGISTRATION",
  "CPD_CERTIFICATE",
  "GOOD_STANDING_LETTER",
  "PRACTICE_PERMIT",
  "LIABILITY_INSURANCE",
  "ADDITIONAL",
]);

async function getByUserId(userId: number) {
  return prisma.doctorVerification.findUnique({
    where: { userId },
    include: {
      documents: true,
      licenses: {
        include: {
          regulatoryBody: { include: { country: { select: { code: true, name: true, region: true } } } },
          documents: true,
        },
      },
    },
  });
}

async function upsertDraft(
  userId: number,
  data: {
    licenseNumber?: string | null;
    registrationBody?: string | null;
    primaryCountryCode?: string | null;
    specializationTags?: string[] | null;
    qualifications?: object[] | null;
    nidNumber?: string | null;
    metadataJson?: object | null;
  }
) {
  const payload: any = {
    licenseNumber: data.licenseNumber != null ? String(data.licenseNumber).trim() || null : undefined,
    registrationBody: data.registrationBody != null ? String(data.registrationBody).trim() || null : undefined,
    primaryCountryCode: data.primaryCountryCode != null ? String(data.primaryCountryCode).trim().toUpperCase() || null : undefined,
    specializationTags: Array.isArray(data.specializationTags) ? data.specializationTags : undefined,
    qualifications: Array.isArray(data.qualifications) ? data.qualifications : undefined,
    nidNumber: data.nidNumber != null ? String(data.nidNumber).trim() || null : undefined,
    metadataJson: data.metadataJson != null && typeof data.metadataJson === "object" ? data.metadataJson : undefined,
  };
  // Only update if status allows (UNSUBMITTED or REJECTED can edit)
  const existing = await prisma.doctorVerification.findUnique({ where: { userId } });
  if (existing && existing.verificationStatus !== "UNSUBMITTED" && existing.verificationStatus !== "REJECTED") {
    return existing;
  }

  return prisma.doctorVerification.upsert({
    where: { userId },
    create: {
      userId,
      verificationStatus: "UNSUBMITTED",
      ...payload,
    },
    update: payload,
    include: { documents: true, licenses: { include: { regulatoryBody: { include: { country: true } }, documents: true } } },
  });
}

function validateDocumentType(type: string): boolean {
  return DOCTOR_DOC_TYPES.has(String(type).trim().toUpperCase());
}

export async function addDocument(
  userId: number,
  documentType: string,
  fileUrl: string,
  metadataJson?: object | null,
  doctorLicenseId?: number | null
) {
  const verification = await prisma.doctorVerification.findUnique({ where: { userId } });
  if (!verification) {
    throw new Error("Doctor verification record not found. Save draft first.");
  }
  if (verification.verificationStatus !== "UNSUBMITTED" && verification.verificationStatus !== "REJECTED") {
    throw new Error("Cannot add documents after submission.");
  }
  const type = String(documentType).trim().toUpperCase();
  if (!DOCTOR_DOC_TYPES.has(type)) {
    throw new Error(`Invalid document type. Allowed: ${[...DOCTOR_DOC_TYPES].join(", ")}`);
  }
  if (doctorLicenseId != null) {
    const license = await prisma.doctorLicense.findFirst({
      where: { id: doctorLicenseId, doctorVerificationId: verification.id },
    });
    if (!license) throw new Error("License not found or does not belong to this verification.");
  }

  return prisma.doctorVerificationDocument.create({
    data: {
      doctorVerificationId: verification.id,
      doctorLicenseId: doctorLicenseId && Number.isFinite(doctorLicenseId) ? doctorLicenseId : null,
      documentType: type,
      fileUrl,
      metadataJson: metadataJson != null && typeof metadataJson === "object" ? metadataJson : undefined,
    },
  });
}

async function deleteDocument(userId: number, documentId: number) {
  const doc = await prisma.doctorVerificationDocument.findFirst({
    where: {
      id: documentId,
      doctorVerification: { userId },
    },
  });
  if (!doc) return null;
  await prisma.doctorVerificationDocument.delete({ where: { id: documentId } });
  return doc;
}

// ---------- License CRUD ----------
async function addLicense(
  userId: number,
  data: {
    regulatoryBodyId: number;
    licenseNumber: string;
    issueDate?: Date | null;
    expiryDate?: Date | null;
    isPrimary?: boolean;
  }
) {
  const verification = await prisma.doctorVerification.findUnique({ where: { userId } });
  if (!verification) throw new Error("Doctor verification record not found. Save draft first.");
  if (verification.verificationStatus !== "UNSUBMITTED" && verification.verificationStatus !== "REJECTED") {
    throw new Error("Cannot add licenses after submission.");
  }
  const body = await prisma.vetRegulatoryBody.findUnique({ where: { id: data.regulatoryBodyId, isActive: true } });
  if (!body) throw new Error("Regulatory body not found.");
  const existing = await prisma.doctorLicense.findUnique({
    where: {
      doctorVerificationId_regulatoryBodyId: {
        doctorVerificationId: verification.id,
        regulatoryBodyId: data.regulatoryBodyId,
      },
    },
  });
  if (existing) throw new Error("A license for this regulatory body is already added.");

  return prisma.doctorLicense.create({
    data: {
      doctorVerificationId: verification.id,
      regulatoryBodyId: data.regulatoryBodyId,
      licenseNumber: String(data.licenseNumber).trim(),
      issueDate: data.issueDate ?? null,
      expiryDate: data.expiryDate ?? null,
      isPrimary: data.isPrimary ?? false,
      licenseStatus: "ACTIVE",
    },
    include: { regulatoryBody: { include: { country: true } }, documents: true },
  });
}

async function updateLicense(
  userId: number,
  licenseId: number,
  data: {
    licenseNumber?: string;
    issueDate?: Date | null;
    expiryDate?: Date | null;
    licenseStatus?: string;
    isPrimary?: boolean;
  }
) {
  const license = await prisma.doctorLicense.findFirst({
    where: { id: licenseId, doctorVerification: { userId } },
  });
  if (!license) return null;
  const verification = await prisma.doctorVerification.findUnique({ where: { userId } });
  if (verification?.verificationStatus !== "UNSUBMITTED" && verification?.verificationStatus !== "REJECTED") {
    throw new Error("Cannot update licenses after submission.");
  }

  return prisma.doctorLicense.update({
    where: { id: licenseId },
    data: {
      licenseNumber: data.licenseNumber != null ? String(data.licenseNumber).trim() : undefined,
      issueDate: data.issueDate !== undefined ? data.issueDate : undefined,
      expiryDate: data.expiryDate !== undefined ? data.expiryDate : undefined,
      licenseStatus: data.licenseStatus ?? undefined,
      isPrimary: data.isPrimary !== undefined ? data.isPrimary : undefined,
    },
    include: { regulatoryBody: { include: { country: true } }, documents: true },
  });
}

async function deleteLicense(userId: number, licenseId: number) {
  const license = await prisma.doctorLicense.findFirst({
    where: { id: licenseId, doctorVerification: { userId } },
  });
  if (!license) return null;
  const verification = await prisma.doctorVerification.findUnique({ where: { userId } });
  if (verification?.verificationStatus !== "UNSUBMITTED" && verification?.verificationStatus !== "REJECTED") {
    throw new Error("Cannot remove licenses after submission.");
  }
  await prisma.doctorLicense.delete({ where: { id: licenseId } });
  return license;
}

async function submit(userId: number) {
  const verification = await prisma.doctorVerification.findUnique({
    where: { userId },
    include: { documents: true, licenses: { include: { documents: true } } },
  });
  if (!verification) {
    throw new Error("Doctor verification record not found. Save draft first.");
  }
  if (verification.verificationStatus !== "UNSUBMITTED" && verification.verificationStatus !== "REJECTED") {
    throw new Error("Already submitted.");
  }
  // New path: at least one DoctorLicense with licenseNumber and at least one doc for that license or at verification level
  const hasLicenses = (verification.licenses?.length ?? 0) > 0;
  const verificationLevelDocs = (verification.documents || []).filter((d) => !d.doctorLicenseId);
  const hasLicenseWithDoc =
    hasLicenses &&
    verification.licenses.some((l) => {
      if (!l.licenseNumber) return false;
      const licenseDocCount = (l.documents?.length ?? 0);
      const verificationVetDoc = verificationLevelDocs.some(
        (d) => d.documentType === "VET_LICENSE" || d.documentType === "DOCTOR_REGISTRATION" || d.documentType === "VET_DEGREE" || d.documentType === "DOCTOR_DEGREE"
      );
      return licenseDocCount > 0 || verificationVetDoc;
    });
  const hasLegacy =
    verification.licenseNumber &&
    verification.documents.some(
      (d) => d.documentType === "DOCTOR_REGISTRATION" || d.documentType === "DOCTOR_DEGREE" || d.documentType === "VET_LICENSE" || d.documentType === "VET_DEGREE"
    );
  if (!hasLicenseWithDoc && !hasLegacy) {
    throw new Error("Add at least one license with license number and upload at least one of: registration, degree, or vet license document.");
  }

  return prisma.doctorVerification.update({
    where: { userId },
    data: {
      verificationStatus: "SUBMITTED",
      submittedAt: new Date(),
      reviewNote: null,
    },
    include: { documents: true, licenses: { include: { regulatoryBody: true, documents: true } } },
  });
}

// ---------- Admin ----------
async function listForAdmin(opts: {
  status?: string;
  search?: string;
  country?: string;
  bodyId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};
  if (opts.status) where.verificationStatus = opts.status;
  if (opts.country) where.primaryCountryCode = String(opts.country).trim().toUpperCase();
  if (opts.bodyId != null && Number.isFinite(opts.bodyId)) {
    where.licenses = { some: { regulatoryBodyId: Number(opts.bodyId) } };
  }
  if (opts.dateFrom || opts.dateTo) {
    where.submittedAt = {};
    if (opts.dateFrom) where.submittedAt.gte = opts.dateFrom;
    if (opts.dateTo) where.submittedAt.lte = opts.dateTo;
  }
  if (opts.search) {
    const search = String(opts.search).trim();
    const numericSearch = Number(search);
    const or: any[] = [
      { licenseNumber: { contains: search, mode: "insensitive" } },
      { registrationBody: { contains: search, mode: "insensitive" } },
      { nidNumber: { contains: search, mode: "insensitive" } },
      { user: { is: { auth: { is: { email: { contains: search, mode: "insensitive" } } } } } },
      { user: { is: { auth: { is: { phone: { contains: search, mode: "insensitive" } } } } } },
      { licenses: { some: { licenseNumber: { contains: search, mode: "insensitive" } } } },
      { licenses: { some: { regulatoryBody: { is: { name: { contains: search, mode: "insensitive" } } } } } },
      { licenses: { some: { regulatoryBody: { is: { abbreviation: { contains: search, mode: "insensitive" } } } } } },
    ];
    if (Number.isFinite(numericSearch)) {
      or.push({ id: Number(numericSearch) });
      or.push({ userId: Number(numericSearch) });
    }
    where.OR = or;
  }
  const [rows, total] = await Promise.all([
    prisma.doctorVerification.findMany({
      where,
      include: {
        user: { select: { id: true, status: true, auth: true } },
        documents: true,
        licenses: {
          include: {
            regulatoryBody: { select: { id: true, name: true, abbreviation: true, countryId: true, verificationUrl: true } },
            documents: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: opts.limit ?? 100,
      skip: opts.offset ?? 0,
    }),
    prisma.doctorVerification.count({ where }),
  ]);
  return { rows, total };
}

async function getByIdForAdmin(id: number) {
  return prisma.doctorVerification.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, status: true, auth: true } },
      documents: true,
      licenses: {
        include: {
          regulatoryBody: {
            include: { country: { select: { code: true, name: true, region: true } }, requiredDocTypes: true },
          },
          documents: true,
        },
      },
      reviewedByAdmin: { select: { id: true, auth: true } },
    },
  });
}

async function approve(id: number, adminUserId: number | null) {
  return prisma.doctorVerification.update({
    where: { id },
    data: {
      verificationStatus: "VERIFIED",
      reviewedAt: new Date(),
      reviewedByAdminId: adminUserId,
      reviewNote: null,
    },
    include: { user: true, documents: true },
  });
}

async function reject(id: number, adminUserId: number | null, reviewNote: string) {
  return prisma.doctorVerification.update({
    where: { id },
    data: {
      verificationStatus: "REJECTED",
      reviewedAt: new Date(),
      reviewedByAdminId: adminUserId,
      reviewNote: reviewNote || null,
    },
    include: { user: true, documents: true },
  });
}

async function getVerificationStatusForUser(userId: number) {
  const row = await prisma.doctorVerification.findUnique({
    where: { userId },
    select: { verificationStatus: true },
  });
  return row?.verificationStatus ?? null;
}

module.exports = {
  getByUserId,
  upsertDraft,
  validateDocumentType,
  addDocument,
  deleteDocument,
  addLicense,
  updateLicense,
  deleteLicense,
  submit,
  listForAdmin,
  getByIdForAdmin,
  approve,
  reject,
  getVerificationStatusForUser,
  DOCTOR_DOC_TYPES,
};
