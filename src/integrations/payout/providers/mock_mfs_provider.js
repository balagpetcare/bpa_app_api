const { PayoutProviderBase } = require('./provider_base');

class MockMfsProvider extends PayoutProviderBase {
  constructor({ providerName }) {
    super({ providerName });
  }

  async createPayout(payload) {
    const providerPayoutId = `${this.providerName}-${Date.now()}-${payload.idempotencyKey}`;
    return {
      providerPayoutId,
      providerStatus: 'PROCESSING',
      raw: { ok: true, provider: this.providerName, providerPayoutId },
    };
  }

  async queryPayout(providerPayoutId) {
    // Simulate success after ~3 seconds based on timestamp in id
    const parts = String(providerPayoutId).split('-');
    const ts = Number(parts[1] || 0);
    const ageMs = Date.now() - ts;

    if (ageMs >= 3000) {
      return { providerStatus: 'TRANSFERRED', isFinal: true, isSuccess: true, raw: { providerPayoutId } };
    }
    return { providerStatus: 'PROCESSING', isFinal: false, isSuccess: false, raw: { providerPayoutId } };
  }

  verifyWebhookSignature() {
    return true; // dev-friendly
  }
}

module.exports = { MockMfsProvider };
