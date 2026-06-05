const { resolveStorageConfig } = require("./storage.config");
const { createS3CompatibleProvider } = require("./s3Compatible.provider");

let cachedProvider: ReturnType<typeof createS3CompatibleProvider> | null = null;

function getStorageProvider() {
  if (!cachedProvider) {
    const config = resolveStorageConfig();
    cachedProvider = createS3CompatibleProvider(config);
  }
  return cachedProvider;
}

/** Test-only: reset singleton between tests. */
function resetStorageProviderForTests() {
  cachedProvider = null;
}

module.exports = {
  getStorageProvider,
  resetStorageProviderForTests,
};

export {};
