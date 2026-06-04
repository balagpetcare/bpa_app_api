import axios from "axios";
import { SslWirelessProvider } from "./sslWireless.provider";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SslWirelessProvider", () => {
  const provider = new SslWirelessProvider();

  beforeEach(() => {
    process.env.SSL_WIRELESS_API_TOKEN = "token";
    process.env.SSL_WIRELESS_SENDER_ID = "BPA";
    process.env.SSL_WIRELESS_BASE_URL = "https://smsplus.sslwireless.com";
    mockedAxios.post.mockReset();
  });

  it("reports configured when credentials exist", () => {
    expect(provider.isConfigured()).toBe(true);
  });

  it("sends SMS and parses success response", async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { status: "SUCCESS", smsinfo: [{ reference_id: "ssl-123" }] },
    });

    const result = await provider.send("01712345678", "Test message");
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("ssl-123");
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://smsplus.sslwireless.com/api/v3/send-sms",
      expect.objectContaining({
        api_token: "token",
        sid: "BPA",
        msisdn: "8801712345678",
        sms: "Test message",
      }),
      expect.any(Object)
    );
  });

  it("returns failure for non-success gateway response", async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { status: "FAILED", message: "Insufficient balance" },
    });

    const result = await provider.send("01712345678", "Test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient balance");
  });
});
