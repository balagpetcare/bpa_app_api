# Country Policy Engine – Design

**Purpose:** Tables, runtime behavior, cache keys, and decision output for the Global-Ready policy engine.

*(Reference: [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md), [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md).)*

---

## 1. Tables

| Table | Purpose |
|-------|---------|
| `countries` | id, code (ISO 3166-1 alpha-2), name, currencyCode, timezoneDefault, isActive |
| `country_policies` | id, countryId, name, status (DRAFT \| ACTIVE \| ARCHIVED), effectiveFrom, effectiveTo |
| `policy_features` | countryPolicyId, featureCode (DONATION, PRODUCTS, ADS), enabled |
| `policy_donation_rules` | countryPolicyId, ruleType (INBOUND, OUTBOUND), maxAmountSingle, maxAmountDaily, enabled |
| `policy_payment_methods` | countryPolicyId, providerCode, enabled, configJson, sortOrder |
| `policy_ads_rules` | countryPolicyId, ruleType, valueJson, enabled |

---

## 2. Runtime

1. **Resolve country:** `X-Country-Code` header → (future: user profile / org) → env `COUNTRY_DEFAULT` (default BD).
2. **Get active policy:** `getActivePolicy(prisma, countryCode)`:
   - Query: `country_policies` where `status = 'ACTIVE'`, `country.code = countryCode`, `country.isActive = true`, order by `effectiveFrom desc`, limit 1.
   - Include: country, features, donationRules, paymentMethods (and optionally adsRules).
3. **Cache:** Redis key `policy:{countryCode}:active`, TTL = `POLICY_CACHE_TTL_SEC` (default 300). On policy update, invalidate with `invalidatePolicyCache(countryCode)`.
4. **Attach to request:** Middleware sets `req.countryContext = { countryCode, countryId, policy }`.

---

## 3. Decision Output

- **Feature check:** `policy.features` array; find `featureCode === 'DONATION'` (or ADS, PRODUCTS); allow only if `enabled === true`.
- **Donation limits:** Use `policy.donationRules` where `ruleType === 'INBOUND'` for single/daily limits; reject with 403 and reason_code `LIMIT_EXCEEDED` when exceeded.
- **Payment methods:** `policy.paymentMethods` (enabled only) for UI and gateway selection.
- **Public API for UI:** `GET /api/v1/meta/features?countryCode=XX` returns `{ countryCode, features: { DONATION: bool, ADS: bool, PRODUCTS: bool } }` so frontend can hide/disable donation and ads.

---

## 4. Defaults

- New country: no policy or policy with all features OFF until explicitly seeded.
- Missing cache: fallback to DB; cache repopulated on next request.
- Missing header: use `COUNTRY_DEFAULT` (BD).
