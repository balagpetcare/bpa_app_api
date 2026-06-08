/**
 * EPS Initialize diagnostic.
 *
 * Performs Auth/GetToken then EPSEngine/InitializeEPS and prints, for each call:
 *   URL, HTTP method, status, response body.
 *
 * It probes multiple base hosts and multiple candidate initialize paths so we can
 * empirically determine the correct production endpoint (no guessing).
 *
 * Usage:
 *   node scripts/diagnose-eps-init.js
 *   node scripts/diagnose-eps-init.js --base=https://pgapi.eps.com.bd
 *   node scripts/diagnose-eps-init.js --amount=10
 *
 * Credentials precedence: CLI env (EPS_*) > backend-api/.env > built-in EPS demo creds.
 */
const https = require("https");
const crypto = require("crypto");
const { readFileSync, existsSync } = require("fs");
const { resolve } = require("path");

function loadEnv() {
  const envPath = resolve(__dirname, "../.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** EPS public demo (sandbox) merchant — same values published in EPS SDK examples. */
const DEMO = {
  merchantId: "29e86e70-0ac6-45eb-ba04-9fcb0aaed12a",
  storeId: "d44e705f-9e3a-41de-98b1-1674631637da",
  username: "Epsdemo@gmail.com",
  password: "Epsdemo258@",
  hashKey: "FHZxyzeps56789gfhg678ygu876o=",
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

function generateEpsHash(value, hashKey) {
  return crypto
    .createHmac("sha512", Buffer.from(hashKey, "utf8"))
    .update(value, "utf8")
    .digest("base64");
}

function request(method, url, body, headers) {
  return new Promise((resolvePromise) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return resolvePromise({ status: null, error: `bad url: ${e.message}` });
    }
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers: {
          ...(data
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
              }
            : {}),
          ...headers,
        },
        timeout: 25_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw || "null");
          } catch {
            parsed = { raw: raw.slice(0, 600) };
          }
          resolvePromise({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on("error", (e) => resolvePromise({ status: null, error: `${e.code || ""} ${e.message}`.trim() }));
    req.on("timeout", () => {
      req.destroy();
      resolvePromise({ status: null, error: "ETIMEDOUT" });
    });
    if (data) req.write(data);
    req.end();
  });
}

function buildInitBody(cfg, merchantTxnId, amount) {
  return {
    merchantId: cfg.merchantId,
    storeId: cfg.storeId,
    CustomerOrderId: `DIAG-${merchantTxnId}`,
    merchantTransactionId: merchantTxnId,
    transactionTypeId: 1,
    financialEntityId: 0,
    transitionStatusId: 0,
    totalAmount: Number(amount),
    ipAddress: "0.0.0.0",
    version: "1",
    successUrl: "https://example.com/success",
    failUrl: "https://example.com/fail",
    cancelUrl: "https://example.com/cancel",
    customerName: "Diag User",
    customerEmail: "diag@example.com",
    CustomerAddress: "Dhaka",
    CustomerAddress2: "",
    CustomerCity: "Dhaka",
    CustomerState: "Dhaka",
    CustomerPostcode: "1200",
    CustomerCountry: "BD",
    CustomerPhone: "01700000000",
    ShipmentName: "",
    ShipmentAddress: "",
    ShipmentAddress2: "",
    ShipmentCity: "",
    ShipmentState: "",
    ShipmentPostcode: "",
    ShipmentCountry: "",
    ValueA: "",
    ValueB: "",
    ValueC: "",
    ValueD: "",
    ShippingMethod: "NO",
    NoOfItem: "1",
    ProductName: "Diagnostic Payment",
    ProductProfile: "general",
    ProductCategory: "general",
    ProductList: [],
  };
}

function trimBase(url) {
  return url.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function freshMerchantTxnId() {
  const now = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(
    now.getHours()
  )}${p(now.getMinutes())}${p(now.getSeconds())}${p(now.getMilliseconds(), 3)}`;
}

async function probeBase(base, cfg, amount, initPaths) {
  const apiRoot = `${trimBase(base)}/v1`;
  console.log(`\n================ BASE: ${base} ================`);
  console.log(`apiRoot: ${apiRoot}`);

  // 1) GetToken
  const tokenUrl = `${apiRoot}/Auth/GetToken`;
  const tokenHash = generateEpsHash(cfg.username, cfg.hashKey);
  console.log(`\n[GetToken] POST ${tokenUrl}`);
  const tokenRes = await request(
    "POST",
    tokenUrl,
    { userName: cfg.username, password: cfg.password },
    { "x-hash": tokenHash }
  );
  console.log(`  status: ${tokenRes.status ?? "ERR"}${tokenRes.error ? ` (${tokenRes.error})` : ""}`);
  console.log(`  body:   ${JSON.stringify(tokenRes.data)}`);

  const token = tokenRes.data && tokenRes.data.token;
  if (!token) {
    console.log("  -> No token; cannot test InitializeEPS for this base.");
    return;
  }

  // 2) InitializeEPS across candidate paths + merchantTransactionId formats.
  //    A/B compares EPS-safe numeric ids vs BPA order-number style (CKO-*).
  const numericId = freshMerchantTxnId();
  const ckoId = `CKO-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const mtidCases = [
    { label: "numeric (17 digits)", mtid: numericId },
    { label: "CKO-* order number", mtid: ckoId },
    { label: "numeric reused (same as first)", mtid: numericId },
  ];

  for (const path of initPaths) {
    for (const c of mtidCases) {
      const initUrl = `${apiRoot}${path}`;
      const initHash = generateEpsHash(c.mtid, cfg.hashKey);
      const body = buildInitBody(cfg, c.mtid, amount);
      console.log(`\n[InitializeEPS] POST ${initUrl}`);
      console.log(`  case: ${c.label}`);
      console.log(`  merchantTransactionId: ${c.mtid} (len=${c.mtid.length})  totalAmount: ${amount}`);
      const res = await request("POST", initUrl, body, {
        "x-hash": initHash,
        Authorization: `Bearer ${token}`,
      });
      console.log(`  status: ${res.status ?? "ERR"}${res.error ? ` (${res.error})` : ""}`);
      console.log(`  body:   ${JSON.stringify(res.data)}`);
    }
  }
}

async function main() {
  loadEnv();

  const cfg = {
    merchantId: process.env.EPS_MERCHANT_ID || process.env.EPS_MERCHANTID || DEMO.merchantId,
    storeId: process.env.EPS_STORE_ID || DEMO.storeId,
    username: process.env.EPS_USERNAME || DEMO.username,
    password: process.env.EPS_PASSWORD || DEMO.password,
    hashKey: process.env.EPS_HASH_KEY || process.env.EPS_HASH || DEMO.hashKey,
  };

  const amount = arg("amount", "10");
  const usingDemo = cfg.username === DEMO.username;

  console.log("EPS Initialize diagnostic");
  console.log(`credentials: ${usingDemo ? "EPS demo (sandbox)" : "from env/.env"}`);
  console.log(`merchantId: ${cfg.merchantId}`);
  console.log(`storeId:    ${cfg.storeId}`);
  console.log(`username:   ${cfg.username}`);

  const initPaths = [
    "/EPSEngine/InitializeEPS", // current implementation + official SDK path
  ];

  const customBase = arg("base", null);
  const bases = customBase
    ? [customBase]
    : [
        "https://sandboxpgapi.eps.com.bd",
        "https://sandbox-pgapi.eps.com.bd",
        "https://pgapi.eps.com.bd",
      ];

  for (const base of bases) {
    await probeBase(base, cfg, amount, initPaths);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
