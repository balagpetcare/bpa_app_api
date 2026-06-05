/**
 * Campaign ticket service — one QR ticket per cat (CampaignPet).
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { generateQrToken } from "./campaign.utils";
import { generatePetTicketQr } from "./qr.service";

const BASE_URL = process.env.CAMPAIGN_BASE_URL || "https://vaccine.bpa.org.bd";

export type CampaignTicketDetails = {
  id: number;
  petName: string;
  ticketToken: string;
  ticketUrl: string;
  bookingRef: string;
  bookingId: number;
  vaccinationStatus: string;
  locationName?: string | null;
  bookingDate?: string | null;
  bookingArea?: string | null;
  qrImage?: string;
};

async function uniqueTicketToken(
  tx: Pick<typeof prisma, "campaignPet">
): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const token = generateQrToken();
    const exists = await tx.campaignPet.findFirst({
      where: { ticketToken: token },
      select: { id: true },
    });
    if (!exists) return token;
  }
  throw new Error("Could not generate unique ticket token");
}

/** Issue ticket tokens for all pets on a booking (idempotent). */
export async function issueTicketsForBooking(bookingId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const pets = await tx.campaignPet.findMany({
      where: { bookingId },
      select: { id: true, ticketToken: true },
    });
    const now = new Date();
    for (const pet of pets) {
      if (pet.ticketToken) continue;
      const ticketToken = await uniqueTicketToken(tx);
      await tx.campaignPet.update({
        where: { id: pet.id },
        data: { ticketToken, ticketIssuedAt: now },
      });
    }
  });
}

/** Ensure ticket exists; issue on demand for legacy rows. */
export async function ensurePetTicket(campaignPetId: number): Promise<string> {
  const pet = await prisma.campaignPet.findUnique({
    where: { id: campaignPetId },
    select: { id: true, ticketToken: true },
  });
  if (!pet) throw new Error("Pet not found");
  if (pet.ticketToken) return pet.ticketToken;

  const token = await uniqueTicketToken(prisma);
  await prisma.campaignPet.update({
    where: { id: campaignPetId },
    data: { ticketToken: token, ticketIssuedAt: new Date() },
  });
  return token;
}

function mapTicketRow(
  pet: {
    id: number;
    name: string;
    ticketToken: string | null;
    vaccinationStatus: string;
    booking: {
      id: number;
      bookingRef: string;
      bookingDate: Date;
      bookingArea: string | null;
      location: { name: string } | null;
    };
  },
  includeQr = false,
  qrImage?: string
): CampaignTicketDetails | null {
  if (!pet.ticketToken) return null;
  return {
    id: pet.id,
    petName: pet.name,
    ticketToken: pet.ticketToken,
    ticketUrl: `${BASE_URL}/ticket/${pet.ticketToken}`,
    bookingRef: pet.booking.bookingRef,
    bookingId: pet.booking.id,
    vaccinationStatus: pet.vaccinationStatus,
    locationName: pet.booking.location?.name ?? null,
    bookingDate: pet.booking.bookingDate?.toISOString().slice(0, 10) ?? null,
    bookingArea: pet.booking.bookingArea,
    qrImage: includeQr ? qrImage : undefined,
  };
}

export async function getTicketsByBookingRef(
  bookingRef: string,
  options?: { includeQr?: boolean }
): Promise<CampaignTicketDetails[]> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { bookingRef: bookingRef.toUpperCase() },
    include: {
      pets: true,
      location: { select: { name: true } },
    },
  });
  if (!booking) return [];

  await issueTicketsForBooking(booking.id);
  const refreshed = await prisma.campaignBooking.findUnique({
    where: { id: booking.id },
    include: {
      pets: true,
      location: { select: { name: true } },
    },
  });
  if (!refreshed) return [];

  const out: CampaignTicketDetails[] = [];
  for (const pet of refreshed.pets) {
    let qrImage: string | undefined;
    if (options?.includeQr && pet.ticketToken) {
      const qr = await generatePetTicketQr(pet.ticketToken, pet.name, booking.bookingRef);
      qrImage = qr.qrImage;
    }
    const mapped = mapTicketRow(
      {
        id: pet.id,
        name: pet.name,
        ticketToken: pet.ticketToken,
        vaccinationStatus: pet.vaccinationStatus,
        booking: {
          id: refreshed.id,
          bookingRef: refreshed.bookingRef,
          bookingDate: refreshed.bookingDate,
          bookingArea: refreshed.bookingArea,
          location: refreshed.location,
        },
      },
      options?.includeQr,
      qrImage
    );
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function getTicketByToken(
  ticketToken: string,
  options?: { includeQr?: boolean }
): Promise<CampaignTicketDetails | null> {
  const pet = await prisma.campaignPet.findFirst({
    where: { ticketToken },
    include: {
      booking: {
        include: { location: { select: { name: true } } },
      },
    },
  });
  if (!pet) return null;

  if (!pet.ticketToken) {
    await ensurePetTicket(pet.id);
    return getTicketByToken(ticketToken, options);
  }

  let qrImage: string | undefined;
  if (options?.includeQr) {
    const qr = await generatePetTicketQr(pet.ticketToken, pet.name, pet.booking.bookingRef);
    qrImage = qr.qrImage;
  }

  return mapTicketRow(
    {
      id: pet.id,
      name: pet.name,
      ticketToken: pet.ticketToken,
      vaccinationStatus: pet.vaccinationStatus,
      booking: {
        id: pet.booking.id,
        bookingRef: pet.booking.bookingRef,
        bookingDate: pet.booking.bookingDate,
        bookingArea: pet.booking.bookingArea,
        location: pet.booking.location,
      },
    },
    options?.includeQr,
    qrImage
  );
}

export function formatTicketUrlsForSms(
  tickets: Array<{ petName: string; ticketUrl: string }>
): string {
  if (tickets.length === 0) return "";
  return tickets.map((t, i) => `${t.petName}: ${t.ticketUrl}`).join(" | ");
}
