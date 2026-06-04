jest.mock("../../../infrastructure/redis/redis.client", () => ({
  areRedisQueuesEnabled: jest.fn(() => true),
}));

jest.mock("bullmq", () => {
  const add = jest.fn().mockResolvedValue({ id: "job-1" });
  const getJobCounts = jest.fn().mockResolvedValue({ waiting: 2, active: 1, failed: 0, delayed: 0 });
  return {
    Queue: jest.fn().mockImplementation(() => ({ add, getJobCounts })),
  };
});

describe("notificationQueue", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, REDIS_ENABLED: "true", REDIS_URL: "redis://127.0.0.1:6379" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("enqueueSmsJob returns true when Redis enabled", async () => {
    const { enqueueSmsJob } = require("./notificationQueue");
    const ok = await enqueueSmsJob({
      notificationId: 0,
      userId: 0,
      channel: "SMS",
      toAddress: "01712345678",
      type: "CAMPAIGN_OTP",
      title: "OTP",
      message: "code 123456",
    });
    expect(ok).toBe(true);
  });

  it("enqueueSmsJob returns false when Redis disabled", async () => {
    process.env = { ...originalEnv, REDIS_ENABLED: "false" };
    delete process.env.REDIS_URL;
    const { enqueueSmsJob } = require("./notificationQueue");
    const ok = await enqueueSmsJob({
      notificationId: 0,
      userId: 0,
      channel: "SMS",
      toAddress: "01712345678",
      type: "CAMPAIGN_OTP",
      title: "OTP",
      message: "code",
    });
    expect(ok).toBe(false);
  });
});
