/**
 * Worker bootstrap must load dotenv and init Redis subsystem before queue checks.
 */
import * as fs from "fs";
import * as path from "path";

describe("workerEnv.bootstrap", () => {
  it("loads dotenv and initRedisSubsystem like API index.ts", () => {
    const src = fs.readFileSync(path.join(__dirname, "workerEnv.bootstrap.ts"), "utf8");
    expect(src).toContain('loadDotenv');
    expect(src).toContain("initRedisSubsystem");
    expect(src).toContain('require("../../config/env")');
  });

  it("notification worker imports bootstrap first and probes Redis", () => {
    const src = fs.readFileSync(path.join(__dirname, "notificationWorker.ts"), "utf8");
    expect(src.indexOf('./workerEnv.bootstrap')).toBeLessThan(src.indexOf("from \"bullmq\""));
    expect(src).toContain("probeRedisConnection");
    expect(src).toContain("Redis connected");
    expect(src).toContain("Notification worker started");
    expect(src).toContain("Listening for jobs");
  });
});
