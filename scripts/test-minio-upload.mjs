import "dotenv/config";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";
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
  console.log("Bucket:", cfg.bucket, "Endpoint:", cfg.endpoint);

  const rand = crypto.randomBytes(6).toString("hex");
  const key = `BD/media/0/test_${Date.now()}_${rand}.txt`;
  const body = Buffer.from(`bpa-storage-upload-test-${cfg.provider}`);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: "text/plain",
    })
  );
  await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const url = `${cfg.publicBase}/${cfg.bucket}/${key}`;
  const res = await fetch(url);
  console.log({
    key,
    url,
    getStatus: res.status,
    ok: res.ok,
    body: await res.text(),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
