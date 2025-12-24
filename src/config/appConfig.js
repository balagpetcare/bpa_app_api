require("dotenv").config();

const API_VERSION = process.env.API_VERSION || "v1";
const API_PREFIX = `/api/${API_VERSION}`;

const appConfig = {
  // ===============================
  // Server Config
  // ===============================
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || "localhost",
  },

  // ===============================
  // API Versioning (⭐ MOST IMPORTANT)
  // ===============================
  api: {
    version: API_VERSION,
    prefix: API_PREFIX, // 👉 /api/v1
  },

  // ===============================
  // Security
  // ===============================
  jwt: {
    secret: process.env.JWT_SECRET || "super-secret-key",
    expiresIn: "30d",
  },

  // ===============================
  // Storage (S3 / MinIO)
  // ===============================
  storage: {
    bucketName: process.env.AWS_BUCKET_NAME || "bpa-pets",
    endpoint: process.env.AWS_ENDPOINT || "http://127.0.0.1:9000",
    publicUrl: process.env.MINIO_PUBLIC_URL || "http://localhost:9000",
    region: process.env.AWS_REGION || "us-east-1",
    accessKey: process.env.AWS_ACCESS_KEY,
    secretKey: process.env.AWS_SECRET_KEY,
  },
};

module.exports = appConfig;
