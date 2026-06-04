/**
 * Campaign SMS admin — logs, templates, bulk broadcast.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { normalizePhone, startOfDay } from "./campaign.utils";
import { sendCampaignSms } from "./sms.service";

const BULK_SMS_MAX_RECIPIENTS = 500;

export async function listCampaignSmsLogs(input: {
  campaignId: number;
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const where: Record<string, unknown> = { campaignId: input.campaignId };
  if (input.status) where.status = input.status;

  const [items, total] = await Promise.all([
    prisma.campaignSmsLog.findMany({
      where,
      orderBy: { queuedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        bookingId: true,
        phone: true,
        templateCode: true,
        message: true,
        status: true,
        provider: true,
        segmentCount: true,
        estimatedCostBdt: true,
        errorMessage: true,
        queuedAt: true,
        sentAt: true,
        deliveredAt: true,
      },
    }),
    prisma.campaignSmsLog.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

export async function listCampaignSmsTemplates(campaignId: number) {
  return prisma.campaignSmsTemplate.findMany({
    where: { campaignId },
    orderBy: { code: "asc" },
  });
}

export async function upsertCampaignSmsTemplate(input: {
  campaignId: number;
  code: string;
  template: string;
  isActive?: boolean;
}) {
  const code = input.code.trim().toUpperCase();
  return prisma.campaignSmsTemplate.upsert({
    where: {
      campaignId_code: { campaignId: input.campaignId, code },
    },
    create: {
      campaignId: input.campaignId,
      code,
      template: input.template,
      isActive: input.isActive ?? true,
    },
    update: {
      template: input.template,
      isActive: input.isActive ?? true,
    },
  });
}

export type BulkSmsInput = {
  campaignId: number;
  message: string;
  phones?: string[];
  /** When true, target all non-cancelled bookings (optional filters still apply). */
  sendToAll?: boolean;
  bookingStatus?: string;
  locationIds?: number[];
  bookingDate?: string;
  dryRun?: boolean;
};

export async function sendBulkCampaignSms(input: BulkSmsInput): Promise<{
  dryRun: boolean;
  recipientCount: number;
  queued: number;
  failed: number;
  skipped: number;
  errors: string[];
}> {
  const message = input.message?.trim();
  if (!message || message.length < 3) {
    throw new Error("Message is required (min 3 characters)");
  }
  if (message.length > 500) {
    throw new Error("Message must be 500 characters or fewer");
  }

  let phones: string[] = [];

  if (input.phones?.length) {
    phones = [
      ...new Set(
        input.phones
          .map((p) => normalizePhone(p))
          .filter((p) => p.length >= 10)
      ),
    ];
  } else {
    const where: Record<string, unknown> = { campaignId: input.campaignId };

    if (input.sendToAll) {
      where.status = { notIn: ["CANCELLED"] };
    } else {
      if (input.bookingStatus) {
        where.status = input.bookingStatus;
      } else {
        where.status = { notIn: ["CANCELLED"] };
      }
      if (input.locationIds?.length) {
        where.locationId = { in: input.locationIds };
      }
    }

    if (!input.sendToAll && input.bookingDate) {
      const day = startOfDay(new Date(input.bookingDate));
      if (!Number.isNaN(day.getTime())) {
        where.bookingDate = day;
      }
    }

    const bookings = await prisma.campaignBooking.findMany({
      where,
      select: { ownerPhone: true },
      take: BULK_SMS_MAX_RECIPIENTS * 2,
    });
    phones = [
      ...new Set(
        bookings
          .map((b) => normalizePhone(b.ownerPhone))
          .filter((p) => p.length >= 10)
      ),
    ];
  }

  if (phones.length > BULK_SMS_MAX_RECIPIENTS) {
    phones = phones.slice(0, BULK_SMS_MAX_RECIPIENTS);
  }

  if (input.dryRun) {
    return {
      dryRun: true,
      recipientCount: phones.length,
      queued: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };
  }

  let queued = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const phone of phones) {
    try {
      const result = await sendCampaignSms({
        phone,
        templateCode: "ANNOUNCEMENT",
        campaignId: input.campaignId,
        variables: { message },
      });
      if (result.success) queued++;
      else {
        failed++;
        if (result.error) errors.push(`${phone}: ${result.error}`);
      }
    } catch (e) {
      failed++;
      errors.push(`${phone}: ${(e as Error).message}`);
    }
  }

  return {
    dryRun: false,
    recipientCount: phones.length,
    queued,
    failed,
    skipped,
    errors: errors.slice(0, 20),
  };
}
