const { S3Client } = require("@aws-sdk/client-s3");
const appConfig = require("../../config/appConfig");

const s3Client = new S3Client({
  region: appConfig.storage.region,
  endpoint: appConfig.storage.endpoint,
  forcePathStyle: true, // MinIO required
  credentials: {
    accessKeyId: appConfig.storage.accessKey,
    secretAccessKey: appConfig.storage.secretKey,
  },
});

module.exports = s3Client;


