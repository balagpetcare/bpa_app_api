/**
 * BullMQ queue for producer staff invite emails.
 * Worker: src/common/queue/workers/email.worker.ts
 */
import { Queue } from "bullmq";

export const QUEUE_NAME = "producer_staff_invite_email";

export type ProducerStaffInviteEmailJobPayload = {
  deliveryId: number;
  inviteId: number;
  to: string;
  inviteLink: string;
  producerName: string;
  roleLabel: string;
  expiresAt: string; // ISO date
  ownerName?: string;
  customMessage?: string;
};

function getConnection(): { url?: string; host?: string; port?: number; maxRetriesPerRequest: null } {
  const REDIS_URL = process.env.REDIS_URL || "";
  if (REDIS_URL) return { url: REDIS_URL, maxRetriesPerRequest: null };
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  };
}

let _queue: Queue<ProducerStaffInviteEmailJobPayload> | null = null;

export function getProducerStaffInviteEmailQueue(): Queue<ProducerStaffInviteEmailJobPayload> | null {
  if (_queue) return _queue;
  const REDIS_URL = process.env.REDIS_URL || "";
  const REDIS_ENABLED =
    REDIS_URL.length > 0 ||
    (process.env.REDIS_ENABLED !== "false" && process.env.REDIS_ENABLED !== "0");
  if (!REDIS_ENABLED) return null;
  try {
    _queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 } },
    }) as Queue<ProducerStaffInviteEmailJobPayload>;
  } catch {
    return null;
  }
  return _queue;
}

export async function addProducerStaffInviteEmailJob(
  payload: ProducerStaffInviteEmailJobPayload
): Promise<string | null> {
  const queue = getProducerStaffInviteEmailQueue();
  if (!queue) return null;
  const job = await queue.add("send", payload);
  return job?.id ?? null;
}
