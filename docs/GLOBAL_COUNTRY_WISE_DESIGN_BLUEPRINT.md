# Global + Country-wise Design Blueprint

**WorldPetsAssociation.com – BPA Standard Practices**

*(Aligned with [BPA_STANDARD.md](../BPA_STANDARD.md), [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). Multi-tenant, RBAC, API=3000, Next.js apps, MinIO, PostgreSQL, Docker, scale-ready.)*

---

## Important note: Domain and trademark

- **worldpetsassociation.com** – Domain creation **2026-01-15**; DNS visible (e.g. dns1.cyberdeveloperbd.com). Hosting/WHOIS may show AlibabaCloud.
- **World Pet Association (WPA)** – An existing organisation at **worldpetassociation.org** uses a similar name.
- **Recommendation:** Before global branding, do a **trademark/branding check** to avoid conflict (e.g. World Pets Association vs World Pet Association). Consider legal review and distinct branding (e.g. BPA Global or WPA Pets Platform) to avoid confusion.

---

## 1. Global to Country to City/Zone: how to structure the platform

সিস্টেম ৩ স্তরে চালাবেন:

### A) Global Layer (WPA Global)

- Global Admin (Super Admin)
- Global policies: AML/KYC rules, content rules, ads policy, data retention, security baseline
- Global marketplace/partners directory (optional)
- Global feature flags: কোন দেশ কোন ফিচার পাবে

### B) Country Layer (WPA Bangladesh, WPA India, WPA UAE…)

প্রতি দেশে আলাদা কনফিগ/রুলস:

- **Currency, VAT/Tax, invoice format**
- **Payment methods** (দেশভেদে gateway)
- **KYC level** (donation/ads/merchant)
- **Legal**: Terms/Privacy, donation policy, age policy
- **Shipping & service rules** (ডেলিভারি, clinic appointment, etc.)
- **Content moderation level + reporting contacts**

### C) Local Layer (City/Zone/Branch)

- City/Zone (Dhaka, Chattogram…)
- Branch (Clinic/Shop/Hub)
- Service coverage area (geo-fence / polygon)

---

## 2. URL / App routing strategy (Country-wise)

ডোমেইন ধরে ২টা স্ট্যান্ডার্ড অপশন:

### Option-1: Subdomain (recommended)

- `bd.worldpetsassociation.com`
- `in.worldpetsassociation.com`
- `ae.worldpetsassociation.com`

**Benefit:** Country isolation, SEO/ops সহজ, আলাদা CDN rules.

### Option-2: Path based

- `worldpetsassociation.com/bd/...`
- `worldpetsassociation.com/in/...`

**Benefit:** DNS সহজ; caching/SEO/policy আলাদা করা তুলনামূলক কঠিন।

### Flutter app

- প্রথমবার ওপেন: **Country select** (auto-detect + manual override)
- Country locked হলে: ওই দেশের configs/terms/currency apply

---

## 3. Core data model extension (BPA Standard অনুযায়ী)

বর্তমান multi-tenant (Organization/Branch/User/Roles) এর সাথে **Geo + Country config** যোগ হবে।

### Must-have entities

| Entity | Purpose |
|--------|---------|
| **Country** | code (BD), name, currency, timezone default, phone rules |
| **CountryConfig** | tax rules, payment settings, KYC thresholds, feature flags |
| **Region/City** | optional hierarchical geo (country to division/state to city) |
| **GeoPoint / GeoFence** | Branch location (lat/lng); coverage polygon (delivery zone) |
| **Locale** | language pack mapping (bn/en/hi/ar…) |

### Key rule: scope

সব টেবিল/রিসোর্সে একটি **scope** থাকবে:

- **Global scope** (rare)
- **Country scope** (most policies/config)
- **Org scope** (business data)
- **Branch scope** (operational data)

---

## 4. Location system (free/low-cost, no Google)

Google Maps লাগবে না – নিচের স্ট্যাক ব্যবহার করা যাবে।

### Map rendering

- **OpenStreetMap tiles + MapLibre GL**
- Web (Next.js admin panels) ও Flutter দুটোতেই usable

### Geocoding (address search)

- **Nominatim** (OpenStreetMap) বা **Photon**
- বড় স্কেলে: **নিজের সার্ভারে host** (rate limit এড়াতে)

### Reverse geocoding (pin drop to address)

- Nominatim reverse

### Cost reduction (BPA Standard)

- **Redis cache:** একই lat/lng বা search query বারবার hit না করে cache
- **Country-wise provider fallback:** একটা provider down হলে আরেকটা
- Heavy traffic হলে: paid geocoding (future switch)

---

## 5. Deployment: Country-wise স্কেলিং (Global launch-ready)

### Phase-1 (শুরু)

- ১টা primary region (যেমন BDIX/SG)
- CDN (e.g. Cloudflare) সামনে
- API (port 3000) + DB + MinIO আলাদা সার্ভার (BPA স্ট্যান্ডার্ড)

### Phase-2 (Multi-Region)

- **Regional API clusters** (SG/EU/US)
- **DB strategy:** শুরুতে single DB + read replicas; পরে **Country sharding** (BD DB, IN DB আলাদা) – data residency সহজ
- **MinIO:** Country-wise buckets (`bd-*`, `in-*`); replication rules (optional)

### Phase-3 (Enterprise)

- Per-country isolated stack (অত্যন্ত সিকিউর/কমপ্লায়েন্স-heavy দেশগুলোর জন্য)

---

## 6. Country-wise legal/compliance (Donation + Ads + Marketplace)

প্ল্যাটফর্মে ৩টা ঝুঁকি বেশি:

1. **Donation / fundraising**
2. **Ads system**
3. **Marketplace payments**

**CountryConfig** এ রাখবেন:

- Allowed/blocked features per country
- Donation rules (who can receive, who can donate cross-border)
- Threshold-based reporting (বড় ট্রানজেকশন হলে compliance workflow)

**Best practice flow:**

- **KYC tiers:** Basic to Verified to Business Verified
- **High amount transactions:** auto-flag to manual review to report export
- **Suspicious patterns:** velocity, repeated small tx, country mismatch detection

---

## 7. Payments: Country-wise gateway + wallet design

- **Per country:** supported gateways list (policy-driven)
- **Multi-currency ledger:** সব ট্রানজেকশন ledger currency তে normalize + display currency
- **Payout rules:** country-specific payout schedule/fees
- **Refund/chargeback flows** per country

---

## 8. Ads system: Country & geo targeting

**Ads campaign targeting:**

- Country to City to radius/zone to interests (pet type, product category)
- Brand safety policy per country
- KYC requirement for advertisers (country-wise)

**Tracking:**

- Privacy rules (EU-type consent mandatory where required)
- Per country retention settings

---

## 9. RBAC (BPA Standard) + Country roles

Existing RBAC এর ওপর **country layer** বসবে।

### Global roles

- SUPER_ADMIN (Global)
- COMPLIANCE_ADMIN (Global)
- PLATFORM_FINANCE (Global)

### Country roles

- COUNTRY_ADMIN
- COUNTRY_COMPLIANCE
- COUNTRY_SUPPORT
- COUNTRY_CONTENT_MOD

### Org/Branch roles (আগেরটাই থাকবে)

- ORG_OWNER, BRANCH_MANAGER, STAFF, VET, SELLER…

### Permissions rule

সবসময়: **(Scope: Global / Country / Org / Branch) + Action**

যাতে UI menu visibility + API middleware একই source of truth থাকে।

---

## 10. Rollout plan (সারা বিশ্বে ওপেন করার বাস্তব ক্রম)

1. **CountryConfig engine** (feature flags + legal + currency + locale)
2. **Location system** (OSM + MapLibre + Nominatim + caching)
3. **Multi-tenant isolation** (country_id mandatory in scopes)
4. **Payments per country** (BD first, তারপর একে একে)
5. **Donation + AML workflow** (tiered KYC + flagging)
6. **Ads platform** (country targeting + billing)
7. **Multi-region deployment** (traffic বাড়লে)

---

## 11. Rollout decision: BD+Global first vs BD+2 countries

**প্রশ্ন:** প্রথমে **BD + Global** দিয়ে শুরু করবেন, নাকি একসাথে **BD + ২টা country** (যেমন BD + IN + UAE) ধরেই ডিজাইন ফাইনাল করব?

**সুপারিশ:**

- **শুরুতে BD + Global:** CountryConfig, Location, RBAC scope, Payment/Donation policy – সব **এক দেশ (BD)** দিয়ে validate করুন; ডিফল্ট country = BD; policy engine ও scope design এমন রাখুন যাতে পরে দেশ যোগ করতে **কোড না ভাঙে**।
- **দ্বিতীয় ধাপে ২য় দেশ:** একটি দেশ (যেমন IN বা UAE) যোগ করে same pipeline (CountryConfig, payment gateway, locale) চালু করুন; এতে data model ও API সঠিক কিনা পরীক্ষা হবে।
- **একসাথে ৩ দেশ দিয়ে ডিজাইন ফাইনাল:** যদি টিম ও টাইমলাইন মেলে, BD + IN + UAE তিনটির জন্য শুধু **config/spec** (currency, gateway, KYC level) ফাইনাল করতে পারেন; ইমপ্লিমেন্টেশন Phase 1 এ BD first রাখুন, তারপর একে একে দেশ।

**সংক্ষেপে:** BD + Global দিয়ে ফাউন্ডেশন ও পলিসি ইঞ্জিন সেট করুন; দেশ সংখ্যা ধাপে ধাপে বাড়ান।

---

## 12. Next spec docs to create (BPA Standard অনুযায়ী)

নিচের ২টা স্পেক ডক **রেডি** করলে ডেভেলপাররা সরাসরি ইমপ্লিমেন্ট শুরু করতে পারবে:

### 12.1 CountryConfig + Feature Flags – পূর্ণ spec doc

**অন্তর্ভুক্ত:**

- কি কি ফিল্ড/রুল থাকবে (Country, CountryConfig, policy_features, policy_donation_rules, policy_payment_methods, policy_ads_rules, policy_data_residency)
- Versioning, effective_from / effective_to
- Cache key ও TTL (e.g. `policy:{country_code}:active`)
- API contract (resolve country, get active policy, feature check)
- Default values (e.g. new country = donation OFF, cross-border OFF)

### 12.2 Location module spec

**অন্তর্ভুক্ত:**

- Address search (Nominatim/Photon), request/response shape, rate limit
- Pin drop + reverse geocode flow
- Caching strategy (Redis key, TTL, invalidation)
- Fallback provider order
- API endpoints ও error codes
- Branch location + coverage polygon (GeoFence) storage ও validation

এই ব্লুপ্রিন্ট + ওপরের ২টা স্পেক দিয়ে **প্রথমে BD + Global** দিয়ে শুরু করে ধাপে ধাপে দেশ যোগ করা যাবে।

---

## Related documentation

| Doc | Topic |
|-----|--------|
| [BPA_STANDARD.md](../BPA_STANDARD.md) | Ports, code change policy, touch-points |
| [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) | Tech stack, API base URL |
| [GLOBAL_READY_PRODUCT_SYSTEM.md](./GLOBAL_READY_PRODUCT_SYSTEM.md) | Global Product Registry, Serialization, Supply chain |
| [LOCATION_MODULE_SPEC.md](./LOCATION_MODULE_SPEC.md) | Custom map (no Google), drag-and-drop picker, Nominatim/Photon, cache, API |
| Plan: Global-Ready Analysis & Start Guideline | Phase 1–2–3, Country Policy Engine, AML/KYC (plan doc section 8) |
