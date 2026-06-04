/**
 * Production SMS validation script (run with live credentials).
 *
 *   npx ts-node scripts/sms-production-check.ts --phone 017XXXXXXXX
 *   npx ts-node scripts/sms-production-check.ts --health-only
 */
import "dotenv/config";
import { getSmsInfrastructureHealth } from "../src/api/v1/modules/campaign/smsQueueRecovery.service";
import { checkOtpRedisHealth } from "../src/api/v1/modules/campaign/otp.service";
import { sendSmsViaGateway, getRecentSmsFailures } from "../src/integrations/sms/smsGateway.service";

async function main() {
  const args = process.argv.slice(2);
  const healthOnly = args.includes("--health-only");
  const phoneArg = args.find((a) => a.startsWith("--phone="));
  const phone = phoneArg?.split("=")[1];

  console.log("=== SMS Production Check ===\n");

  const redisOk = await checkOtpRedisHealth();
  console.log("Redis (OTP ping):", redisOk ? "OK" : "FAIL");

  const health = await getSmsInfrastructureHealth();
  console.log("Infrastructure:", JSON.stringify(health, null, 2));

  if (healthOnly) {
    process.exit(health.redisEnabled && health.providers.smsEnabled ? 0 : 1);
  }

  if (!phone) {
    console.log("\nSkip live send (pass --phone=017XXXXXXXX to test real SMS)");
    process.exit(health.redisEnabled ? 0 : 1);
  }

  const testMessage = `BPA SMS test ${new Date().toISOString()}`;
  try {
    const result = await sendSmsViaGateway(phone, testMessage, { template: "PRODUCTION_CHECK" });
    console.log("\nLive send result:", result);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error("\nLive send failed:", (err as Error).message);
    console.log("Recent failures:", getRecentSmsFailures(5));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
