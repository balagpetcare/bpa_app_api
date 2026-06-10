/**
 * Sync campaign payment settings from backend-api admin to vaccination-api (public booking).
 */

type PaymentChannelMode =
  | "SMS_ONLY"
  | "EPS_ONLY"
  | "SMS_AND_EPS"
  | "EPS_WITH_SMS_FALLBACK";

export type VaccinationPaymentConfig = {
  onlinePaymentEnabled: boolean;
  paymentChannelMode: PaymentChannelMode;
};

function vaccinationApiBase(): string | null {
  const base = process.env.VACCINATION_API_BASE_URL?.trim();
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

function vaccinationInternalSecret(): string | null {
  const secret = process.env.VACCINATION_API_INTERNAL_SECRET?.trim();
  return secret || null;
}

export function isVaccinationPaymentSyncConfigured(): boolean {
  return Boolean(vaccinationApiBase() && vaccinationInternalSecret());
}

export async function fetchVaccinationPaymentConfigBySlug(
  slug: string,
): Promise<VaccinationPaymentConfig | null> {
  const base = vaccinationApiBase();
  const secret = vaccinationInternalSecret();
  if (!base || !secret) return null;

  const res = await fetch(
    `${base}/api/v1/internal/campaigns/by-slug/${encodeURIComponent(slug)}/payment-config`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Vaccination-Internal-Secret": secret,
      },
    },
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[vaccination-sync] fetch failed", { slug, status: res.status, body });
    return null;
  }

  const json = (await res.json()) as { data?: VaccinationPaymentConfig };
  return json.data ?? null;
}

export async function syncVaccinationPaymentConfigBySlug(
  slug: string,
  payload: VaccinationPaymentConfig,
): Promise<void> {
  const base = vaccinationApiBase();
  const secret = vaccinationInternalSecret();
  if (!base || !secret) {
    console.warn("[vaccination-sync] skipped — VACCINATION_API_BASE_URL or secret not configured");
    return;
  }

  const res = await fetch(
    `${base}/api/v1/internal/campaigns/by-slug/${encodeURIComponent(slug)}/payment-config`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Vaccination-Internal-Secret": secret,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to sync payment settings to vaccination API (${res.status}): ${body || res.statusText}`,
    );
  }
}
