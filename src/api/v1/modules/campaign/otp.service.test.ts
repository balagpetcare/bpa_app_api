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
    smsLog: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

const sendOtpSMS = jest.fn().mockResolvedValue({ success: true, logId: 1, queued: true });

jest.mock("../../../../shared/services/sms/sms.service", () => ({
  sendOtpSMS: (...args: unknown[]) => sendOtpSMS(...args),
}));

const { requestOtp, verifyOtp, checkOtpRedisHealth } = require("./otp.service");

describe("otp.service SMS delivery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    process.env.CAMPAIGN_JWT_SECRET = "test-secret";
    sendOtpSMS.mockResolvedValue({ success: true, logId: 1, queued: true });
  });

  it("sends OTP SMS via central SMS service", async () => {
    const result = await requestOtp("01712345678", "BOOKING");
    expect(result.success).toBe(true);
    expect(sendOtpSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "01712345678",
        otp: expect.any(String),
        purpose: "CAMPAIGN_BOOKING",
      })
    );
  });

  it("throws when central SMS send fails", async () => {
    sendOtpSMS.mockResolvedValueOnce({ success: false, error: "gateway down" });

    await expect(requestOtp("01712345678", "BOOKING")).rejects.toMatchObject({
      code: "OTP_SEND_FAILED",
    });
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
