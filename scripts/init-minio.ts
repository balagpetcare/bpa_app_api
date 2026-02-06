/**
 * MinIO Bucket Initialization Script
 * 
 * This script:
 * 1. Creates the bpa-pets bucket if it doesn't exist
 * 2. Sets a public read policy on the bucket to allow direct URL access
 * 
 * Run: npm run minio:init
 * Or: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/init-minio.ts
 */

require("dotenv").config();
const { S3Client, CreateBucketCommand, PutBucketPolicyCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
const appConfig = require("../src/config/appConfig");

// Use localhost when running from host machine (not in Docker)
// If endpoint contains 'bpa-storage', replace with localhost
const endpoint = appConfig.storage.endpoint?.includes('bpa-storage') 
  ? appConfig.storage.endpoint.replace('bpa-storage', 'localhost')
  : (process.env.AWS_ENDPOINT || appConfig.storage.endpoint || "http://localhost:9000");

const s3Client = new S3Client({
  region: appConfig.storage.region,
  endpoint: endpoint,
  forcePathStyle: appConfig.storage.forcePathStyle ?? true,
  credentials: {
    accessKeyId: appConfig.storage.accessKeyId,
    secretAccessKey: appConfig.storage.secretAccessKey,
  },
});

const bucketName = appConfig.storage.bucketName || "bpa-pets";

// Public read policy for the bucket
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

async function initMinIO() {
  try {
    console.log(`\n🔧 Initializing MinIO bucket: ${bucketName}`);
    console.log(`📍 Endpoint: ${endpoint}\n`);

    // Check if bucket exists
    let bucketExists = false;
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      bucketExists = true;
      console.log(`✅ Bucket "${bucketName}" already exists`);
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        console.log(`📦 Bucket "${bucketName}" does not exist, creating...`);
        bucketExists = false;
      } else {
        throw error;
      }
    }

    // Create bucket if it doesn't exist
    if (!bucketExists) {
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`✅ Bucket "${bucketName}" created successfully`);
      } catch (error: any) {
        if (error.name === "BucketAlreadyOwnedByYou") {
          console.log(`✅ Bucket "${bucketName}" already exists (owned by you)`);
        } else {
          throw error;
        }
      }
    }

    // Set public read policy
    console.log(`\n🔓 Setting public read policy on bucket "${bucketName}"...`);
    try {
      await s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(publicReadPolicy),
        })
      );
      console.log(`✅ Public read policy applied successfully`);
    } catch (error: any) {
      console.error(`❌ Failed to set bucket policy:`, error.message);
      throw error;
    }

    console.log(`\n✨ MinIO initialization complete!`);
    console.log(`\n📝 Files can now be accessed via:`);
    console.log(`   ${appConfig.storage.publicUrl || appConfig.storage.endpoint}/${bucketName}/<key>\n`);
  } catch (error: any) {
    console.error(`\n❌ Error initializing MinIO:`, error.message);
    if (error.$metadata) {
      console.error(`   Status Code: ${error.$metadata.httpStatusCode}`);
      console.error(`   Request ID: ${error.$metadata.requestId}`);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  initMinIO();
}

export {};
