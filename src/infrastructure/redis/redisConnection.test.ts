describe("redisConnection", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("isRedisEnabled is false when REDIS_ENABLED=false even if REDIS_URL is set", () => {
    process.env.REDIS_ENABLED = "false";
    process.env.REDIS_URL = "redis://localhost:6379";
    const { isRedisEnabled } = require("./redisConnection");
    expect(isRedisEnabled()).toBe(false);
  });

  it("isRedisEnabled is true when REDIS_URL is set and REDIS_ENABLED is not false", () => {
    delete process.env.REDIS_ENABLED;
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    const { isRedisEnabled } = require("./redisConnection");
    expect(isRedisEnabled()).toBe(true);
  });

  it("parseRedisEndpoint reads host and port from REDIS_URL", () => {
    process.env.REDIS_URL = "redis://:secret@cache.internal:6380/2";
    const { parseRedisEndpoint } = require("./redisConnection");
    const ep = parseRedisEndpoint();
    expect(ep.host).toBe("cache.internal");
    expect(ep.port).toBe(6380);
    expect(ep.db).toBe(2);
    expect(ep.authConfigured).toBe(true);
  });

  it("getRedisConnectionOptions uses host/port when URL absent", () => {
    delete process.env.REDIS_URL;
    process.env.REDIS_HOST = "bpa-redis";
    process.env.REDIS_PORT = "6379";
    const { getRedisConnectionOptions } = require("./redisConnection");
    const opts = getRedisConnectionOptions();
    expect(opts.host).toBe("bpa-redis");
    expect(opts.port).toBe(6379);
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.enableOfflineQueue).toBe(false);
  });
});
