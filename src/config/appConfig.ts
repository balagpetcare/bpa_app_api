require("dotenv").config();

const API_VERSION = process.env.API_VERSION || "v1";

function boolEnv(name, def = false) {
  const v = process.env[name];
  if (v == null) return def;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

module.exports = {
  server: {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "localhost",
  },

  api: {
    version: API_VERSION,
    prefix: `/api/${API_VERSION}`, // /api/v1
  },

  jwt: {
    secret: process.env.JWT_SECRET || "super-secret-key",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  storage: {
    region: process.env.AWS_REGION || "us-east-1",
    bucketName: process.env.AWS_BUCKET_NAME || "bpa-pets",
    // Phase 3: per-country prefix in key (e.g. BD/, IN/) when true; single bucket
    useCountryPrefix: boolEnv("STORAGE_USE_COUNTRY_PREFIX", true),
    // Internal endpoint (API container -> MinIO). In docker-compose this is usually http://bpa-storage:9000
    endpoint: process.env.AWS_ENDPOINT || "http://localhost:9000",
    // Public URL (mobile/browser). Should be reachable from the client device.
    // Example: http://192.168.x.x:9000
    publicUrl: process.env.MINIO_PUBLIC_URL || "",
    forcePathStyle: boolEnv("AWS_FORCE_PATH_STYLE", true),

    // Credentials
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "admin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "password123",
  },

  mediaPolicy: {
    // Single source of truth for upload limits & compression.
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024),
    imageMaxSide: Number(process.env.IMAGE_MAX_SIDE || 1600),
    imageJpegQuality: Number(process.env.IMAGE_JPEG_QUALITY || 82),
    transcodeVideo: String(process.env.VIDEO_TRANSCODE || "false").toLowerCase() === "true",
  },
};

export {};
