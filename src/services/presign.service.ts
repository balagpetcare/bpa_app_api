const { getStorageProvider } = require("../infrastructure/storage/storage.factory");

async function getPresignedGetUrl(key: string, expiresInSeconds = 600): Promise<string> {
  const provider = getStorageProvider();
  return provider.getSignedGetUrl(key, expiresInSeconds);
}

module.exports = { getPresignedGetUrl };

export {};
