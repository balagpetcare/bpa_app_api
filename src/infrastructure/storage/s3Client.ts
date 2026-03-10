const { S3Client } = require("@aws-sdk/client-s3");
const appConfig = require("../../config/appConfig");
const fs = require("fs");

function isDockerRuntime() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch (_) {
    return false;
  }
}

function resolveStorageEndpoint(rawEndpoint: string): string {
  const endpoint = String(rawEndpoint || "").trim();
  if (!endpoint) return endpoint;
  try {
    const u = new URL(endpoint);
    // Local host runtime cannot resolve docker service DNS ("bpa-storage").
    // Keep docker behavior unchanged; only rewrite for non-docker runtime.
    if (!isDockerRuntime() && u.hostname === "bpa-storage") {
      u.hostname = "localhost";
      return u.toString().replace(/\/$/, "");
    }
    return endpoint;
  } catch (_) {
    return endpoint;
  }
}

const resolvedEndpoint = resolveStorageEndpoint(appConfig.storage.endpoint);

const s3Client = new S3Client({
  region: appConfig.storage.region,
  endpoint: resolvedEndpoint,
  // MinIO compatibility: use path-style addressing
  forcePathStyle: appConfig.storage.forcePathStyle ?? true,
  credentials: {
    accessKeyId: appConfig.storage.accessKeyId,
    secretAccessKey: appConfig.storage.secretAccessKey,
  },
});

module.exports = s3Client;

export {};
