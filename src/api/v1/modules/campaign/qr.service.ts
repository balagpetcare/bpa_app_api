/**
 * Campaign QR Code Service
 * Generates and validates QR codes for bookings and certificates
 */

import { createHash, createHmac } from "crypto";
import QRCode from "qrcode";
import prisma from "../../../../infrastructure/db/prismaClient";
import { getBookingByQrToken, getBookingByRef } from "./booking.service";
import { getBookingCheckInBlockReason } from "./campaign.paymentGuards";

// Configuration
const QR_SECRET = process.env.CAMPAIGN_QR_SECRET || process.env.JWT_SECRET || "campaign-qr-secret";
const QR_VERSION = "1"; // Increment when changing QR format
const BASE_URL = process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";

// ============================================================================
// QR Data Format
// ============================================================================

export interface BookingQrData {
  type: "booking";
  version: string;
  token: string;
  ref: string;
  checksum: string;
}

export interface CertificateQrData {
  type: "certificate";
  version: string;
  token: string;
  petName: string;
  date: string;
  checksum: string;
}

// ============================================================================
// QR Code Generation
// ============================================================================

/**
 * Generate QR code image for a booking
 * Returns base64 encoded PNG image
 */
export async function generateBookingQr(
  bookingId: number,
  options?: { size?: number; format?: "png" | "svg" }
): Promise<{ qrData: string; qrImage: string }> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    select: {
      qrToken: true,
      bookingRef: true,
    },
  });

  if (!booking) {
    throw new Error("Booking not found");
  }

  // Create QR data payload
  const qrData: BookingQrData = {
    type: "booking",
    version: QR_VERSION,
    token: booking.qrToken,
    ref: booking.bookingRef,
    checksum: generateChecksum(booking.qrToken),
  };

  // Generate QR URL (for scanning apps)
  const qrUrl = `${BASE_URL}/checkin/${booking.qrToken}`;

  // Generate QR code image
  const size = options?.size ?? 300;
  const qrImage = await QRCode.toDataURL(qrUrl, {
    errorCorrectionLevel: "M",
    width: size,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
  });

  return {
    qrData: JSON.stringify(qrData),
    qrImage,
  };
}

/**
 * Generate QR code for a vaccination certificate
 */
export async function generateCertificateQr(
  certificateToken: string,
  petName: string,
  vaccinationDate: Date,
  options?: { size?: number }
): Promise<{ qrData: string; qrImage: string }> {
  const qrData: CertificateQrData = {
    type: "certificate",
    version: QR_VERSION,
    token: certificateToken,
    petName,
    date: vaccinationDate.toISOString().split("T")[0],
    checksum: generateChecksum(certificateToken),
  };

  // Generate verification URL
  const qrUrl = `${BASE_URL}/verify/${certificateToken}`;

  const size = options?.size ?? 200;
  const qrImage = await QRCode.toDataURL(qrUrl, {
    errorCorrectionLevel: "H", // High error correction for certificates
    width: size,
    margin: 2,
    color: {
      dark: "#1a5f2a", // Green for certificates
      light: "#FFFFFF",
    },
  });

  return {
    qrData: JSON.stringify(qrData),
    qrImage,
  };
}

/**
 * Generate QR code as SVG
 */
export async function generateQrSvg(
  data: string,
  options?: { size?: number; color?: string }
): Promise<string> {
  return QRCode.toString(data, {
    type: "svg",
    errorCorrectionLevel: "M",
    width: options?.size ?? 200,
    margin: 1,
    color: {
      dark: options?.color ?? "#000000",
      light: "#FFFFFF",
    },
  });
}

// ============================================================================
// QR Code Validation
// ============================================================================

/**
 * Validate and decode a QR token
 */
export async function validateBookingQr(
  tokenOrUrl: string
): Promise<{
  valid: boolean;
  booking?: Awaited<ReturnType<typeof getBookingByQrToken>>;
  error?: string;
}> {
  try {
    // Extract token from URL if needed
    let token = tokenOrUrl;
    if (tokenOrUrl.includes("/")) {
      const match = tokenOrUrl.match(/\/checkin\/([a-f0-9]{32})/i);
      if (match) {
        token = match[1];
      }
    }

    // Validate token format
    if (!/^[a-f0-9]{32}$/i.test(token)) {
      return { valid: false, error: "Invalid QR code format" };
    }

    // Look up booking
    const booking = await getBookingByQrToken(token);

    const blockReason = getBookingCheckInBlockReason({
      status: booking.status as any,
      paymentStatus: booking.paymentStatus as any,
    });
    if (blockReason) {
      return { valid: false, error: blockReason };
    }

    return { valid: true, booking };
  } catch (error) {
    return {
      valid: false,
      error: (error as Error).message || "QR validation failed",
    };
  }
}

/**
 * Validate certificate QR
 */
export async function validateCertificateQr(
  tokenOrUrl: string
): Promise<{
  valid: boolean;
  certificate?: {
    token: string;
    petName: string;
    vaccinatedAt: Date;
    vaccineType: string;
    validUntil: Date;
  };
  error?: string;
}> {
  try {
    // Extract token from URL if needed
    let token = tokenOrUrl;
    if (tokenOrUrl.includes("/")) {
      const match = tokenOrUrl.match(/\/verify\/([A-Z0-9-]+)/i);
      if (match) {
        token = match[1];
      }
    }

    // Look up certificate
    const campaignPet = await prisma.campaignPet.findFirst({
      where: { certificateToken: token.toUpperCase() },
      include: {
        vaccination: {
          include: { vaccineType: true },
        },
      },
    });

    if (!campaignPet || !campaignPet.vaccination) {
      // Try looking up in permanent vaccination records
      const vaccination = await prisma.vaccination.findFirst({
        where: { certificateToken: token.toUpperCase() },
        include: {
          vaccineType: true,
          pet: true,
        },
      });

      if (!vaccination) {
        return { valid: false, error: "Certificate not found" };
      }

      return {
        valid: true,
        certificate: {
          token: vaccination.certificateToken!,
          petName: vaccination.pet.name,
          vaccinatedAt: vaccination.administeredAt,
          vaccineType: vaccination.vaccineType.name,
          validUntil: vaccination.nextDueDate ?? new Date(vaccination.administeredAt.getTime() + 365 * 24 * 60 * 60 * 1000),
        },
      };
    }

    const vacc = campaignPet.vaccination;
    return {
      valid: true,
      certificate: {
        token: campaignPet.certificateToken!,
        petName: campaignPet.name,
        vaccinatedAt: vacc.administeredAt,
        vaccineType: vacc.vaccineType.name,
        validUntil: vacc.nextDueDate ?? new Date(vacc.administeredAt.getTime() + 365 * 24 * 60 * 60 * 1000),
      },
    };
  } catch (error) {
    return {
      valid: false,
      error: (error as Error).message || "Certificate validation failed",
    };
  }
}

// ============================================================================
// Token Utilities
// ============================================================================

/**
 * Generate checksum for token verification
 */
function generateChecksum(token: string): string {
  return createHmac("sha256", QR_SECRET)
    .update(token)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Verify checksum
 */
export function verifyChecksum(token: string, checksum: string): boolean {
  return generateChecksum(token) === checksum;
}

/**
 * Generate a short verification code from token
 * Used for manual entry when QR scanning fails
 */
export function generateVerificationCode(token: string): string {
  const hash = createHash("sha256").update(token + QR_SECRET).digest("hex");
  // Take first 8 chars, convert to uppercase, format as XXXX-XXXX
  const code = hash.slice(0, 8).toUpperCase();
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

/**
 * Find booking by verification code
 */
export async function findByVerificationCode(code: string): Promise<{
  found: boolean;
  booking?: Awaited<ReturnType<typeof getBookingByRef>>;
}> {
  // Remove dashes and normalize
  const normalizedCode = code.replace(/-/g, "").toUpperCase();

  // Search recent bookings (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const bookings = await prisma.campaignBooking.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo },
    },
    select: {
      id: true,
      qrToken: true,
      bookingRef: true,
    },
  });

  // Find matching booking
  for (const booking of bookings) {
    const expectedCode = generateVerificationCode(booking.qrToken).replace(/-/g, "");
    if (expectedCode === normalizedCode) {
      return {
        found: true,
        booking: await getBookingByRef(booking.bookingRef),
      };
    }
  }

  return { found: false };
}

// ============================================================================
// Batch QR Generation
// ============================================================================

/**
 * Generate QR codes for multiple bookings (for print batches)
 */
export async function generateBatchQrCodes(
  bookingIds: number[],
  options?: { size?: number }
): Promise<Array<{
  bookingId: number;
  bookingRef: string;
  ownerName: string;
  qrImage: string;
}>> {
  const results = [];

  for (const bookingId of bookingIds) {
    try {
      const booking = await prisma.campaignBooking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          bookingRef: true,
          ownerName: true,
          qrToken: true,
        },
      });

      if (!booking) continue;

      const { qrImage } = await generateBookingQr(bookingId, options);

      results.push({
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        ownerName: booking.ownerName,
        qrImage,
      });
    } catch (error) {
      console.error(`Failed to generate QR for booking ${bookingId}:`, error);
    }
  }

  return results;
}

export default {
  generateBookingQr,
  generateCertificateQr,
  generateQrSvg,
  validateBookingQr,
  validateCertificateQr,
  verifyChecksum,
  generateVerificationCode,
  findByVerificationCode,
  generateBatchQrCodes,
};
