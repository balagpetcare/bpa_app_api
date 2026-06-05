/**
 * Shared env resolution for storage CLI scripts (mirrors storage.config.ts).
 */
export function resolveScriptStorageEnv() {
  const provider = String(process.env.STORAGE_PROVIDER || "minio").toLowerCase();
  const isB2 = provider === "b2" || provider === "backblaze" || provider === "backblaze-b2";

  const first = (...vals) => {
    for (const v of vals) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "";
  };

  if (isB2) {
    return {
      provider: "b2",
      region: first(process.env.S3_REGION, process.env.AWS_REGION, "us-east-005"),
      bucket: first(process.env.S3_BUCKET, process.env.AWS_BUCKET_NAME, "bpa-production-media"),
      endpoint: first(process.env.S3_ENDPOINT, process.env.AWS_ENDPOINT),
      publicBase: first(
        process.env.STORAGE_PUBLIC_URL,
        process.env.MINIO_PUBLIC_URL,
        process.env.S3_ENDPOINT,
        process.env.AWS_ENDPOINT
      ).replace(/\/$/, ""),
      accessKeyId: first(process.env.S3_ACCESS_KEY, process.env.AWS_ACCESS_KEY_ID),
      secretAccessKey: first(process.env.S3_SECRET_KEY, process.env.AWS_SECRET_ACCESS_KEY),
      forcePathStyle:
        String(process.env.S3_FORCE_PATH_STYLE ?? process.env.AWS_FORCE_PATH_STYLE ?? "true")
          .toLowerCase() !== "false",
    };
  }

  return {
    provider: "minio",
    region: first(process.env.AWS_REGION, process.env.S3_REGION, "us-east-1"),
    bucket: first(process.env.AWS_BUCKET_NAME, process.env.S3_BUCKET, "bpa-pets"),
    endpoint: first(process.env.AWS_ENDPOINT, process.env.S3_ENDPOINT, "http://localhost:9000"),
    publicBase: first(
      process.env.STORAGE_PUBLIC_URL,
      process.env.MINIO_PUBLIC_URL,
      process.env.AWS_ENDPOINT,
      "http://localhost:9000"
    ).replace(/\/$/, ""),
    accessKeyId: first(process.env.AWS_ACCESS_KEY_ID, process.env.S3_ACCESS_KEY, "minioadmin"),
    secretAccessKey: first(
      process.env.AWS_SECRET_ACCESS_KEY,
      process.env.S3_SECRET_KEY,
      "minioadmin"
    ),
    forcePathStyle:
      String(process.env.AWS_FORCE_PATH_STYLE ?? process.env.S3_FORCE_PATH_STYLE ?? "true")
        .toLowerCase() !== "false",
  };
}
