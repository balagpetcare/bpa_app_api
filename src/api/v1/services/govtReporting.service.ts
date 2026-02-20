/**
 * Phase 4: Government reporting hook (threshold -> notify).
 * When donation/transaction exceeds threshold, log and optionally POST to webhook.
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */

const GOVT_REPORTING_WEBHOOK_URL = process.env.GOVT_REPORTING_WEBHOOK_URL || "";
const GOVT_REPORTING_DONATION_THRESHOLD = Number(process.env.GOVT_REPORTING_DONATION_THRESHOLD) || 0;

export type GovtReportPayload = {
  type: "DONATION";
  amount: number;
  donationId?: number;
  countryCode?: string;
  campaignId?: number;
  donorId?: number;
  timestamp: string;
};

/**
 * Check if donation amount exceeds reporting threshold and notify (log + optional webhook).
 * Non-blocking; never throws.
 */
export async function notifyDonationThresholdExceeded(payload: {
  amount: number;
  donationId: number;
  countryCode?: string;
  campaignId?: number;
  donorId?: number;
}): Promise<void> {
  if (GOVT_REPORTING_DONATION_THRESHOLD <= 0 || payload.amount < GOVT_REPORTING_DONATION_THRESHOLD) {
    return;
  }

  const body: GovtReportPayload = {
    type: "DONATION",
    amount: payload.amount,
    donationId: payload.donationId,
    countryCode: payload.countryCode,
    campaignId: payload.campaignId,
    donorId: payload.donorId,
    timestamp: new Date().toISOString(),
  };

  // Always log (structure only)
  console.info("[GovtReporting] threshold exceeded", JSON.stringify(body));

  if (!GOVT_REPORTING_WEBHOOK_URL) {
    return;
  }

  try {
    const res = await fetch(GOVT_REPORTING_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("[GovtReporting] webhook non-OK", res.status, await res.text());
    }
  } catch (err) {
    console.warn("[GovtReporting] webhook error", err);
  }
}
