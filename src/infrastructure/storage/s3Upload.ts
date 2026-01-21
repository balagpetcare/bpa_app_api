// src/infrastructure/storage/s3Upload.js
const crypto = require("crypto");
const path = require("path");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = require("./s3Client");
const appConfig = require("../../config/appConfig");

function safeName(originalName = "file") {
  const ext = (path.extname(originalName) || "").toLowerCase();
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 60);
  const rand = crypto.randomBytes(6).toString("hex");
  return `${base || "file"}_${Date.now()}_${rand}${ext || ""}`;
}

/**
 * Upload buffer to S3/MinIO
 * @param {Buffer} body
 * @param {Object} opts
 * @param {String} opts.originalname
 * @param {String} opts.mimetype
 * @param {String} opts.prefix e.g. "pets/123"
 */
async function uploadBuffer(body, { originalname, mimetype, prefix = "uploads" }) {
  const bucket = appConfig.storage.bucketName; // ✅ FIX (was bucket)
  const objectKey = `${prefix}/${safeName(originalname)}`;

  // ✅ quick debug (remove later if you want)
  // console.log("Uploading to bucket:", bucket);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: mimetype || "application/octet-stream",
    })
  );

  // ✅ Public URL building (use config publicUrl)
  const publicBaseUrl = appConfig.storage.publicUrl || appConfig.storage.endpoint; // ✅ FIX (was publicBaseUrl)
  const url = `${publicBaseUrl}/${bucket}/${objectKey}`;

  return { bucket, objectKey, url };
}

module.exports = { uploadBuffer };

export {};
