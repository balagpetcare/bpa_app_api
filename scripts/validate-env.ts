/**
 * Validates environment variables required for BPA API startup.
 * Run: npm run validate:env
 * Loads .env from project root via dotenv (same as the API).
 */
import "dotenv/config";

type Severity = "critical" | "warning";

type CheckResult = {
  name: string;
  severity: Severity;
  ok: boolean;
  message: string;
};

function isSet(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && String(v).trim());
}

function isProduction(): boolean {
  return String(process.env.NODE_ENV || "development").toLowerCase() === "production";
}

function isTruthy(name: string): boolean {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

function isFalsy(name: string): boolean {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "false" || v === "0";
}

/** Mirrors paymentProvider.config placeholder detection. */
function isPlaceholder(value: string | undefined): boolean {
  const t = value?.trim();
  if (!t) return true;
  if (/^<[^>]+>$/.test(t)) return true;
  if (t === "..." || t === "changeme" || t === "your_value_here") return true;
  if (/^change_me/i.test(t)) return true;
  return false;
}

function requireVar(name: string, severity: Severity, when = true): CheckResult {
  const ok = when ? isSet(name) && !isPlaceholder(process.env[name]) : true;
  return {
    name,
    severity,
    ok,
    message: ok
      ? `${name} is set`
      : !isSet(name)
        ? `${name} is missing or empty`
        : `${name} looks like a placeholder — set a real value`,
  };
}

function getActivePaymentProvider(): string {
  const raw = (process.env.PAYMENT_PROVIDER || "eps").toLowerCase().trim();
  const valid = ["sslcommerz", "amarpay", "bkash", "nagad", "eps"];
  return valid.includes(raw) ? raw : "eps";
}

function paymentProviderKeys(provider: string): string[] {
  switch (provider) {
    case "bkash":
      return ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD"];
    case "nagad":
      return ["NAGAD_MERCHANT_ID", "NAGAD_PUBLIC_KEY", "NAGAD_PRIVATE_KEY"];
    case "sslcommerz":
      return ["SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD"];
    case "amarpay":
      return ["AMARPAY_STORE_ID", "AMARPAY_SIGNATURE_KEY"];
    case "eps":
      return [
        "EPS_USERNAME",
        "EPS_PASSWORD",
        "EPS_HASH_KEY",
        "EPS_STORE_ID",
        "EPS_MERCHANT_ID",
      ];
    default:
      return [];
  }
}

function getStorageProvider(): string {
  const p = String(process.env.STORAGE_PROVIDER || "minio").trim().toLowerCase();
  if (p === "b2" || p === "backblaze" || p === "backblaze-b2") return "b2";
  return "minio";
}

function runChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const prod = isProduction();

  // --- Critical: API cannot start without DATABASE_URL (Prisma throws on import) ---
  results.push(requireVar("DATABASE_URL", "critical"));

  // JWT — lib/auth.ts throws if unset; appConfig has weak fallback
  results.push(requireVar("JWT_SECRET", prod ? "critical" : "warning"));

  // Prisma migrate dev
  if (process.argv.includes("--migrate-dev")) {
    results.push(requireVar("SHADOW_DATABASE_URL", "critical"));
  }

  // Public API base for payment callbacks
  const needsPaymentBase =
    prod || isTruthy("VALIDATE_PAYMENT_CONFIG");
  const hasPublicBase =
    isSet("API_PUBLIC_BASE_URL") ||
    isSet("BACKEND_PUBLIC_URL") ||
    isSet("APP_URL");
  results.push({
    name: "API_PUBLIC_BASE_URL",
    severity: prod ? "critical" : "warning",
    ok: !needsPaymentBase || hasPublicBase,
    message: hasPublicBase
      ? "Public API base URL is configured"
      : "Set API_PUBLIC_BASE_URL (or BACKEND_PUBLIC_URL / APP_URL) for payment callback URLs",
  });

  // Active payment provider
  const provider = getActivePaymentProvider();
  if (prod || isTruthy("VALIDATE_PAYMENT_CONFIG")) {
    for (const key of paymentProviderKeys(provider)) {
      if (key === "EPS_HASH_KEY" && isSet("EPS_HASH")) continue;
      if (key === "EPS_MERCHANT_ID" && isSet("EPS_MERCHANTID")) continue;
      results.push(requireVar(key, prod ? "critical" : "warning"));
    }
  }

  // Storage
  const storage = getStorageProvider();
  if (storage === "b2") {
    for (const key of [
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "STORAGE_PUBLIC_URL",
    ]) {
      results.push(requireVar(key, prod ? "critical" : "warning"));
    }
  } else {
    for (const key of ["AWS_ENDPOINT", "AWS_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
      const alt =
        key === "AWS_ENDPOINT"
          ? "S3_ENDPOINT"
          : key === "AWS_BUCKET_NAME"
            ? "S3_BUCKET"
            : key === "AWS_ACCESS_KEY_ID"
              ? "S3_ACCESS_KEY"
              : "S3_SECRET_KEY";
      const ok =
        (isSet(key) && !isPlaceholder(process.env[key])) ||
        (isSet(alt) && !isPlaceholder(process.env[alt]));
      results.push({
        name: key,
        severity: prod ? "critical" : "warning",
        ok,
        message: ok ? `${key} (or ${alt}) is set` : `${key} or ${alt} is missing for MinIO/S3 storage`,
      });
    }
  }

  // Redis — required for BullMQ SMS/email workers when enabled
  const redisEnabled = !isFalsy("REDIS_ENABLED");
  if (redisEnabled && prod) {
    const redisOk = isSet("REDIS_URL") || isSet("REDIS_HOST");
    results.push({
      name: "REDIS_URL",
      severity: "warning",
      ok: redisOk,
      message: redisOk
        ? "Redis connection configured"
        : "REDIS_ENABLED is on but REDIS_URL / REDIS_HOST is missing",
    });
  }

  // SMS — when enabled in production
  const smsEnabled = !isFalsy("SMS_ENABLED");
  if (smsEnabled && prod && !isTruthy("SMS_ALLOW_MOCK")) {
    const primary = (
      process.env.SMS_PROVIDER ||
      process.env.SMS_PRIMARY_PROVIDER ||
      "bulksmsbd"
    ).toLowerCase();
    if (primary === "ssl_wireless") {
      results.push(requireVar("SSL_WIRELESS_API_TOKEN", "critical"));
      const sender =
        process.env.SSL_WIRELESS_SENDER_ID?.trim() ||
        process.env.CAMPAIGN_SMS_SENDER_ID?.trim();
      results.push({
        name: "SSL_WIRELESS_SENDER_ID",
        severity: "critical",
        ok: Boolean(sender) && !isPlaceholder(sender),
        message: sender
          ? "SSL Wireless sender ID configured"
          : "SSL Wireless sender ID required (SSL_WIRELESS_SENDER_ID or CAMPAIGN_SMS_SENDER_ID)",
      });
    } else {
      const apiKey =
        process.env.SMS_API_KEY ||
        process.env.BULKSMSBD_API_KEY ||
        process.env.BULKSMSBD_API_TOKEN;
      const senderId =
        process.env.SMS_SENDER_ID ||
        process.env.BULKSMSBD_SENDER_ID ||
        process.env.CAMPAIGN_SMS_SENDER_ID;
      results.push({
        name: "SMS_API_KEY",
        severity: "critical",
        ok: Boolean(apiKey?.trim()) && !isPlaceholder(apiKey),
        message: apiKey?.trim()
          ? "SMS API key configured"
          : "Set SMS_API_KEY or BULKSMSBD_API_KEY / BULKSMSBD_API_TOKEN",
      });
      results.push({
        name: "SMS_SENDER_ID",
        severity: "critical",
        ok: Boolean(senderId?.trim()) && !isPlaceholder(senderId),
        message: senderId?.trim()
          ? "SMS sender ID configured"
          : "Set SMS_SENDER_ID or BULKSMSBD_SENDER_ID",
      });
    }
  }

  // SMTP — optional unless email worker is used
  if (isTruthy("VALIDATE_SMTP")) {
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
      results.push(requireVar(key, "warning"));
    }
  }

  // Wallet payout encryption in production
  if (prod) {
    results.push(requireVar("WALLET_PAYOUT_DETAILS_KEY", "warning"));
  }

  // Product authenticity secrets in production
  if (prod) {
    for (const key of [
      "AUTH_SERIAL_SIGNING_SECRET",
      "AUTH_CODE_HMAC_SECRET",
      "AUTH_CODE_ENC_SECRET",
    ]) {
      results.push(requireVar(key, "warning"));
    }
  }

  return results;
}

function main(): void {
  console.log("BPA API — environment validation\n");
  console.log(`NODE_ENV=${process.env.NODE_ENV || "development"}`);
  console.log(`PAYMENT_PROVIDER=${getActivePaymentProvider()}`);
  console.log(`STORAGE_PROVIDER=${getStorageProvider()}`);
  console.log(`REDIS_ENABLED=${!isFalsy("REDIS_ENABLED")}`);
  console.log(`SMS_ENABLED=${!isFalsy("SMS_ENABLED")}\n`);

  const results = runChecks();
  const criticalMissing = results.filter((r) => r.severity === "critical" && !r.ok);
  const warnings = results.filter((r) => r.severity === "warning" && !r.ok);

  for (const r of results.filter((x) => !x.ok)) {
    const tag = r.severity === "critical" ? "ERROR" : "WARN";
    console.log(`[${tag}] ${r.message}`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n--- Summary ---`);
  console.log(`Checks passed: ${passed}/${results.length}`);
  console.log(`Critical missing: ${criticalMissing.length}`);
  console.log(`Warnings: ${warnings.length}`);

  if (criticalMissing.length > 0) {
    console.error("\nValidation FAILED — set critical variables before starting the API.");
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn("\nValidation passed with warnings (OK for local dev).");
    process.exit(0);
  }

  console.log("\nValidation PASSED.");
  process.exit(0);
}

main();
