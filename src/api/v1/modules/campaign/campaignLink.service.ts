/**
 * Campaign Link Service — BPA app authenticated access to vaccination campaign data.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { normalizePhone } from "./campaign.utils";
import { getBookingsByPhone } from "./booking.service";
import { getCertificateData } from "./certificate.service";

async function getUserPhone(userId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { auth: { select: { phone: true } } },
  });
  const phone = user?.auth?.phone;
  return phone ? normalizePhone(phone) : null;
}

function bookingWhereForUser(userId: number, phone: string | null) {
  const or: Array<Record<string, unknown>> = [{ ownerUserId: userId }];
  if (phone) {
    or.push({ ownerPhone: phone });
  }
  return { OR: or };
}

export async function getCampaignLinkSummary(userId: number) {
  const phone = await getUserPhone(userId);

  const unlinkedWhere = phone
    ? { ownerPhone: phone, ownerUserId: null }
    : { ownerUserId: null, id: -1 };

  const [unlinkedCount, linkedBookings, completedVaccinations] = await Promise.all([
    prisma.campaignBooking.count({ where: unlinkedWhere }),
    prisma.campaignBooking.count({ where: bookingWhereForUser(userId, phone) }),
    prisma.campaignPet.count({
      where: {
        vaccinationStatus: "COMPLETED",
        booking: bookingWhereForUser(userId, phone),
      },
    }),
  ]);

  return {
    hasUnlinkedRecords: unlinkedCount > 0,
    unlinkedBookings: unlinkedCount,
    linkedBookings,
    vaccinations: completedVaccinations,
    phone,
  };
}

export async function getMyCampaignBookings(userId: number) {
  const phone = await getUserPhone(userId);
  if (phone) {
    return getBookingsByPhone(phone);
  }

  const bookings = await prisma.campaignBooking.findMany({
    where: { ownerUserId: userId },
    include: {
      slot: true,
      location: true,
      campaign: { select: { id: true, name: true, slug: true } },
      pets: { orderBy: { id: "asc" } },
    },
    orderBy: { bookingDate: "desc" },
  });

  return bookings.map((b) => ({
    id: b.id,
    bookingRef: b.bookingRef,
    qrToken: b.qrToken,
    status: b.status,
    bookingDate: b.bookingDate,
    campaign: b.campaign,
    slot: { startTime: b.slot.startTime, endTime: b.slot.endTime },
    location: { id: b.location.id, name: b.location.name, address: b.location.address },
    owner: { phone: b.ownerPhone, name: b.ownerName },
    pets: b.pets.map((p) => ({
      id: p.id,
      name: p.name,
      vaccinationStatus: p.vaccinationStatus,
      certificateToken: p.certificateToken,
    })),
    paymentStatus: b.paymentStatus,
    checkedInAt: b.checkedInAt,
    completedAt: b.completedAt,
  }));
}

export async function getVaccinationRecords(userId: number) {
  const phone = await getUserPhone(userId);
  const bookingFilter = bookingWhereForUser(userId, phone);

  const campaignPets = await prisma.campaignPet.findMany({
    where: {
      vaccinationStatus: "COMPLETED",
      booking: bookingFilter,
    },
    include: {
      booking: {
        include: {
          campaign: { select: { id: true, name: true } },
          location: { select: { name: true } },
        },
      },
      animalType: { select: { name: true } },
      breed: { select: { name: true } },
      vaccination: {
        include: { vaccineType: { select: { name: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const petVaccinations = await prisma.vaccination.findMany({
    where: {
      pet: { userId, deleted: false },
    },
    include: {
      pet: { select: { id: true, name: true } },
      vaccineType: { select: { name: true } },
    },
    orderBy: { administeredAt: "desc" },
  });

  const fromCampaign = campaignPets.map((p) => ({
    id: p.id,
    source: "campaign" as const,
    petName: p.name,
    petId: p.permanentPetId,
    animalType: p.animalType.name,
    breed: p.breed?.name,
    vaccineType: p.vaccination?.vaccineType.name ?? "Vaccination",
    administeredAt: p.vaccination?.administeredAt ?? p.updatedAt,
    nextDueDate: p.vaccination?.nextDueDate ?? null,
    certificateToken: p.certificateToken,
    campaignName: p.booking.campaign.name,
    location: p.booking.location.name,
    bookingRef: p.booking.bookingRef,
  }));

  const fromPets = petVaccinations
    .filter((v) => !fromCampaign.some((c) => c.certificateToken && c.certificateToken === v.certificateToken))
    .map((v) => ({
      id: v.id,
      source: "pet" as const,
      petName: v.pet.name,
      petId: v.pet.id,
      animalType: null,
      breed: null,
      vaccineType: v.vaccineType.name,
      administeredAt: v.administeredAt,
      nextDueDate: v.nextDueDate,
      certificateToken: v.certificateToken,
      campaignName: v.vetClinic ?? "BPA",
      location: v.vetClinic,
      bookingRef: null,
    }));

  return [...fromCampaign, ...fromPets].sort(
    (a, b) => new Date(b.administeredAt).getTime() - new Date(a.administeredAt).getTime()
  );
}

export async function getUpcomingVaccinations(userId: number) {
  const phone = await getUserPhone(userId);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const bookings = await prisma.campaignBooking.findMany({
    where: {
      ...bookingWhereForUser(userId, phone),
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      bookingDate: { gte: now },
    },
    include: {
      campaign: { select: { id: true, name: true } },
      location: { select: { name: true, address: true } },
      slot: { select: { startTime: true, endTime: true } },
      pets: { select: { id: true, name: true, vaccinationStatus: true } },
    },
    orderBy: { bookingDate: "asc" },
  });

  return bookings.map((b) => ({
    id: b.id,
    bookingRef: b.bookingRef,
    bookingDate: b.bookingDate,
    status: b.status,
    campaignName: b.campaign.name,
    location: b.location,
    slot: b.slot,
    pets: b.pets,
    qrToken: b.qrToken,
  }));
}

export async function linkCampaignRecordsToUser(userId: number) {
  const phone = await getUserPhone(userId);
  if (!phone) {
    return { linked: false, bookings: 0, pets: 0, vaccinations: 0, error: "Phone not found on account" };
  }

  const unlinkedBookings = await prisma.campaignBooking.findMany({
    where: { ownerPhone: phone, ownerUserId: null },
    include: {
      pets: { include: { vaccination: true } },
    },
  });

  if (!unlinkedBookings.length) {
    return { linked: false, bookings: 0, pets: 0, vaccinations: 0 };
  }

  const result = { linked: true, bookings: 0, pets: 0, vaccinations: 0 };

  for (const booking of unlinkedBookings) {
    await prisma.$transaction(async (tx) => {
      await tx.campaignBooking.update({
        where: { id: booking.id },
        data: {
          ownerUserId: userId,
          linkSource: "APP_REGISTRATION",
          linkedAt: new Date(),
        },
      });
      result.bookings++;

      for (const campaignPet of booking.pets) {
        let pet = await tx.pet.findFirst({
          where: { userId, name: { equals: campaignPet.name, mode: "insensitive" }, deleted: false },
        });

        if (!pet) {
          pet = await tx.pet.create({
            data: {
              userId,
              name: campaignPet.name,
              animalTypeId: campaignPet.animalTypeId,
              breedId: campaignPet.breedId ?? undefined,
              sex: campaignPet.gender ?? undefined,
              deleted: false,
            },
          });
          result.pets++;
        }

        await tx.campaignPet.update({
          where: { id: campaignPet.id },
          data: { permanentPetId: pet.id },
        });

        if (campaignPet.vaccination) {
          await tx.vaccination.update({
            where: { id: campaignPet.vaccination.id },
            data: { petId: pet.id },
          });
          result.vaccinations++;
        }
      }
    });
  }

  return result;
}

export async function linkExistingPet(
  campaignPetId: number,
  existingPetId: number,
  userId: number
) {
  const pet = await prisma.pet.findFirst({
    where: { id: existingPetId, userId, deleted: false },
  });
  if (!pet) {
    throw new Error("Pet not found or not owned by user");
  }

  const campaignPet = await prisma.campaignPet.findFirst({
    where: { id: campaignPetId, booking: { ownerUserId: userId } },
  });
  if (!campaignPet) {
    throw new Error("Campaign pet not found");
  }

  await prisma.campaignPet.update({
    where: { id: campaignPetId },
    data: { permanentPetId: existingPetId },
  });

  if (campaignPet.vaccinationId) {
    await prisma.vaccination.update({
      where: { id: campaignPet.vaccinationId },
      data: { petId: existingPetId },
    });
  }

  return { success: true, petId: existingPetId };
}

export async function claimCertificate(token: string, userId: number) {
  const normalized = token.toUpperCase();
  const data = await getCertificateData(normalized);
  if (!data) {
    throw new Error("Certificate not found");
  }

  const campaignPet = await prisma.campaignPet.findFirst({
    where: { certificateToken: normalized },
    include: { booking: true, vaccination: true },
  });

  if (campaignPet) {
    const phone = await getUserPhone(userId);
    if (phone && normalizePhone(campaignPet.booking.ownerPhone) !== phone) {
      throw new Error("Certificate phone does not match your account");
    }

    await prisma.campaignBooking.update({
      where: { id: campaignPet.bookingId },
      data: {
        ownerUserId: userId,
        linkSource: "CERTIFICATE_CLAIM",
        linkedAt: new Date(),
      },
    });

    let petId = campaignPet.permanentPetId;
    if (!petId) {
      const pet = await prisma.pet.create({
        data: {
          userId,
          name: campaignPet.name,
          animalTypeId: campaignPet.animalTypeId,
          breedId: campaignPet.breedId ?? undefined,
          sex: campaignPet.gender ?? undefined,
          deleted: false,
        },
      });
      petId = pet.id;
      await prisma.campaignPet.update({
        where: { id: campaignPet.id },
        data: { permanentPetId: petId },
      });
    }

    if (campaignPet.vaccinationId) {
      await prisma.vaccination.update({
        where: { id: campaignPet.vaccinationId },
        data: { petId },
      });
    }

    return { success: true, petId, certificateToken: normalized };
  }

  const vaccination = await prisma.vaccination.findFirst({
    where: { certificateToken: normalized },
  });
  if (vaccination?.petId) {
    const pet = await prisma.pet.findFirst({
      where: { id: vaccination.petId, userId, deleted: false },
    });
    if (pet) {
      return { success: true, petId: pet.id, certificateToken: normalized };
    }
  }

  throw new Error("Unable to claim certificate");
}

export async function getPublicCampaignBenefits(slug?: string) {
  const campaign = slug
    ? await prisma.campaign.findFirst({
        where: { slug, visibility: "PUBLIC" },
        include: {
          vaccineTypes: {
            where: { isActive: true },
            include: { vaccineType: { select: { id: true, name: true, description: true } } },
          },
          includedVaccines: {
            where: { isActive: true },
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
          },
          locations: { where: { isActive: true }, select: { id: true, name: true, address: true } },
        },
      })
    : await prisma.campaign.findFirst({
        where: { status: "ACTIVE", visibility: "PUBLIC" },
        orderBy: { startDate: "desc" },
        include: {
          vaccineTypes: {
            where: { isActive: true },
            include: { vaccineType: { select: { id: true, name: true, description: true } } },
          },
          includedVaccines: {
            where: { isActive: true },
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
          },
          locations: { where: { isActive: true }, select: { id: true, name: true, address: true } },
        },
      });

  if (!campaign) return null;

  return {
    id: campaign.id,
    name: campaign.name,
    slug: campaign.slug,
    description: campaign.description,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    pricingType: campaign.pricingType,
    priceAmount: campaign.priceAmount,
    vaccineTypes: campaign.vaccineTypes.map((vt) => vt.vaccineType),
    includedVaccines: campaign.includedVaccines.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      coveredDiseases: Array.isArray(v.coveredDiseases)
        ? (v.coveredDiseases as string[])
        : [],
      displayOrder: v.displayOrder,
    })),
    locations: campaign.locations,
    benefits: [
      "Official digital vaccination certificate",
      "QR-verifiable proof for travel and boarding",
      "Linked to your BPA pet profile",
      "SMS reminders for booster due dates",
      "Discounted campaign pricing",
    ],
  };
}
