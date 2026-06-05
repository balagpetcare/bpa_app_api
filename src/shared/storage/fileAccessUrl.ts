const jwt = require("jsonwebtoken");
const appConfig = require("../../config/appConfig");
const { getPresignedGetUrl } = require("../../services/presign.service");
const { resolveStorageConfig } = require("../../infrastructure/storage/storage.config");

function usePresignedPrivateUrls(): boolean {
  const raw = process.env.STORAGE_USE_PRESIGNED_PRIVATE_URLS;
  if (raw != null) {
    return String(raw).toLowerCase() === "true" || String(raw) === "1";
  }
  // B2: prefer presigned direct URLs (no API proxy bandwidth)
  return resolveStorageConfig().provider === "b2";
}

/**
 * Build a URL for private document preview (KYC, verification).
 * - B2 (default): S3 presigned GET URL
 * - MinIO (default): API proxy with short-lived JWT ?token=
 */
async function buildPrivateFileAccessUrl({
  key,
  userId,
  baseUrl,
  expiresInSeconds = 1200,
}: {
  key: string;
  userId: number;
  baseUrl: string;
  expiresInSeconds?: number;
}): Promise<string> {
  if (!key) return "";

  if (usePresignedPrivateUrls()) {
    return getPresignedGetUrl(key, expiresInSeconds);
  }

  const token = jwt.sign(
    { purpose: "FILE_VIEW", fileKey: key, userId: Number(userId) },
    appConfig.jwt.secret,
    { expiresIn: Math.min(expiresInSeconds, 20 * 60) }
  );

  return `${baseUrl}/api/v1/files/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`;
}

module.exports = {
  buildPrivateFileAccessUrl,
  usePresignedPrivateUrls,
};

export {};
