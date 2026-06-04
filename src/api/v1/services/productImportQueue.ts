/**
 * BullMQ queue for product import jobs. Enqueue from upload endpoint; process in productImportWorker.
 */
import { Queue } from "bullmq";
import { areRedisQueuesEnabled } from "../../../infrastructure/redis/redis.client";
import { getRedisConnectionOptions, isRedisEnabled } from "../../../infrastructure/redis/redisConnection";

const redisConfig = getRedisConnectionOptions();

let productImportQueue: Queue | null = null;

export function getProductImportQueue(): Queue | null {
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) return null;
  if (productImportQueue) return productImportQueue;
  try {
    productImportQueue = new Queue("product_import", { connection: redisConfig });
  } catch (e) {
    console.warn("[ProductImportQueue] init failed", (e as Error)?.message);
  }
  return productImportQueue;
}

export type ProductImportJobPayload = {
  batchId: number;
  orgId: number;
  branchId: number | null;
  createdByUserId: number;
  provider: string;
  sourceType: "CSV" | "EXCEL" | "API";
  filename: string | null;
  bufferBase64: string;
};

export async function enqueueProductImportJob(payload: ProductImportJobPayload): Promise<boolean> {
  const q = getProductImportQueue();
  if (!q) return false;
  await q.add("process", payload, {
    jobId: `batch-${payload.batchId}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
  });
  return true;
}

export function isProductImportQueueEnabled(): boolean {
  return isRedisEnabled() && areRedisQueuesEnabled() && getProductImportQueue() !== null;
}
