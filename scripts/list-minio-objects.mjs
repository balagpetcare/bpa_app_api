import "dotenv/config";
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { resolveScriptStorageEnv } from "./storage-env.mjs";

const cfg = resolveScriptStorageEnv();

const client = new S3Client({
  region: cfg.region,
  endpoint: cfg.endpoint,
  forcePathStyle: cfg.forcePathStyle,
  credentials: {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  },
});

async function main() {
  console.log("STORAGE_PROVIDER:", cfg.provider);
  console.log("Listing", cfg.bucket, "at", cfg.endpoint);
  const list = await client.send(
    new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 20 })
  );
  const contents = list.Contents || [];
  console.log("Object count (first page):", contents.length);
  for (const o of contents) {
    console.log(" -", o.Key, o.Size);
  }

  const keys = [
    "BD/media/2/1780346714709_3fda3f2c2fa8a8eac40d.jpg",
    "BD/media/2/1780346829965_27147ff04b10ff45b541.jpg",
  ];
  for (const key of keys) {
    try {
      const h = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      console.log("HEAD ok", key, h.ContentLength);
    } catch (e) {
      console.log("HEAD missing", key, e.name, e.$metadata?.httpStatusCode);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
