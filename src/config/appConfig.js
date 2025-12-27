require("dotenv").config();

const API_VERSION = process.env.API_VERSION || "v1";

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
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  },

  storage: {
    bucketName: process.env.AWS_BUCKET_NAME || "bpa-pets",
    endpoint: process.env.AWS_ENDPOINT || "http://127.0.0.1:9000",
    publicUrl: process.env.MINIO_PUBLIC_URL || "http://localhost:9000",
    region: process.env.AWS_REGION || "us-east-1",
    accessKey: process.env.AWS_ACCESS_KEY || "admin",
    secretKey: process.env.AWS_SECRET_KEY || "password123",
  },
};
