process.env.NODE_ENV = "test";
process.env.SMS_PRIMARY_PROVIDER = "ssl_wireless";
process.env.SMS_FALLBACK_PROVIDER = "bulksmsbd";
process.env.SMS_ENABLED = "true";

import { bulkSmsBdProvider } from "./bulkSmsBd.provider";
import { MockSmsProvider } from "./mock.provider";
import { sslWirelessProvider } from "./sslWireless.provider";
import { getRecentSmsFailures, sendSmsViaGateway } from "./smsGateway.service";

describe("smsGateway.service", () => {
  beforeEach(() => {
    MockSmsProvider.reset();
    jest.restoreAllMocks();
    process.env.SMS_PRIMARY_PROVIDER = "mock";
    process.env.SMS_FALLBACK_PROVIDER = "mock";
  });

  it("sends via mock provider in test mode", async () => {
    const result = await sendSmsViaGateway("01712345678", "Hello campaign", {
      template: "CAMPAIGN_OTP",
      campaignSmsLogId: 42,
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mock");
    expect(MockSmsProvider.sent).toHaveLength(1);
    expect(MockSmsProvider.sent[0].phone).toBe("01712345678");
  });

  it("records failures when primary and fallback providers fail", async () => {
    process.env.SMS_PRIMARY_PROVIDER = "ssl_wireless";
    process.env.SMS_FALLBACK_PROVIDER = "bulksmsbd";

    jest.spyOn(sslWirelessProvider, "isConfigured").mockReturnValue(true);
    jest.spyOn(sslWirelessProvider, "send").mockResolvedValue({
      success: false,
      provider: "ssl_wireless",
      error: "Primary down",
    });
    jest.spyOn(bulkSmsBdProvider, "isConfigured").mockReturnValue(true);
    jest.spyOn(bulkSmsBdProvider, "send").mockResolvedValue({
      success: false,
      provider: "bulksmsbd",
      error: "Fallback down",
    });

    await expect(sendSmsViaGateway("01712345678", "fail test")).rejects.toThrow("Fallback down");

    const failures = getRecentSmsFailures(5);
    expect(failures.some((f) => f.provider === "ssl_wireless")).toBe(true);
    expect(failures.some((f) => f.provider === "bulksmsbd")).toBe(true);
  });
});
