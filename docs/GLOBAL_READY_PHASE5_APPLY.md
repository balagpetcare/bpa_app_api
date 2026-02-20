# Phase 5: Frontend + App – Apply Steps

**Goal:** Country in requests; country picker; policy-based UI (hide/disable Donation or Ads).

*(Reference: [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md) Phase 5.)*

---

## 1. Backend (already in place)

- **GET /api/v1/meta/features?countryCode=XX** – Public; returns `{ data: { countryCode, features: { DONATION, ADS, PRODUCTS } } }` from active policy. Used by web and app to hide/disable donation and ads UI.

---

## 2. bpa_web

### 2.1 X-Country-Code

- **lib/countryContext.ts:** `getCountryCode()` (subdomain → localStorage `bpa_country_code` → default BD), `setCountryCode()`, `getApiHeaders()`.
- **lib/api.ts:** All `apiGet`, `apiPost`, `apiPatch`, `apiPut`, `apiDelete` add headers from `getApiHeaders()` (includes `X-Country-Code`).
- Pages that call API via `lib/api.ts` automatically send country. For raw `fetch`, add `headers: { "X-Country-Code": getCountryCode() }` or use `apiGet`/etc.

### 2.2 Policy-based UI

- **lib/usePolicyFeatures.ts:** Hook `usePolicyFeatures()` → `{ donationEnabled, adsEnabled, productsEnabled }` from `GET /api/v1/meta/features?countryCode=...`.
- Use in layout or pages: hide donation/ads nav or sections when `!donationEnabled` or `!adsEnabled`.

---

## 3. bpa_app

### 3.1 Country select (first launch)

- **LocalStorage:** `setCountryCode()`, `getCountryCode()` (key `bpa_country_code`).
- **CountryPickerScreen:** First-launch screen; list BD, IN, US, AE; on select save and navigate to home or login.
- **SplashScreen:** If `getCountryCode()` is null/empty, navigate to CountryPickerScreen; else proceed to token check.
- **AppRouter:** Route `/country-picker` → CountryPickerScreen.

### 3.2 API header

- **ApiClient:** In `_headers()`, read `bpa_country_code` from SharedPreferences and set `X-Country-Code` on all requests.

### 3.3 Policy-based UI

- **policy_features_provider.dart:** `policyFeaturesProvider` (FutureProvider) fetches `GET /api/v1/meta/features?countryCode=...` using stored country.
- **BPACustomDrawer:** Optional `donationEnabled` (default true); when false, hide Donation, Wallet, Start Fund Raising, Payout Methods.
- **BPAHomeScreen:** Use `Consumer` + `ref.watch(policyFeaturesProvider)` and pass `donationEnabled` to drawer.

---

## 4. Checkpoint

1. **Web:** Call any API from a page that uses `lib/api.ts`; verify request includes `X-Country-Code` (e.g. BD). Change `localStorage.bpa_country_code` and confirm header changes.
2. **App:** Fresh install → country picker → select BD → home/login. Verify API requests include `X-Country-Code: BD`. Drawer shows Donation when policy has DONATION=true; hide when policy has DONATION=false (e.g. test with another country policy).
3. **Features API:** `GET /api/v1/meta/features?countryCode=BD` returns `{ data: { countryCode: "BD", features: { DONATION: true, ... } } }`.
