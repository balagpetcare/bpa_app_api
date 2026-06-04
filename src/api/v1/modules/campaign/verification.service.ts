/**
 * Campaign Verification Service
 * Public certificate verification endpoints
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { validateCertificateQr } from "./qr.service";
import { getCertificateData, CertificateData } from "./certificate.service";
import { CertificateErrors } from "./campaign.errors";
import { formatDate } from "./campaign.utils";

// ============================================================================
// Types
// ============================================================================

export interface VerificationResult {
  valid: boolean;
  status: "VALID" | "EXPIRED" | "NOT_FOUND" | "INVALID";
  certificate?: {
    token: string;
    petName: string;
    animalType: string;
    breed?: string;
    ownerName?: string;
    vaccineType: string;
    vaccinatedAt: string;
    validUntil: string;
    isExpired: boolean;
    daysRemaining: number;
    location: string;
    campaignName: string;
  };
  message?: string;
}

// ============================================================================
// Certificate Verification
// ============================================================================

/**
 * Verify a certificate by token or QR URL
 */
export async function verifyCertificate(
  tokenOrUrl: string
): Promise<VerificationResult> {
  // Try QR validation first
  const qrResult = await validateCertificateQr(tokenOrUrl);

  if (qrResult.valid && qrResult.certificate) {
    const cert = qrResult.certificate;
    const now = new Date();
    const validUntil = new Date(cert.validUntil);
    const isExpired = validUntil < now;
    const daysRemaining = Math.ceil(
      (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      valid: !isExpired,
      status: isExpired ? "EXPIRED" : "VALID",
      certificate: {
        token: cert.token,
        petName: cert.petName,
        animalType: "", // Not in QR result
        vaccineType: cert.vaccineType,
        vaccinatedAt: formatDate(cert.vaccinatedAt),
        validUntil: formatDate(cert.validUntil),
        isExpired,
        daysRemaining: Math.max(0, daysRemaining),
        location: "",
        campaignName: "BPA Vaccination Campaign",
      },
      message: isExpired
        ? "This certificate has expired. Please revaccinate."
        : `Valid certificate. ${daysRemaining} days until expiry.`,
    };
  }

  // Try direct token lookup
  const certData = await getCertificateData(tokenOrUrl);

  if (!certData) {
    return {
      valid: false,
      status: "NOT_FOUND",
      message: "Certificate not found. Please check the token and try again.",
    };
  }

  const now = new Date();
  const validUntil = new Date(certData.validUntil);
  const isExpired = validUntil < now;
  const daysRemaining = Math.ceil(
    (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    valid: !isExpired,
    status: isExpired ? "EXPIRED" : "VALID",
    certificate: {
      token: certData.certificateToken,
      petName: certData.petName,
      animalType: certData.animalType,
      breed: certData.breed,
      ownerName: certData.ownerName || undefined,
      vaccineType: certData.vaccineType,
      vaccinatedAt: formatDate(certData.vaccinatedAt),
      validUntil: formatDate(certData.validUntil),
      isExpired,
      daysRemaining: Math.max(0, daysRemaining),
      location: certData.location,
      campaignName: certData.campaignName,
    },
    message: isExpired
      ? "This certificate has expired. Please revaccinate."
      : `Valid certificate. ${daysRemaining} days until expiry.`,
  };
}

/**
 * Verify certificate by manual entry (short code)
 */
export async function verifyByShortCode(code: string): Promise<VerificationResult> {
  // Remove common separators and normalize
  const normalizedCode = code.replace(/[-\s]/g, "").toUpperCase();

  // Try as full token first
  if (normalizedCode.startsWith("CERT-")) {
    return verifyCertificate(normalizedCode);
  }

  // Search for matching certificate token
  const pet = await prisma.campaignPet.findFirst({
    where: {
      certificateToken: { startsWith: normalizedCode },
    },
    select: { certificateToken: true },
  });

  if (pet?.certificateToken) {
    return verifyCertificate(pet.certificateToken);
  }

  // Try vaccination records
  const vaccination = await prisma.vaccination.findFirst({
    where: {
      certificateToken: { startsWith: normalizedCode },
    },
    select: { certificateToken: true },
  });

  if (vaccination?.certificateToken) {
    return verifyCertificate(vaccination.certificateToken);
  }

  return {
    valid: false,
    status: "NOT_FOUND",
    message: "Certificate not found. Please check the code and try again.",
  };
}

// ============================================================================
// Verification Statistics
// ============================================================================

/**
 * Log a verification attempt for analytics
 */
export async function logVerificationAttempt(
  certificateToken: string,
  result: "VALID" | "EXPIRED" | "NOT_FOUND" | "INVALID",
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    source?: "QR" | "MANUAL" | "API";
  }
): Promise<void> {
  // Log to audit if certificate found
  const pet = await prisma.campaignPet.findFirst({
    where: { certificateToken },
    select: {
      booking: { select: { campaignId: true } },
    },
  });

  if (pet) {
    await prisma.campaignAuditLog.create({
      data: {
        campaignId: pet.booking.campaignId,
        action: "CERTIFICATE_VERIFIED",
        entityType: "Certificate",
        metadataJson: {
          token: certificateToken,
          result,
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      },
    });
  }
}

/**
 * Get verification statistics for a campaign
 */
export async function getVerificationStats(campaignId: number) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const stats = await prisma.campaignAuditLog.groupBy({
    by: ["action"],
    where: {
      campaignId,
      action: "CERTIFICATE_VERIFIED",
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: true,
  });

  const validCount = await prisma.campaignAuditLog.count({
    where: {
      campaignId,
      action: "CERTIFICATE_VERIFIED",
      createdAt: { gte: thirtyDaysAgo },
      metadataJson: { path: ["result"], equals: "VALID" },
    },
  });

  const totalVerifications = stats.reduce((sum, s) => sum + s._count, 0);

  return {
    totalVerifications,
    validVerifications: validCount,
    last30Days: {
      total: totalVerifications,
      valid: validCount,
    },
  };
}

// ============================================================================
// Public API Endpoints (to be used in routes)
// ============================================================================

/**
 * Handle public verification request
 */
export async function handleVerificationRequest(
  token: string,
  options?: {
    ipAddress?: string;
    userAgent?: string;
    source?: "QR" | "MANUAL" | "API";
  }
): Promise<VerificationResult> {
  const result = await verifyCertificate(token);

  // Log the attempt (async, don't wait)
  logVerificationAttempt(token, result.status, options).catch((err) => {
    console.warn("Failed to log verification attempt:", err);
  });

  return result;
}

export default {
  verifyCertificate,
  verifyByShortCode,
  logVerificationAttempt,
  getVerificationStats,
  handleVerificationRequest,
};
