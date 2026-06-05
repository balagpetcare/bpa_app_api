/**
 * Storage bucket initialization (MinIO dev).
 *
 * - STORAGE_PROVIDER=minio: create bucket + public-read policy
 * - STORAGE_PROVIDER=b2: skip (configure bucket in Backblaze console)
 *
 * Run: npm run storage:init
 */

require("dotenv").config();
const {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const { resolveStorageConfig } = require("../src/infrastructure/storage/storage.config");
const { resolveStorageEndpoint } = require("../src/infrastructure/storage/s3Compatible.provider");

const config = resolveStorageConfig();

if (config.provider !== "minio") {
  console.log(
    `\n[storage:init] STORAGE_PROVIDER=${config.provider} — skipping MinIO bucket init.`
  );
  console.log(
    "For B2, create the bucket and public access rules in the Backblaze console.\n"
  );
  process.exit(0);
}

const endpoint = resolveStorageEndpoint(config.endpoint);
const s3Client = new S3Client({
  region: config.region,
  endpoint,
  forcePathStyle: config.forcePathStyle ?? true,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
});

const bucketName = config.bucketName;

const publicReadPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PublicReadGetObject",
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${bucketName}/*`],
    },
  ],
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(error: any): boolean {
  const code = error?.code || error?.name;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "NetworkingError" ||
    (error?.$metadata?.httpStatusCode >= 500 && error?.$metadata?.httpStatusCode < 600)
  );
}

async function initMinIO() {
  const maxAttempts = 5;
  const delayMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`\n🔧 Initializing MinIO bucket: ${bucketName} (attempt ${attempt}/${maxAttempts})`);
      console.log(`📍 Endpoint: ${endpoint}\n`);

      let bucketExists = false;
      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        bucketExists = true;
        console.log(`✅ Bucket "${bucketName}" already exists`);
      } catch (error: any) {
        if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
          console.log(`📦 Bucket "${bucketName}" does not exist, creating...`);
          bucketExists = false;
        } else if (isRetryableError(error)) {
          throw error;
        } else {
          throw error;
        }
      }

      if (!bucketExists) {
        try {
          await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
          console.log(`✅ Bucket "${bucketName}" created successfully`);
        } catch (error: any) {
          if (error.name === "BucketAlreadyOwnedByYou") {
            console.log(`✅ Bucket "${bucketName}" already exists (owned by you)`);
          } else if (isRetryableError(error)) {
            throw error;
          } else {
            throw error;
          }
        }
      }

      console.log(`\n🔓 Setting public read policy on bucket "${bucketName}"...`);
      await s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(publicReadPolicy),
        })
      );
      console.log(`✅ Public read policy applied successfully`);

      console.log(`\n✨ MinIO initialization complete!`);
      console.log(`\n📝 Files can now be accessed via:`);
      console.log(
        `   ${config.publicUrl || config.endpoint}/${bucketName}/<key>\n`
      );
      return;
    } catch (error: any) {
      if (isRetryableError(error) && attempt < maxAttempts) {
        console.warn(
          `⚠️ MinIO not ready (${error?.code || error?.message}), retrying in ${delayMs / 1000}s...`
        );
        await sleep(delayMs);
      } else {
        console.error(`\n❌ Error initializing MinIO:`, error?.message || error);
        if (error?.$metadata) {
          console.error(`   Status Code: ${error.$metadata.httpStatusCode}`);
          console.error(`   Request ID: ${error.$metadata.requestId}`);
        }
        process.exit(1);
      }
    }
  }
}

if (require.main === module) {
  initMinIO();
}

export {};
