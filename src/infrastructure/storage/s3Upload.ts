// src/infrastructure/storage/s3Upload.js
const crypto = require("crypto");
const path = require("path");
const { getStorageProvider } = require("./storage.factory");

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
 * Upload buffer to configured storage provider (MinIO or B2).
 */
async function uploadBuffer(body, { originalname, mimetype, prefix = "uploads" }) {
  const provider = getStorageProvider();
  const objectKey = `${prefix}/${safeName(originalname)}`;

  await provider.putObject({
    key: objectKey,
    body,
    contentType: mimetype || "application/octet-stream",
  });

  const url = provider.buildPublicUrl(objectKey);

  return { bucket: provider.config.bucketName, objectKey, url };
}

module.exports = { uploadBuffer };

export {};
