/**
 * Worker bootstrap must load dotenv and init Redis subsystem before queue checks.
 */
import * as fs from "fs";
import * as path from "path";

describe("workerEnv.bootstrap", () => {
  it("loads dotenv and initRedisSubsystem like API index.ts", () => {
    const bootstrapSrc = fs.readFileSync(path.join(__dirname, "workerEnv.bootstrap.ts"), "utf8");
    const indexSrc = fs.readFileSync(path.join(__dirname, "../../index.ts"), "utf8");
    expect(bootstrapSrc).toContain("loadDotenv");
    expect(bootstrapSrc).toContain("initRedisSubsystem");
    expect(bootstrapSrc).toContain('require("../../config/env")');
    expect(bootstrapSrc).not.toContain("waitForRedisReady");
    expect(indexSrc).toContain("initRedisSubsystem");
    expect(indexSrc).not.toContain("waitForRedisReady");
  });

  it("notification worker imports bootstrap first and probes Redis", () => {
    const src = fs.readFileSync(path.join(__dirname, "notificationWorker.ts"), "utf8");
    expect(src.indexOf('./workerEnv.bootstrap')).toBeLessThan(src.indexOf("from \"bullmq\""));
    expect(src).toContain("waitForRedisReady");
    expect(src).toContain("Redis connected");
    expect(src).toContain("Notification worker started");
    expect(src).toContain("Listening for jobs");
  });
});
