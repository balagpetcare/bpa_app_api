/**
 * BullMQ queue for producer staff invite emails.
 * Worker: src/common/queue/workers/email.worker.ts
 */
import { Queue } from "bullmq";
import { areRedisQueuesEnabled } from "../../infrastructure/redis/redis.client";
import { getRedisConnectionOptions, isRedisEnabled } from "../../infrastructure/redis/redisConnection";

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

function getConnection() {
  return getRedisConnectionOptions();
}

let _queue: Queue<ProducerStaffInviteEmailJobPayload> | null = null;

export function getProducerStaffInviteEmailQueue(): Queue<ProducerStaffInviteEmailJobPayload> | null {
  if (_queue) return _queue;
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) return null;
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
