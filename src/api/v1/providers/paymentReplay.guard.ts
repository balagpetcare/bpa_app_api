import { getSharedRedisClient, isRedisAvailable } from "../../../infrastructure/redis/redis.client";
import { isRedisEnabled } from "../../../infrastructure/redis/redisConnection";

const REPLAY_TTL_SECONDS = 7 * 24 * 60 * 60;

function replayKey(eventKey: string): string {
  return `campaign:payment:event:${eventKey}`;
}

/**
 * Returns true if this payment event was already processed (replay).
 */
export async function isPaymentEventReplay(eventKey: string): Promise<boolean> {
  if (!isRedisEnabled() || !isRedisAvailable()) return false;
  const client = getSharedRedisClient();
  if (!client) return false;
  try {
    const exists = await client.exists(replayKey(eventKey));
    return exists === 1;
  } catch (err) {
    console.warn("[PaymentReplay] Redis unavailable, skipping replay check:", (err as Error).message);
    return false;
  }
}

export async function markPaymentEventProcessed(eventKey: string): Promise<void> {
  if (!isRedisEnabled() || !isRedisAvailable()) return;
  const client = getSharedRedisClient();
  if (!client) return;
  try {
    await client.setex(replayKey(eventKey), REPLAY_TTL_SECONDS, "1");
  } catch (err) {
    console.warn("[PaymentReplay] Failed to mark event:", (err as Error).message);
  }
}

export function buildPaymentEventKey(provider: string, eventId: string): string {
  return `${provider.toLowerCase()}:${eventId}`;
}
