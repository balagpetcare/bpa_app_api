function boolEnv(name: string, def = false): boolean {
  const v = process.env[name];
  if (v == null) return def;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function normalizeProvider(raw: string | undefined) {
  const p = String(raw || "minio").trim().toLowerCase();
  if (p === "b2" || p === "backblaze" || p === "backblaze-b2") return "b2";
  if (p === "minio" || p === "s3") return "minio";
  throw new Error(
    `Invalid STORAGE_PROVIDER="${raw}". Expected "minio" or "b2".`
  );
}

function resolveStorageConfig() {
  const provider = normalizeProvider(process.env.STORAGE_PROVIDER);

  const publicUrl = firstNonEmpty(
    process.env.STORAGE_PUBLIC_URL,
    process.env.MINIO_PUBLIC_URL
  );

  const useCountryPrefix = boolEnv("STORAGE_USE_COUNTRY_PREFIX", true);

  if (provider === "b2") {
    return {
      provider,
      region: firstNonEmpty(process.env.S3_REGION, process.env.AWS_REGION, "us-east-005"),
      bucketName: firstNonEmpty(
        process.env.S3_BUCKET,
        process.env.AWS_BUCKET_NAME,
        "bpa-production-media"
      ),
      endpoint: firstNonEmpty(
        process.env.S3_ENDPOINT,
        process.env.AWS_ENDPOINT
      ),
      publicUrl,
      forcePathStyle: boolEnv("S3_FORCE_PATH_STYLE", boolEnv("AWS_FORCE_PATH_STYLE", true)),
      accessKeyId: firstNonEmpty(
        process.env.S3_ACCESS_KEY,
        process.env.AWS_ACCESS_KEY_ID
      ),
      secretAccessKey: firstNonEmpty(
        process.env.S3_SECRET_KEY,
        process.env.AWS_SECRET_ACCESS_KEY
      ),
      useCountryPrefix,
    };
  }

  // minio (default) — AWS_* primary, S3_* fallback for shared tooling
  return {
    provider,
    region: firstNonEmpty(process.env.AWS_REGION, process.env.S3_REGION, "us-east-1"),
    bucketName: firstNonEmpty(
      process.env.AWS_BUCKET_NAME,
      process.env.S3_BUCKET,
      "bpa-pets"
    ),
    endpoint: firstNonEmpty(
      process.env.AWS_ENDPOINT,
      process.env.S3_ENDPOINT,
      "http://localhost:9000"
    ),
    publicUrl,
    forcePathStyle: boolEnv("AWS_FORCE_PATH_STYLE", boolEnv("S3_FORCE_PATH_STYLE", true)),
    accessKeyId: firstNonEmpty(
      process.env.AWS_ACCESS_KEY_ID,
      process.env.S3_ACCESS_KEY,
      "admin"
    ),
    secretAccessKey: firstNonEmpty(
      process.env.AWS_SECRET_ACCESS_KEY,
      process.env.S3_SECRET_KEY,
      "password123"
    ),
    useCountryPrefix,
  };
}

function validateStorageConfig(config) {
  const errors: string[] = [];

  if (!config.bucketName) errors.push("Storage bucket name is required.");
  if (!config.endpoint) errors.push("Storage endpoint is required.");
  if (!config.accessKeyId) errors.push("Storage access key is required.");
  if (!config.secretAccessKey) errors.push("Storage secret key is required.");

  if (config.provider === "b2") {
    if (!config.endpoint.includes("backblazeb2.com")) {
      errors.push(
        'B2 provider expects S3_ENDPOINT like "https://s3.<region>.backblazeb2.com".'
      );
    }
    if (!config.publicUrl) {
      errors.push(
        "B2 requires STORAGE_PUBLIC_URL or MINIO_PUBLIC_URL (public download/CDN base, not the S3 API endpoint)."
      );
    }
  }

  return errors;
}

module.exports = {
  resolveStorageConfig,
  validateStorageConfig,
  normalizeProvider,
  boolEnv,
};

export {};
