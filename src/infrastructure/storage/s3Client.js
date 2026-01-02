const { S3Client } = require("@aws-sdk/client-s3");
const appConfig = require("../../config/appConfig");

const s3Client = new S3Client({
  region: appConfig.storage.region,
  endpoint: appConfig.storage.endpoint,
  // MinIO compatibility: use path-style addressing
  forcePathStyle: appConfig.storage.forcePathStyle ?? true,
  credentials: {
    accessKeyId: appConfig.storage.accessKeyId,
    secretAccessKey: appConfig.storage.secretAccessKey,
  },
});

module.exports = s3Client;


