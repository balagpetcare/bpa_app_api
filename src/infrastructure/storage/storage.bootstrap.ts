const { HeadBucketCommand } = require("@aws-sdk/client-s3");
const {
  resolveStorageConfig,
  validateStorageConfig,
} = require("./storage.config");
const { getStorageProvider } = require("./storage.factory");

function boolEnv(name: string, def = false): boolean {
  const v = process.env[name];
  if (v == null) return def;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

async function validateStorageOnStartup(): Promise<{
  ok: boolean;
  provider: string;
  bucket: string;
  endpoint: string;
  warnings: string[];
  errors: string[];
}> {
  const config = resolveStorageConfig();
  const errors = validateStorageConfig(config);
  const warnings: string[] = [];

  if (config.provider === "minio" && !config.publicUrl) {
    warnings.push(
      "MINIO_PUBLIC_URL / STORAGE_PUBLIC_URL is empty — client media URLs will use the internal endpoint."
    );
  }

  if (boolEnv("STORAGE_SKIP_STARTUP_CHECK", false)) {
    return {
      ok: errors.length === 0,
      provider: config.provider,
      bucket: config.bucketName,
      endpoint: config.endpoint,
      warnings: [...warnings, "STORAGE_SKIP_STARTUP_CHECK=true — bucket connectivity not verified."],
      errors,
    };
  }

  if (errors.length > 0) {
    return {
      ok: false,
      provider: config.provider,
      bucket: config.bucketName,
      endpoint: config.endpoint,
      warnings,
      errors,
    };
  }

  try {
    const provider = getStorageProvider();
    const client = provider.getS3Client();
    await client.send(new HeadBucketCommand({ Bucket: config.bucketName }));
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (config.provider === "minio") {
      warnings.push(
        `MinIO bucket head check failed (${msg}). Run "npm run storage:init" if this is a fresh dev environment.`
      );
    } else {
      errors.push(`B2 bucket head check failed: ${msg}`);
    }
  }

  return {
    ok: errors.length === 0,
    provider: config.provider,
    bucket: config.bucketName,
    endpoint: config.endpoint,
    warnings,
    errors,
  };
}

async function bootstrapStorage(): Promise<void> {
  const result = await validateStorageOnStartup();

  console.log(
    `[Storage] provider=${result.provider} bucket=${result.bucket} endpoint=${result.endpoint}`
  );

  for (const w of result.warnings) {
    console.warn(`[Storage] WARNING: ${w}`);
  }

  if (!result.ok) {
    for (const e of result.errors) {
      console.error(`[Storage] ERROR: ${e}`);
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error("Storage validation failed — see logs above.");
    }
    console.warn("[Storage] Continuing in non-production despite validation errors.");
  }
}

module.exports = {
  bootstrapStorage,
  validateStorageOnStartup,
};

export {};
