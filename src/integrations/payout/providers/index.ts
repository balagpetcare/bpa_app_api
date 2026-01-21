const { MockMfsProvider } = require('./mock_mfs_provider');

function getProviderAdapter(providerName) {
  // Session-3: mock adapters by default. Replace with real adapters when credentials are added.
  return new MockMfsProvider({ providerName });
}

module.exports = { getProviderAdapter };

export {};
