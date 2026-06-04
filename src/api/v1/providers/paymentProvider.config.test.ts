import {
  getActivePaymentProvider,
  getUnifiedPaymentApiPrefix,
  getBkashConfig,
  getNagadConfig,
  getSslCommerzConfig,
  getAmarPayConfig,
  getEpsConfig,
  isEpsConfigured,
  validateActivePaymentProviderConfig,
} from "./paymentProvider.config";

describe("paymentProvider.config callback URLs", () => {
  const prev = process.env.API_PUBLIC_BASE_URL;

  afterEach(() => {
    process.env.API_PUBLIC_BASE_URL = prev;
  });

  it("builds unified callback paths under /api/v1/payments", () => {
    process.env.API_PUBLIC_BASE_URL = "https://api.bpa.com.bd";
    const prefix = getUnifiedPaymentApiPrefix();
    expect(prefix).toBe("https://api.bpa.com.bd/api/v1/payments");
    expect(getBkashConfig().callbackUrl).toBe(`${prefix}/webhook`);
    expect(getNagadConfig().callbackUrl).toBe(`${prefix}/webhook`);
    expect(getSslCommerzConfig().ipnUrl).toBe(`${prefix}/webhook`);
    expect(getAmarPayConfig().ipnUrl).toBe(`${prefix}/webhook`);
  });

  it("validates active provider env keys", () => {
    process.env.API_PUBLIC_BASE_URL = "https://api.bpa.com.bd";
    process.env.PAYMENT_PROVIDER = "sslcommerz";
    delete process.env.SSLCOMMERZ_STORE_ID;
    const result = validateActivePaymentProviderConfig();
    expect(result.provider).toBe("sslcommerz");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("SSLCOMMERZ_STORE_ID"))).toBe(true);
  });

  it("defaults PAYMENT_PROVIDER to eps", () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(getActivePaymentProvider()).toBe("eps");
  });

  it("rejects placeholder EPS credentials", () => {
    process.env.API_PUBLIC_BASE_URL = "https://api.bpa.com.bd";
    process.env.PAYMENT_PROVIDER = "eps";
    process.env.EPS_USERNAME = "<sandbox_username>";
    process.env.EPS_PASSWORD = "real_password";
    process.env.EPS_HASH = "abc123";
    process.env.EPS_STORE_ID = "store-uuid";
    process.env.EPS_MERCHANT_ID = "merchant-uuid";
    expect(isEpsConfigured()).toBe(false);
    const result = validateActivePaymentProviderConfig();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("placeholder"))).toBe(true);
  });

  it("builds EPS callback URLs under unified prefix", () => {
    process.env.API_PUBLIC_BASE_URL = "https://api.bpa.com.bd";
    const prefix = getUnifiedPaymentApiPrefix();
    const eps = getEpsConfig();
    expect(eps.successUrl).toBe(`${prefix}/webhook/redirect/success`);
    expect(eps.failUrl).toBe(`${prefix}/webhook/redirect/fail`);
    expect(eps.cancelUrl).toBe(`${prefix}/webhook/redirect/cancel`);
  });

  it("validates EPS required env when active", () => {
    process.env.API_PUBLIC_BASE_URL = "https://api.bpa.com.bd";
    process.env.PAYMENT_PROVIDER = "eps";
    delete process.env.EPS_USERNAME;
    const result = validateActivePaymentProviderConfig();
    expect(result.provider).toBe("eps");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("EPS_USERNAME"))).toBe(true);
    expect(isEpsConfigured()).toBe(false);
  });
});
