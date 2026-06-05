/**
 * Backward-compatible S3 client export.
 * Prefer getStorageProvider() for new code.
 */
const { getStorageProvider } = require("./storage.factory");

const s3Client = getStorageProvider().getS3Client();

module.exports = s3Client;

export {};
