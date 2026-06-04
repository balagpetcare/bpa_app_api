const redisStore = new Map<string, string>();

const redisMock = {
  incr: jest.fn(async (key: string) => {
    const n = Number(redisStore.get(`incr:${key}`) || "0") + 1;
    redisStore.set(`incr:${key}`, String(n));
    return n;
  }),
  expire: jest.fn(async () => 1),
  setex: jest.fn(async (key: string, _ttl: number, val: string) => {
    redisStore.set(key, val);
    return "OK";
  }),
  get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
  del: jest.fn(async (key: string) => {
    redisStore.delete(key);
    return 1;
  }),
  ping: jest.fn(async () => "PONG"),
};

jest.mock("ioredis", () => jest.fn(() => redisMock));

jest.mock("../../../../infrastructure/redis/redisConnection", () => ({
  isRedisEnabled: jest.fn(() => true),
  getRedisConnectionOptions: jest.fn(() => ({
    host: "localhost",
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

jest.mock("../../../../infrastructure/redis/redis.client", () => ({
  isRedisAvailable: jest.fn(() => true),
}));

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    userAuth: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock("./campaign.smsQueue", () => ({
  enqueueCampaignSmsMessage: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../services/sms.service", () => ({
  sendSms: jest.fn(),
}));

const { requestOtp, verifyOtp, checkOtpRedisHealth } = require("./otp.service");
const { enqueueCampaignSmsMessage } = require("./campaign.smsQueue");

describe("otp.service SMS delivery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    process.env.CAMPAIGN_JWT_SECRET = "test-secret";
  });

  it("queues OTP SMS via campaign SMS queue", async () => {
    const result = await requestOtp("01712345678", "BOOKING");
    expect(result.success).toBe(true);
    expect(enqueueCampaignSmsMessage).toHaveBeenCalledWith(
      "01712345678",
      expect.stringMatching(/vaccination code/i),
      expect.objectContaining({ template: "CAMPAIGN_OTP" })
    );
  });

  it("falls back to direct SMS when queue returns false", async () => {
    enqueueCampaignSmsMessage.mockResolvedValueOnce(false);
    const { sendSms } = require("../../services/sms.service");
    sendSms.mockResolvedValueOnce({ success: true, provider: "ssl_wireless", messageId: "m1" });

    await requestOtp("01712345678", "BOOKING");
    expect(sendSms).toHaveBeenCalled();
  });

  it("verifyOtp succeeds after valid code", async () => {
    const crypto = require("crypto");
    const otp = "654321";
    const hash = crypto.createHash("sha256").update(otp).digest("hex");
    redisStore.set(
      "campaign:otp:01712345678:BOOKING",
      JSON.stringify({ hash, attempts: 0, createdAt: Date.now() })
    );

    const session = await verifyOtp("01712345678", otp, "BOOKING");
    expect(session.token).toBeDefined();
    expect(session.phone).toBe("01712345678");
  });

  it("checkOtpRedisHealth returns true when ping ok", async () => {
    await expect(checkOtpRedisHealth()).resolves.toBe(true);
  });
});
