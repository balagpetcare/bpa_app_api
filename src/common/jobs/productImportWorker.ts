/**
 * BullMQ worker for product import jobs.
 * Run: node -r ts-node/register src/common/jobs/productImportWorker.ts
 * Requires REDIS_ENABLED and Redis.
 */
import "dotenv/config";
import { Worker, Job } from "bullmq";
import prisma from "../../infrastructure/db/prismaClient";
import { runBatchSyncSafe } from "../../api/v1/services/product-import/BatchRunner";
import type { ProductImportJobPayload } from "../../api/v1/services/productImportQueue";

const REDIS_ENABLED = process.env.REDIS_ENABLED !== "false" && process.env.REDIS_ENABLED !== "0";
if (!REDIS_ENABLED) {
  console.log("[ProductImportWorker] REDIS_ENABLED=false; worker will not start.");
  process.exit(0);
}

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

async function processJob(job: Job<ProductImportJobPayload>) {
  const { batchId, bufferBase64, orgId, branchId, createdByUserId, provider, sourceType, filename } = job.data;
  const buffer = Buffer.from(bufferBase64, "base64");
  const result = await runBatchSyncSafe(
    {
      prisma,
      orgId,
      branchId,
      createdByUserId,
      provider,
      sourceType,
      filename,
    },
    { batchId, buffer }
  );
  if ("error" in result) throw new Error(result.error);
  return result.totals;
}

function run() {
  const worker = new Worker<ProductImportJobPayload>(
    "product_import",
    processJob,
    { connection: redisConfig, concurrency: 1 }
  );
  worker.on("error", (err) => console.warn("[ProductImportWorker] error", (err as Error)?.message));
  worker.on("completed", (job) => console.log("[ProductImportWorker] batch", job.data.batchId, "completed"));
  worker.on("failed", (job, err) => console.warn("[ProductImportWorker] batch", job?.data?.batchId, "failed", (err as Error)?.message));
  console.log("[ProductImportWorker] Started");
}

run();
