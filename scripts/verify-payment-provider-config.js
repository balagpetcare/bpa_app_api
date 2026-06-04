/**
 * Report active payment provider and EPS readiness (no secrets printed).
 * Usage: npx ts-node -r ts-node/register scripts/verify-payment-provider-config.js
 */
require("dotenv").config();

const cfg = require("../src/api/v1/providers/paymentProvider.config");

const provider = cfg.getActivePaymentProvider();
const validation = cfg.validateActivePaymentProviderConfig();
const issues = cfg.getProviderConfigIssues(provider);

const keys = [
  "PAYMENT_PROVIDER",
  "API_PUBLIC_BASE_URL",
  "EPS_BASE_URL",
  "EPS_USERNAME",
  "EPS_PASSWORD",
  "EPS_HASH",
  "EPS_MERCHANT_ID",
  "EPS_STORE_ID",
  "EPS_SANDBOX",
];

console.log("=== BPA Payment Provider Verification ===\n");
console.log("Active provider detected:", provider);
console.log("Provider ready:", cfg.isProviderConfigured(provider));
console.log("Startup validation ok:", validation.ok);
if (!validation.ok) {
  console.log("\nValidation errors:");
  validation.errors.forEach((e) => console.log(" -", e));
}
console.log("\nEnv key status (values not shown):");
for (const key of keys) {
  const raw = process.env[key];
  let status = "missing";
  if (raw?.trim()) {
    status = cfg.isPlaceholderEnvValue(raw) ? "PLACEHOLDER" : "set";
  }
  console.log(` - ${key}: ${status}`);
}
if (provider === "eps") {
  console.log("\nEPS config issues:");
  if (issues.length === 0) console.log(" - none");
  else issues.forEach((i) => console.log(" -", i));
}
console.log(
  "\nCheckout path: Campaign Booking → Checkout Session → Order → createUnifiedPayment →",
  provider,
  "strategy.createPayment"
);
console.log(
  "SSLCommerz used at checkout:",
  provider === "sslcommerz" ? "YES" : "NO (EPS/unified provider only)"
);
