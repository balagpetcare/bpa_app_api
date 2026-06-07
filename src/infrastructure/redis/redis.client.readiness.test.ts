import { EventEmitter } from "events";

const connectMock = jest.fn();
const pingMock = jest.fn();

class MockRedis extends EventEmitter {
  status = "wait";
  connect = connectMock;
  ping = pingMock;
}

const mockInstance = new MockRedis();

jest.mock("ioredis", () => jest.fn(() => mockInstance));

jest.mock("./redisConnection", () => ({
  isRedisEnabled: jest.fn(() => true),
  getRedisConnectionOptions: jest.fn(() => ({
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 5000,
  })),
  getRedisConnectTimeoutMs: jest.fn(() => 5000),
  getRedisMaxConnectRetries: jest.fn(() => 10),
  parseRedisEndpoint: jest.fn(() => ({
    host: "127.0.0.1",
    port: 6379,
    db: 0,
    authConfigured: false,
    tls: false,
    source: "host_port",
    displayTarget: "127.0.0.1:6379",
  })),
}));

describe("redis.client readiness", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockInstance.removeAllListeners();
    mockInstance.status = "wait";
    connectMock.mockImplementation(async () => {
      mockInstance.status = "connect";
      setImmediate(() => {
        mockInstance.status = "ready";
        mockInstance.emit("ready");
      });
    });
    pingMock.mockImplementation(async () => {
      if (mockInstance.status !== "ready") {
        throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
      }
      return "PONG";
    });
    process.env.REDIS_ENABLED = "true";
  });

  it("waitForRedisReady waits for ready event before ping (lazyConnect safe)", async () => {
    const { initRedisSubsystem, waitForRedisReady } = require("./redis.client");
    initRedisSubsystem();

    const ready = await waitForRedisReady();
    expect(ready).toBe(true);
    expect(connectMock).toHaveBeenCalled();
    expect(pingMock).toHaveBeenCalled();
  });

  it("probeRedisConnection delegates to waitForRedisReady", async () => {
    const { initRedisSubsystem, probeRedisConnection } = require("./redis.client");
    initRedisSubsystem();

    const ok = await probeRedisConnection();
    expect(ok).toBe(true);
    expect(pingMock).toHaveBeenCalled();
  });

  it("initRedisSubsystem does not start readiness timeout before worker module load", async () => {
    connectMock.mockImplementation(async () => {
      mockInstance.status = "connect";
      setTimeout(() => {
        mockInstance.status = "ready";
        mockInstance.emit("ready");
      }, 80);
    });

    const { initRedisSubsystem, waitForRedisReady } = require("./redis.client");
    initRedisSubsystem();

    // Simulate slow ts-node/prisma/bullmq imports after bootstrap (API-style gap).
    await new Promise((resolve) => setTimeout(resolve, 120));

    const ready = await waitForRedisReady();
    expect(ready).toBe(true);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
