export class PayoutProviderBase {
  public providerName: string;

  constructor({ providerName }: { providerName: string }) {
    this.providerName = providerName;
  }

  /**
   * Initiate a payout.
   * @param payload
   */
  async createPayout(payload: { amount: number; destination: any; idempotencyKey: string; reference?: string }): Promise<{ providerPayoutId: string; providerStatus: string; raw: any }> {
    throw new Error('Not implemented');
  }

  /**
   * Query payout status.
   */
  async getPayoutStatus(payload: { providerPayoutId: string }): Promise<{ providerStatus: string; raw: any }> {
    throw new Error('Not implemented');
  }

  /**
   * Verify webhook signature (optional).
   */
  verifyWebhookSignature({ headers, body }: { headers: any; body: any }): boolean {
    return false;
  }
}
