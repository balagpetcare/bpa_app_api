/**
 * Campaign Certificate Service
 * Generates vaccination certificates (PDF and digital)
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { generateCertificateQr } from "./qr.service";
import { generateCertificateToken, formatDate, addDays } from "./campaign.utils";
import { CertificateErrors } from "./campaign.errors";

// ============================================================================
// Types
// ============================================================================

export interface CertificateData {
  certificateToken: string;
  petName: string;
  ownerName: string;
  ownerPhone: string;
  animalType: string;
  breed?: string;
  vaccineType: string;
  vaccinatedAt: Date;
  validUntil: Date;
  batchNumber?: string;
  administeredBy?: string;
  location: string;
  campaignName: string;
  qrCodeImage: string;
  issuedAt: Date;
}

export interface CertificateGenerationResult {
  success: boolean;
  token?: string;
  pdfUrl?: string;
  error?: string;
}

// ============================================================================
// Certificate Generation
// ============================================================================

/**
 * Generate certificate for a vaccinated pet
 */
export async function generateCertificate(
  campaignPetId: number
): Promise<CertificateGenerationResult> {
  // Get pet with all related data
  const pet = await prisma.campaignPet.findUnique({
    where: { id: campaignPetId },
    include: {
      booking: {
        include: {
          campaign: true,
          location: true,
        },
      },
      animalType: true,
      breed: true,
      vaccination: {
        include: {
          vaccineType: true,
        },
      },
    },
  });

  if (!pet) {
    return { success: false, error: "Pet not found" };
  }

  if (pet.vaccinationStatus !== "COMPLETED") {
    return { success: false, error: "Pet vaccination not completed" };
  }

  // Check if certificate already exists
  if (pet.certificateToken) {
    return {
      success: true,
      token: pet.certificateToken,
    };
  }

  // Generate certificate token
  const token = generateCertificateToken();

  // Calculate validity
  const vaccinatedAt = pet.vaccination?.administeredAt ?? new Date();
  const validUntil = pet.vaccination?.nextDueDate ?? addDays(vaccinatedAt, 365);

  // Generate QR code
  const { qrImage } = await generateCertificateQr(
    token,
    pet.name,
    vaccinatedAt
  );

  // Update pet with certificate token
  await prisma.campaignPet.update({
    where: { id: campaignPetId },
    data: {
      certificateToken: token,
      certificateGeneratedAt: new Date(),
    },
  });

  // Also update the vaccination record if it exists
  if (pet.vaccinationId) {
    await prisma.vaccination.update({
      where: { id: pet.vaccinationId },
      data: { certificateToken: token },
    });
  }

  return {
    success: true,
    token,
  };
}

/**
 * Get certificate data for PDF generation
 */
export async function getCertificateData(
  certificateToken: string
): Promise<CertificateData | null> {
  // Find by campaign pet token
  let pet = await prisma.campaignPet.findFirst({
    where: { certificateToken: certificateToken.toUpperCase() },
    include: {
      booking: {
        include: {
          campaign: true,
          location: true,
        },
      },
      animalType: true,
      breed: true,
      vaccination: {
        include: {
          vaccineType: true,
        },
      },
    },
  });

  if (!pet) {
    // Try finding by vaccination certificate token
    const vaccination = await prisma.vaccination.findFirst({
      where: { certificateToken: certificateToken.toUpperCase() },
      include: {
        pet: {
          include: {
            animalType: true,
            breed: true,
          },
        },
        vaccineType: true,
      },
    });

    if (!vaccination) {
      return null;
    }

    // Return data from permanent vaccination record
    const { qrImage } = await generateCertificateQr(
      vaccination.certificateToken!,
      vaccination.pet.name,
      vaccination.administeredAt
    );

    return {
      certificateToken: vaccination.certificateToken!,
      petName: vaccination.pet.name,
      ownerName: "", // Not available in permanent record
      ownerPhone: "",
      animalType: vaccination.pet.animalType.name,
      breed: vaccination.pet.breed?.name,
      vaccineType: vaccination.vaccineType.name,
      vaccinatedAt: vaccination.administeredAt,
      validUntil: vaccination.nextDueDate ?? addDays(vaccination.administeredAt, 365),
      batchNumber: vaccination.batchNumber ?? undefined,
      location: vaccination.vetClinic ?? "BPA Vaccination Campaign",
      campaignName: "BPA Vaccination Campaign",
      qrCodeImage: qrImage,
      issuedAt: vaccination.createdAt,
    };
  }

  // Return data from campaign pet
  const { qrImage } = await generateCertificateQr(
    pet.certificateToken!,
    pet.name,
    pet.vaccination?.administeredAt ?? new Date()
  );

  return {
    certificateToken: pet.certificateToken!,
    petName: pet.name,
    ownerName: pet.booking.ownerName,
    ownerPhone: pet.booking.ownerPhone,
    animalType: pet.animalType.name,
    breed: pet.breed?.name,
    vaccineType: pet.vaccination?.vaccineType.name ?? "Unknown",
    vaccinatedAt: pet.vaccination?.administeredAt ?? new Date(),
    validUntil: pet.vaccination?.nextDueDate ?? addDays(new Date(), 365),
    batchNumber: pet.vaccination?.batchNumber ?? undefined,
    location: pet.booking.location.name,
    campaignName: pet.booking.campaign.name,
    qrCodeImage: qrImage,
    issuedAt: pet.certificateGeneratedAt ?? new Date(),
  };
}

/**
 * Generate PDF certificate
 * Returns PDF as base64 string
 */
export async function generateCertificatePdf(
  certificateToken: string
): Promise<{ pdf: string; filename: string } | null> {
  const data = await getCertificateData(certificateToken);
  
  if (!data) {
    return null;
  }

  // Generate HTML template
  const html = generateCertificateHtml(data);

  // Convert to PDF using available library
  try {
    const puppeteer = require("puppeteer");
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
    });
    
    await browser.close();

    const filename = `certificate-${data.certificateToken}.pdf`;
    const pdf = pdfBuffer.toString("base64");

    return { pdf, filename };
  } catch (error) {
    console.error("PDF generation failed:", error);
    
    // Fallback: return HTML template for client-side PDF generation
    return null;
  }
}

/**
 * Generate certificate HTML template
 */
function generateCertificateHtml(data: CertificateData): string {
  const validUntilDate = formatDate(data.validUntil);
  const vaccinatedDate = formatDate(data.vaccinatedAt);
  const issuedDate = formatDate(data.issuedAt);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Vaccination Certificate - ${data.certificateToken}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .certificate {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border: 3px solid #1a5f2a;
      border-radius: 10px;
      padding: 40px;
      position: relative;
    }
    .certificate::before {
      content: '';
      position: absolute;
      top: 10px;
      left: 10px;
      right: 10px;
      bottom: 10px;
      border: 2px solid #1a5f2a;
      border-radius: 6px;
      pointer-events: none;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      width: 80px;
      height: 80px;
      margin-bottom: 15px;
    }
    .title {
      font-size: 28px;
      color: #1a5f2a;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .subtitle {
      font-size: 18px;
      color: #666;
    }
    .divider {
      border-bottom: 2px solid #1a5f2a;
      margin: 20px 0;
    }
    .content {
      display: flex;
      gap: 30px;
    }
    .details {
      flex: 1;
    }
    .qr-section {
      width: 200px;
      text-align: center;
    }
    .qr-code {
      width: 180px;
      height: 180px;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
    .qr-label {
      font-size: 12px;
      color: #888;
      margin-top: 10px;
    }
    .field {
      margin-bottom: 15px;
    }
    .field-label {
      font-size: 12px;
      color: #888;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .field-value {
      font-size: 16px;
      color: #333;
      font-weight: 500;
    }
    .highlight {
      background: #e8f5e9;
      padding: 15px;
      border-radius: 8px;
      margin-top: 20px;
    }
    .validity {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
    }
    .validity-item {
      text-align: center;
      padding: 10px 20px;
      background: #f5f5f5;
      border-radius: 5px;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
    }
    .certificate-id {
      font-family: monospace;
      font-size: 14px;
      color: #666;
      letter-spacing: 2px;
    }
    .verification-note {
      font-size: 12px;
      color: #888;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="header">
      <div class="title">VACCINATION CERTIFICATE</div>
      <div class="subtitle">${data.campaignName}</div>
    </div>
    
    <div class="divider"></div>
    
    <div class="content">
      <div class="details">
        <div class="field">
          <div class="field-label">Pet Name</div>
          <div class="field-value">${data.petName}</div>
        </div>
        
        <div class="field">
          <div class="field-label">Animal Type</div>
          <div class="field-value">${data.animalType}${data.breed ? ` (${data.breed})` : ''}</div>
        </div>
        
        <div class="field">
          <div class="field-label">Owner</div>
          <div class="field-value">${data.ownerName || 'N/A'}</div>
        </div>
        
        <div class="highlight">
          <div class="field">
            <div class="field-label">Vaccine Administered</div>
            <div class="field-value">${data.vaccineType}</div>
          </div>
          ${data.batchNumber ? `
          <div class="field">
            <div class="field-label">Batch Number</div>
            <div class="field-value">${data.batchNumber}</div>
          </div>
          ` : ''}
          <div class="field">
            <div class="field-label">Location</div>
            <div class="field-value">${data.location}</div>
          </div>
        </div>
        
        <div class="validity">
          <div class="validity-item">
            <div class="field-label">Vaccinated On</div>
            <div class="field-value">${vaccinatedDate}</div>
          </div>
          <div class="validity-item">
            <div class="field-label">Valid Until</div>
            <div class="field-value">${validUntilDate}</div>
          </div>
        </div>
      </div>
      
      <div class="qr-section">
        <img src="${data.qrCodeImage}" alt="QR Code" class="qr-code" />
        <div class="qr-label">Scan to verify</div>
      </div>
    </div>
    
    <div class="footer">
      <div class="certificate-id">${data.certificateToken}</div>
      <div class="verification-note">
        Verify this certificate at: https://vaccine.bpa.org.bd/verify/${data.certificateToken}
      </div>
      <div class="verification-note">
        Issued on ${issuedDate} by Bangladesh Pet Association
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

// ============================================================================
// Batch Certificate Generation
// ============================================================================

/**
 * Generate certificates for all completed vaccinations in a booking
 */
export async function generateBookingCertificates(
  bookingId: number
): Promise<string[]> {
  const pets = await prisma.campaignPet.findMany({
    where: {
      bookingId,
      vaccinationStatus: "COMPLETED",
      certificateToken: null,
    },
  });

  const tokens: string[] = [];

  for (const pet of pets) {
    const result = await generateCertificate(pet.id);
    if (result.success && result.token) {
      tokens.push(result.token);
    }
  }

  return tokens;
}

/**
 * Get all certificates for a booking
 */
export async function getBookingCertificates(bookingId: number) {
  const pets = await prisma.campaignPet.findMany({
    where: {
      bookingId,
      certificateToken: { not: null },
    },
    select: {
      id: true,
      name: true,
      certificateToken: true,
      certificateGeneratedAt: true,
      vaccination: {
        select: {
          vaccineType: { select: { name: true } },
          administeredAt: true,
          nextDueDate: true,
        },
      },
    },
  });

  return pets.map((pet) => ({
    petId: pet.id,
    petName: pet.name,
    certificateToken: pet.certificateToken,
    generatedAt: pet.certificateGeneratedAt,
    vaccineType: pet.vaccination?.vaccineType.name,
    vaccinatedAt: pet.vaccination?.administeredAt,
    validUntil: pet.vaccination?.nextDueDate,
    verifyUrl: `https://vaccine.bpa.org.bd/verify/${pet.certificateToken}`,
    downloadUrl: `https://vaccine.bpa.org.bd/api/certificates/${pet.certificateToken}/pdf`,
  }));
}

export default {
  generateCertificate,
  getCertificateData,
  generateCertificatePdf,
  generateBookingCertificates,
  getBookingCertificates,
};
