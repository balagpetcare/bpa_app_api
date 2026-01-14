class PayoutProviderBase {
  constructor({ providerName }) {
    this.providerName = providerName;
  }

  /**
   * Initiate a payout.
   * @param {{amount:number, destination:any, idempotencyKey:string, reference?:string}} payload
   * @returns {Promise<{providerPayoutId:string, providerStatus:string, raw:any}>}
   */
  async createPayout(payload) {
    throw new Error('Not implemented');
  }

  /**
   * Query payout status.
   * @param {string} providerPayoutId
   * @returns {Promise<{providerStatus:string, isFinal:boolean, isSuccess:boolean, raw:any, failureCode?:string, failureMessage?:string}>}
   */
  async queryPayout(providerPayoutId) {
    throw new Error('Not implemented');
  }

  /**
   * Verify webhook signature (optional).
   */
  verifyWebhookSignature({ headers, body }) {
    return false;
  }
}

module.exports = { PayoutProviderBase };
