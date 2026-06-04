# EPS payment integration analysis

**Date:** 2026-06-04  
**Error reported:** `getaddrinfo ENOTFOUND sandbox-pgapi.eps.com.bd`

---

## 1. Root cause

The hostname **`sandbox-pgapi.eps.com.bd`** (with a hyphen after `sandbox`) **does not exist in DNS** (NXDOMAIN). Node/axios surfaces that as `ENOTFOUND`.

The correct **sandbox REST API** host is **`sandboxpgapi.eps.com.bd`** (no hyphen), confirmed by:

- DNS resolution to `210.4.69.194`
- `POST https://sandboxpgapi.eps.com.bd/v1/Auth/GetToken` → HTTP 200 + JWT with demo credentials
- Official `flutter_eps` package (`EpsEnvironment.testBox` → `https://sandboxpgapi.eps.com.bd/v1`)

**Production REST API:** `https://pgapi.eps.com.bd` (same IP; demo credentials fail auth — expected).

**Not API hosts:**

| Host | Purpose |
|------|---------|
| `sandboxpg.eps.com.bd` | Customer payment page (redirect UI) |
| `sandbox-pgapi.eps.com.bd` | Invalid typo — **causes ENOTFOUND** |

---

## 2. URL resolution at runtime

Flow: `getEpsConfig()` in `paymentProvider.config.ts` → used by `eps.provider.ts` for all HTTP calls.

| Priority | Source | Sandbox URL | Production URL |
|----------|--------|---------------|----------------|
| 1 | `EPS_BASE_URL` in `.env` (if set, non-placeholder) | env value | env value |
| 2 | Code default when `EPS_SANDBOX !== "false"` | `https://sandboxpgapi.eps.com.bd` | — |
| 3 | Code default when `EPS_SANDBOX=false` | — | `https://pgapi.eps.com.bd` |

**API paths** (appended to base URL):

- `POST /v1/Auth/GetToken`
- `POST /v1/EPSEngine/InitializeEPS`
- `GET /v1/EPSEngine/CheckMerchantTransactionStatus`

---

## 3. File reference map

| File | Role | URL source |
|------|------|------------|
| `src/api/v1/providers/paymentProvider.config.ts` | `EPS_SANDBOX_DEFAULT_BASE`, `EPS_PRODUCTION_DEFAULT_BASE`, `getEpsConfig()` | **Hardcoded defaults** + env |
| `src/api/v1/providers/eps.provider.ts` | GetToken, Initialize, Verify | `getEpsConfig().baseUrl` |
| `src/api/v1/payments/paymentProvider.bootstrap.ts` | Startup logs | reads resolution via `getEpsBaseUrlResolution()` |
| `src/api/v1/payments/strategies/eps.strategy.ts` | Campaign checkout strategy | config helper |
| `.env` | `EPS_BASE_URL`, `EPS_SANDBOX`, credentials | **env** |
| `.env.example` | Template | **env template** |
| `scripts/test-eps-connection.ts` | DNS/HTTPS diagnostics | test targets |
| `scripts/verify-eps-endpoint.js` | GetToken smoke test | test targets |
| `scripts/verify-payment-provider-config.js` | Env key presence check | — |

**Docs mentioning EPS hosts:**

- `docs/vaccination-campaign-2026/eps-payment-provider.md`
- `docs/vaccination-campaign-2026/payment-gateway-architecture.md`
- `docs/campaign-v2/campaign-payment-production-readiness-audit.md`
- `docs/debug/eps-sandbox-endpoint-verification.md`
- `docs/debug/payment-provider-eps-activation-report.md`

**No EPS gateway URLs** in `bpa_web`, `bpa_app`, or `vaccination_2026` — payment calls go through `backend-api`.

**Historical typo:** `sandbox-pgapi.eps.com.bd` appears only in docs (as “do not use”) and `verify-eps-endpoint.js` negative test — **not** in current application defaults.

---

## 4. Current configuration (backend-api `.env`)

| Variable | Expected for sandbox QA |
|----------|-------------------------|
| `PAYMENT_PROVIDER` | `eps` |
| `EPS_BASE_URL` | `https://sandboxpgapi.eps.com.bd` |
| `EPS_SANDBOX` | `true` |
| `EPS_USERNAME` | set (not logged at startup) |
| `EPS_PASSWORD` | set |
| `EPS_HASH` | set |
| `EPS_MERCHANT_ID` | set |
| `EPS_STORE_ID` | set |
| `API_PUBLIC_BASE_URL` | public HTTPS URL for EPS callbacks |

If `ENOTFOUND sandbox-pgapi` still appears after config fix, **restart the API process** (`npm run dev`) so env and TypeScript changes reload. A long-running process may still hold the old `EPS_BASE_URL`.

---

## 5. Connectivity verification

```bash
cd backend-api
npx ts-node scripts/test-eps-connection.ts
node scripts/verify-eps-endpoint.js
```

Startup should log:

```text
[Payment] EPS gateway: baseUrl=https://sandboxpgapi.eps.com.bd | sandbox=enabled | source=EPS_BASE_URL
[Payment] Active provider: eps
```

---

## 6. Recommended `.env` (sandbox — do not commit secrets)

```env
PAYMENT_PROVIDER=eps
API_PUBLIC_BASE_URL=https://<your-public-api-host>

EPS_BASE_URL=https://sandboxpgapi.eps.com.bd
EPS_SANDBOX=true
EPS_USERNAME=<from EPS sandbox panel>
EPS_PASSWORD=<from EPS sandbox panel>
EPS_HASH=<base64 hash key>
EPS_MERCHANT_ID=<uuid>
EPS_STORE_ID=<uuid>
```

**Production:**

```env
EPS_BASE_URL=https://pgapi.eps.com.bd
EPS_SANDBOX=false
# live EPS_* credentials
```

---

## 7. Summary

| Item | Value |
|------|--------|
| **Broken URL (ENOTFOUND)** | `https://sandbox-pgapi.eps.com.bd` |
| **Working sandbox API** | `https://sandboxpgapi.eps.com.bd` |
| **Working production API** | `https://pgapi.eps.com.bd` |
| **Missing if checkout fails** | Valid `EPS_BASE_URL`, restart API, `API_PUBLIC_BASE_URL` for redirects |
| **Code status** | Defaults and `.env.example` updated; startup warns if hyphenated host detected |
