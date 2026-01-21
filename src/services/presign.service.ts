const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../infrastructure/storage/s3Client");

async function getPresignedGetUrl(key, expiresInSeconds = 600) {
  const bucket =
    process.env.AWS_BUCKET_NAME ||
    process.env.MINIO_BUCKET ||
    "bpa-pets";

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

module.exports = { getPresignedGetUrl };

export {};
