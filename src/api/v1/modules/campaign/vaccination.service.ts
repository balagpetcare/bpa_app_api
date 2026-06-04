/**
 * Campaign Vaccination Service
 * Records vaccinations and generates certificates
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import {
  RecordVaccinationInput,
  VaccinationResult,
} from "./campaign.types";
import {
  PetErrors,
  BookingErrors,
  CertificateErrors,
  PaymentErrors,
} from "./campaign.errors";
import {
  generateCertificateToken,
  addDays,
} from "./campaign.utils";
import { logCampaignAudit } from "./campaign.service";
import { completeBooking } from "./booking.service";
import { sendVaccinationComplete } from "./sms.service";
import { getVaccinationPaymentBlockReason } from "./campaign.paymentGuards";

// ============================================================================
// Vaccination Recording
// ============================================================================

/**
 * Record a vaccination for a campaign pet
 * Creates a permanent vaccination record and links it to the campaign pet
 */
export async function recordVaccination(
  input: RecordVaccinationInput
): Promise<VaccinationResult> {
  // Get campaign pet with booking info
  const campaignPet = await prisma.campaignPet.findUnique({
    where: { id: input.campaignPetId },
    include: {
      booking: {
        include: {
          campaign: true,
          location: true,
        },
      },
    },
  });

  if (!campaignPet) {
    throw PetErrors.NOT_FOUND(input.campaignPetId);
  }

  // Validate booking status
  const booking = campaignPet.booking;
  if (!["CHECKED_IN", "IN_PROGRESS"].includes(booking.status)) {
    throw PetErrors.NOT_CHECKED_IN();
  }

  const paymentBlock = getVaccinationPaymentBlockReason(booking.paymentStatus);
  if (paymentBlock) {
    throw PaymentErrors.REQUIRED();
  }

  // Check if already vaccinated
  if (campaignPet.vaccinationStatus === "COMPLETED") {
    throw PetErrors.ALREADY_VACCINATED();
  }

  // Generate certificate token
  const certificateToken = generateCertificateToken();

  // Get vaccine type for next due date calculation
  const vaccineType = await prisma.vaccineType.findUnique({
    where: { id: input.vaccineTypeId },
  });

  const nextDueDate = vaccineType
    ? addDays(new Date(), vaccineType.defaultIntervalDays)
    : addDays(new Date(), 365);

  // Transaction: Create vaccination record and update campaign pet
  const result = await prisma.$transaction(async (tx) => {
    // Create or get permanent pet record
    let permanentPetId = campaignPet.permanentPetId;

    if (!permanentPetId && booking.ownerUserId) {
      // Create permanent pet record for linked user
      const permanentPet = await tx.pet.create({
        data: {
          userId: booking.ownerUserId,
          animalTypeId: campaignPet.animalTypeId,
          breedId: campaignPet.breedId,
          name: campaignPet.name,
          sex: campaignPet.gender ?? "UNKNOWN",
        },
      });
      permanentPetId = permanentPet.id;

      // Link campaign pet to permanent pet
      await tx.campaignPet.update({
        where: { id: campaignPet.id },
        data: { permanentPetId },
      });
    }

    // Create vaccination record
    // If no permanent pet, create a minimal record that can be linked later
    const vaccination = await tx.vaccination.create({
      data: {
        petId: permanentPetId ?? 0, // Will need to handle this specially if no user account
        vaccineTypeId: input.vaccineTypeId,
        administeredAt: new Date(),
        nextDueDate,
        batchNumber: input.batchNumber,
        manufacturer: input.lotNumber,
        notes: input.notes,
        certificateToken,
        status: "ACTIVE",
        campaignBookingId: booking.id,
        administeredByUserId: input.administeredByUserId,
        // Set clinic info from campaign location
        vetClinic: booking.location.name,
      },
    });

    // Update campaign pet status
    await tx.campaignPet.update({
      where: { id: campaignPet.id },
      data: {
        vaccinationStatus: "COMPLETED",
        vaccinationId: vaccination.id,
        certificateToken,
        certificateGeneratedAt: new Date(),
      },
    });

    // Update booking status to IN_PROGRESS if this is first pet
    if (booking.status === "CHECKED_IN") {
      await tx.campaignBooking.update({
        where: { id: booking.id },
        data: { status: "IN_PROGRESS" },
      });
    }

    // Check if all pets are done
    const remainingPets = await tx.campaignPet.count({
      where: {
        bookingId: booking.id,
        vaccinationStatus: "PENDING",
      },
    });

    // Update vaccine dose count if tracked
    await tx.campaignVaccineType.updateMany({
      where: {
        campaignId: booking.campaignId,
        vaccineTypeId: input.vaccineTypeId,
      },
      data: {
        usedDoses: { increment: 1 },
      },
    });

    // Audit log
    await tx.campaignAuditLog.create({
      data: {
        campaignId: booking.campaignId,
        actorUserId: input.administeredByUserId,
        action: "VACCINATION_RECORDED",
        entityType: "CampaignPet",
        entityId: campaignPet.id,
        afterJson: {
          vaccinationId: vaccination.id,
          vaccineTypeId: input.vaccineTypeId,
          batchNumber: input.batchNumber,
          certificateToken,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      vaccination,
      remainingPets,
    };
  });

  // Auto-complete booking if all pets done
  if (result.remainingPets === 0) {
    try {
      await completeBooking(booking.id, input.administeredByUserId);
    } catch (e) {
      // Log but don't fail if auto-complete fails
      console.warn("Auto-complete booking failed:", e);
    }
  }

  if (certificateToken) {
    const base = process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";
    const certUrl = `${base}/api/v1/campaign/public/certificates/${certificateToken}`;
    sendVaccinationComplete(booking.id, certUrl).catch((err) =>
      console.warn("[Campaign] vaccination complete SMS failed:", err?.message)
    );
  }

  return {
    success: true,
    vaccinationId: result.vaccination.id,
    certificateToken,
  };
}

/**
 * Defer vaccination for a pet (health concerns, etc.)
 */
export async function deferVaccination(
  campaignPetId: number,
  reason: string,
  staffUserId: number
): Promise<void> {
  const campaignPet = await prisma.campaignPet.findUnique({
    where: { id: campaignPetId },
    include: { booking: true },
  });

  if (!campaignPet) {
    throw PetErrors.NOT_FOUND(campaignPetId);
  }

  await prisma.campaignPet.update({
    where: { id: campaignPetId },
    data: { vaccinationStatus: "DEFERRED" },
  });

  await logCampaignAudit({
    campaignId: campaignPet.booking.campaignId,
    actorUserId: staffUserId,
    action: "VACCINATION_DEFERRED",
    entityType: "CampaignPet",
    entityId: campaignPetId,
    afterJson: { reason },
  });
}

/**
 * Skip vaccination for a pet
 */
export async function skipVaccination(
  campaignPetId: number,
  reason: string,
  staffUserId: number
): Promise<void> {
  const campaignPet = await prisma.campaignPet.findUnique({
    where: { id: campaignPetId },
    include: { booking: true },
  });

  if (!campaignPet) {
    throw PetErrors.NOT_FOUND(campaignPetId);
  }

  await prisma.campaignPet.update({
    where: { id: campaignPetId },
    data: { vaccinationStatus: "SKIPPED" },
  });

  await logCampaignAudit({
    campaignId: campaignPet.booking.campaignId,
    actorUserId: staffUserId,
    action: "VACCINATION_SKIPPED",
    entityType: "CampaignPet",
    entityId: campaignPetId,
    afterJson: { reason },
  });
}

// ============================================================================
// Vaccination Lookup
// ============================================================================

/**
 * Get vaccination details by campaign pet ID
 */
export async function getVaccinationByPetId(campaignPetId: number) {
  const pet = await prisma.campaignPet.findUnique({
    where: { id: campaignPetId },
    include: {
      vaccination: {
        include: {
          vaccineType: true,
        },
      },
      booking: {
        include: {
          location: true,
          campaign: true,
        },
      },
    },
  });

  if (!pet) {
    throw PetErrors.NOT_FOUND(campaignPetId);
  }

  return pet;
}

/**
 * Get vaccination statistics for a campaign
 */
export async function getVaccinationStats(campaignId: number) {
  const [total, byStatus, byVaccineType] = await Promise.all([
    // Total pets
    prisma.campaignPet.count({
      where: { booking: { campaignId } },
    }),
    
    // By status
    prisma.campaignPet.groupBy({
      by: ["vaccinationStatus"],
      where: { booking: { campaignId } },
      _count: true,
    }),
    
    // By vaccine type (completed only)
    prisma.$queryRaw<Array<{ vaccineTypeId: number; name: string; count: bigint }>>`
      SELECT v."vaccineTypeId", vt.name, COUNT(*) as count
      FROM campaign_pets cp
      JOIN campaign_bookings cb ON cp."bookingId" = cb.id
      JOIN vaccinations v ON cp."vaccinationId" = v.id
      JOIN vaccine_types vt ON v."vaccineTypeId" = vt.id
      WHERE cb."campaignId" = ${campaignId}
      AND cp."vaccinationStatus" = 'COMPLETED'
      GROUP BY v."vaccineTypeId", vt.name
    `,
  ]);

  const statusMap = new Map(byStatus.map((s) => [s.vaccinationStatus, s._count]));

  return {
    total,
    pending: statusMap.get("PENDING") ?? 0,
    inProgress: statusMap.get("IN_PROGRESS") ?? 0,
    completed: statusMap.get("COMPLETED") ?? 0,
    deferred: statusMap.get("DEFERRED") ?? 0,
    skipped: statusMap.get("SKIPPED") ?? 0,
    byVaccineType: byVaccineType.map((v) => ({
      vaccineTypeId: v.vaccineTypeId,
      name: v.name,
      count: Number(v.count),
    })),
  };
}

export default {
  recordVaccination,
  deferVaccination,
  skipVaccination,
  getVaccinationByPetId,
  getVaccinationStats,
};
