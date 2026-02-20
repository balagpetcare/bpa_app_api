/**
 * BullMQ queue for product import jobs. Enqueue from upload endpoint; process in productImportWorker.
 */
import { Queue } from "bullmq";

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

const REDIS_ENABLED = process.env.REDIS_ENABLED !== "false" && process.env.REDIS_ENABLED !== "0";

let productImportQueue: Queue | null = null;

export function getProductImportQueue(): Queue | null {
  if (!REDIS_ENABLED) return null;
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
  return REDIS_ENABLED && getProductImportQueue() !== null;
}
