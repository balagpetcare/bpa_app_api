/**
 * Ensures minimal UAT campaign fixtures exist (FREE + PAID active with location/slot).
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";

/** 2026-06-10 23:59:59 Asia/Dhaka (UTC+6) */
const BOOKING_END_AT = new Date("2026-06-10T17:59:59.000Z");

async function ensureCampaign(input: {
  slug: string;
  name: string;
  pricingType: "FREE" | "PAID";
  priceAmount?: number;
}) {
  const existing = await prisma.campaign.findUnique({ where: { slug: input.slug } });
  if (existing) {
    await prisma.campaign.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        visibility: "PUBLIC",
        pricingType: input.pricingType,
        priceAmount: input.priceAmount ?? null,
        countdownEnabled: true,
        bookingEndAt: BOOKING_END_AT,
      },
    });
    return existing.id;
  }

  const start = new Date();
  const end = new Date();
  end.setMonth(end.getMonth() + 3);

  const c = await prisma.campaign.create({
    data: {
      name: input.name,
      slug: input.slug,
      startDate: start,
      endDate: end,
      status: "ACTIVE",
      visibility: "PUBLIC",
      pricingType: input.pricingType,
      priceAmount: input.priceAmount ?? null,
      currency: "BDT",
      countdownEnabled: true,
      bookingEndAt: BOOKING_END_AT,
    },
  });
  return c.id;
}

async function ensureLocationAndSlot(campaignId: number) {
  let loc = await prisma.campaignLocation.findFirst({ where: { campaignId } });
  if (!loc) {
    const org = await prisma.organization.findFirst();
    loc = await prisma.campaignLocation.create({
      data: {
        campaignId,
        name: "UAT Clinic Dhaka",
        address: "UAT Test Address",
        dailyCapacity: 50,
        isActive: true,
        ...(org ? {} : {}),
      },
    });
  }

  const slotDate = new Date();
  slotDate.setDate(slotDate.getDate() + 3);
  slotDate.setHours(0, 0, 0, 0);

  let slot = await prisma.campaignSlot.findFirst({
    where: { locationId: loc.id, date: slotDate },
  });

  if (!slot) {
    slot = await prisma.campaignSlot.create({
      data: {
        locationId: loc.id,
        date: slotDate,
        startTime: "09:00",
        endTime: "12:00",
        capacity: 20,
        bookedCount: 0,
        status: "OPEN",
      },
    });
  } else {
    await prisma.campaignSlot.update({
      where: { id: slot.id },
      data: { status: "OPEN", capacity: 20 },
    });
  }

  return { locationId: loc.id, slotId: slot.id };
}

async function main() {
  const freeId = await ensureCampaign({
    slug: "uat-free-2026",
    name: "UAT Free Vaccination",
    pricingType: "FREE",
  });
  const paidId = await ensureCampaign({
    slug: "uat-paid-2026",
    name: "UAT Paid Vaccination",
    pricingType: "PAID",
    priceAmount: 200,
  });

  const free = await ensureLocationAndSlot(freeId);
  const paid = await ensureLocationAndSlot(paidId);

  console.log(JSON.stringify({ freeId, paidId, free, paid }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
