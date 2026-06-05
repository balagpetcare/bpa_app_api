# Global-Ready Full Planning - সারা বিশ্বে উন্মুক্ত করার আপডেট প্ল্যান

**BPA / WorldPetsAssociation - সম্পূর্ণ স্ক্যান ও পরবর্তী স্টেপ প্ল্যান**

*(Aligned with [BPA_STANDARD.md](../BPA_STANDARD.md), [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). Reference: [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](./GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md), [GLOBAL_READY_PRODUCT_SYSTEM.md](./GLOBAL_READY_PRODUCT_SYSTEM.md), Plan doc section 8.)*

---

## Part 1: সিস্টেম স্ক্যান সারাংশ (Current State)

### 1.1 Backend API (backend-api)

| Area | Status | Detail |
|------|--------|--------|
| Port / Stack | OK | API 3000, Node/Express/Prisma/PostgreSQL/MinIO |
| Auth / RBAC | OK | JWT, req.user, Admin allowlist, Staff membership |
| Country | Missing | No Country table; only Company.country (String), MasterProductCatalog.countryOfOrigin (String) |
| Country context | Missing | No middleware; no req.countryContext |
| Policy Engine | Missing | No country_policies, policy_features, policy_donation_rules, etc. |
| Locations | BD-only | BdDivision, BdDistrict, BdUpazila, BdArea (Bangladesh hierarchy) |
| Donation | Simple | Donation: campaignId, donorId, amount, status; no country, no policy_version, no AML/KYC flow |
| Audit | Partial | AuditLog: ORGANIZATION, BRANCH, OWNER_KYC only; no DONATION/TRANSACTION |
| Storage | Single bucket | bpa-pets; no country-wise bucket or prefix |
| Rate limit | Partial | Auth, withdraw, webhook; no donation-specific limiter |
| Idempotency | Partial | Withdraw has Idempotency-Key; donate does not |
| Middleware order | - | No countryContext or policyFeature middleware in app.ts |

### 1.2 Web (bpa_web)

| Area | Status | Detail |
|------|--------|--------|
| Ports | OK | 3000 API; bpa_web 3100–3107; bpa-landing 3101; vaccination_2026 3110 — see [infrastructure/PORT_AND_DOMAIN_MAP.md](./infrastructure/PORT_AND_DOMAIN_MAP.md) |
| Country / subdomain | Missing | No X-Country-Code or subdomain-based routing |
| Locale / i18n | Partial | LanguageLayer, CurrenciesLayer, CompanyLayer (limited) |

### 1.3 Flutter App (bpa_app)

| Area | Status | Detail |
|------|--------|--------|
| Locale | OK | l10n (bn, en), locale_controller, settings |
| Country select | Missing | No first-open country picker or country-locked config |

### 1.4 Existing docs (reference)

- GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md (3-layer, URL strategy, RBAC, rollout)
- GLOBAL_READY_PRODUCT_SYSTEM.md (GPR, Serialization, Supply chain)
- LOCATION_MODULE_SPEC.md (custom map, drag-drop picker, Nominatim/Photon)
- Plan doc: Global-Ready Analysis + Start Guideline (Phase 1-2-3, section 8)

---

## Part 2: আপডেট লিস্ট (যা করা লাগবে)

### Group A: Foundation (Country + Policy + Context)

| # | Update | Scope | Touch points |
|---|--------|--------|--------------|
| A1 | Country table + seed | DB | prisma/schema.prisma, migration, seed (BD + 2-3 sample) |
| A2 | Country Policy tables | DB | country_policies, policy_features, policy_donation_rules, policy_payment_methods, policy_ads_rules, policy_data_residency |
| A3 | BD active policy seed | DB | One ACTIVE policy for BD with features + donation rules |
| A4 | Policy Engine service | API | New service: getActivePolicy(countryCode), Redis cache key policy:{code}:active, TTL |
| A5 | Country context middleware | API | Resolve country: header / subdomain / user profile / org / default (COUNTRY_DEFAULT=BD); set req.countryContext |
| A6 | Register middleware | API | app.ts: countryContext after auth (or before routes as needed) |

### Group B: Donation + Compliance

| # | Update | Scope | Touch points |
|---|--------|--------|--------------|
| B1 | API response standard | API | 403 POLICY_DENIED + reason_code; 202 PENDING_REVIEW; helper or middleware |
| B2 | Feature gate middleware | API | requireFeature('DONATION') from policy; 403 if disabled |
| B3 | Donation policy check | API | Before donate: countryContext, donation_enabled, rules (inbound/outbound, limits) |
| B4 | Donation status enum | DB | Add KYC_REQUIRED, ON_HOLD_REVIEW, etc.; migration |
| B5 | AML / risk service | API | Threshold, frequency, pattern; set donation status (KYC/hold) |
| B6 | Audit + policy_version | API | AuditLog entity DONATION/TRANSACTION; store policy_version on each money event |
| B7 | Admin review queue | API | List hold/KYC pending; Approve/Reject/Request info; audit timeline |
| B8 | Donation rate limit | API | donationLimiter in rateLimiters.ts; apply to POST .../donate |
| B9 | Donate idempotency | API | Idempotency-Key header on donate; return same response on replay |

### Group C: Storage + Payment + Ads

| # | Update | Scope | Touch points |
|---|--------|--------|--------------|
| C1 | Storage per country | API | MinIO bucket prefix or per-country bucket; media.service + appConfig |
| C2 | Payment plugin | API | Policy-driven gateway list; provider interface (per country) |
| C3 | Ads module (basic) | DB + API | Ad model (country, target_countries); minimal serve API |
| C4 | Govt reporting hook | API | Threshold exceeded -> notify/report (structure only) |

### Group D: Location + Map (no Google)

| # | Update | Scope | Touch points |
|---|--------|--------|--------------|
| D1 | Geocode API | API | GET /locations/geocode, GET /locations/reverse (Nominatim/Photon); rate limit, cache |
| D2 | Map + picker (web) | bpa_web | Leaflet or MapLibre; center pin or draggable marker; Confirm -> lat/lng |
| D3 | Map + picker (Flutter) | bpa_app | Same stack; location picker screen |
| D4 | Branch lat/lng + GeoFence | DB | Branch address_json, coverage_polygon (GeoJSON); validation |

### Group E: Frontend + App

| # | Update | Scope | Touch points |
|---|--------|--------|--------------|
| E1 | Country header / subdomain | bpa_web | Send X-Country-Code or use subdomain (bd., in.); API calls include country |
| E2 | Country select (Flutter) | bpa_app | First launch: country picker (auto-detect + manual); persist; apply configs/terms |
| E3 | Policy-based UI | bpa_web + bpa_app | Hide/disable Donation or Ads if policy says off; show reason_code |

### Group F: RBAC + Roles

| # | Update | Scope | Touch points |
|---|--------|--------|--------------|
| F1 | Global roles | DB + API | SUPER_ADMIN, COMPLIANCE_ADMIN, PLATFORM_FINANCE (scope Global) |
| F2 | Country roles | DB + API | COUNTRY_ADMIN, COUNTRY_COMPLIANCE, COUNTRY_SUPPORT, COUNTRY_CONTENT_MOD |
| F3 | Permission model | API | (Scope: Global/Country/Org/Branch) + Action; menu + API same source |

### Group G: Docs + Ops

| # | Update | Scope | Touch points |
|---|--------|--------|--------------|
| G1 | Master doc in repo | docs | GLOBAL_READY_MASTER.md (purpose, philosophy, rules, checklist) |
| G2 | Developer handbook | docs | DEVELOPER_ONBOARDING_GLOBAL.md (rules, env, DoD, error standard) |
| G3 | Country Policy design doc | docs | COUNTRY_POLICY_ENGINE_DESIGN.md (tables, runtime, decision output) |
| G4 | AML/KYC flow doc | docs | AML_KYC_FLOW.md (mermaid, status machine, admin review) |
| G5 | MVP launch checklist | docs | MVP_GLOBAL_LAUNCH_CHECKLIST.md |
| G6 | PROJECT_CONTEXT update | root | Add short Global-Ready (Country-First) section with links |

---

## Part 3: ফেজড রোডম্যাপ (পরবর্তী স্টেপ অর্ডার)

### Phase 1: Foundation (4-6 weeks)

**Goal:** Country + Policy DB + Policy Engine + Country context; no feature break.

| Step | Task | Depends on |
|------|------|------------|
| 1.1 | Country model + migration + seed (BD + IN, US or UAE) | - |
| 1.2 | Country Policy tables + migration | 1.1 |
| 1.3 | BD active policy seed (features + donation rules) | 1.2 |
| 1.4 | Policy Engine service + Redis cache | 1.2 |
| 1.5 | Country context middleware | 1.4 |
| 1.6 | Register middleware in app.ts (optional for now: default BD) | 1.5 |
| 1.7 | Checkpoint: call API with X-Country-Code: BD, verify req.countryContext | - |

**Touch points:** prisma/schema.prisma, migrations, seed, new service file, new middleware file, app.ts.

### Phase 2: Donation + Compliance (4-6 weeks)

**Goal:** Donation flow policy-aware; AML/KYC/hold; audit; admin review.

| Step | Task | Depends on |
|------|------|------------|
| 2.1 | API response standard (403 POLICY_DENIED, 202 PENDING_REVIEW) | - |
| 2.2 | Feature gate middleware (policy_features) | Phase 1 |
| 2.3 | Donation policy check in donate endpoint | 2.2 |
| 2.4 | Donation status enum extension + AML/risk logic | Phase 1 |
| 2.5 | AuditLog entity DONATION/TRANSACTION + policy_version | Phase 1 |
| 2.6 | Admin review endpoints (hold list, KYC list, approve/reject) | 2.4 |
| 2.7 | Donation rate limit + Idempotency-Key on donate | - |
| 2.8 | Checkpoint: policy OFF -> 403; limit exceeded -> reason_code | - |

**Touch points:** schema (Donation, AuditEntityType), fundraising.controller/service, new policy/AML service, admin routes, rateLimiters.

### Phase 3: Storage + Payment + Location (3-4 weeks)

**Goal:** Per-country storage; payment plugin; geocode + map picker.

| Step | Task | Depends on |
|------|------|------------|
| 3.1 | MinIO bucket per country (or prefix) | Phase 1 |
| 3.2 | Payment gateway plugin (policy_payment_methods) | Phase 1 |
| 3.3 | Geocode + reverse API (Nominatim/Photon, cache) | - |
| 3.4 | Web: map + location picker (Leaflet/MapLibre) | 3.3 |
| 3.5 | Flutter: map + location picker | 3.3 |
| 3.6 | Branch lat/lng + coverage_polygon | schema |

**Touch points:** appConfig, media.service, payout providers, new locations/geocode routes, bpa_web components, bpa_app screens.

### Phase 4: Ads + Govt Reporting + RBAC (2-4 weeks)

**Goal:** Basic ads model; reporting hook; Global/Country roles.

| Step | Task | Depends on |
|------|------|------------|
| 4.1 | Ads model + basic serve API (country targeting) | Phase 1 |
| 4.2 | Govt reporting hook (threshold -> notify) | Phase 2 |
| 4.3 | Global + Country roles (DB + API) | Phase 1 |
| 4.4 | Permission (Scope + Action) in API + UI | 4.3 |

### Phase 5: Frontend + App (2-3 weeks)

**Goal:** Country in requests; country picker; policy-based UI.

| Step | Task | Depends on |
|------|------|------------|
| 5.1 | bpa_web: X-Country-Code or subdomain; pass to API | Phase 1 |
| 5.2 | bpa_app: country select (first launch); persist; apply configs | Phase 1 |
| 5.3 | Hide/disable Donation or Ads per policy | Phase 2 |

### Phase 6: Docs + Launch Prep (ongoing)

| Step | Task |
|------|------|
| 6.1 | Add GLOBAL_READY_MASTER.md, DEVELOPER_ONBOARDING_GLOBAL.md |
| 6.2 | Add COUNTRY_POLICY_ENGINE_DESIGN.md, AML_KYC_FLOW.md, MVP_GLOBAL_LAUNCH_CHECKLIST.md |
| 6.3 | Update PROJECT_CONTEXT.md (Global-Ready section) |
| 6.4 | New country rollout checklist (add country, create policy, enable features, monitor) |

---

## Part 4: ডিপেন্ডেন্সি ডায়াগ্রাম (সংক্ষেপ)

```
Phase 1 (Country + Policy + Context)
    |
    v
Phase 2 (Donation Policy + AML + Audit + Review)
    |
    +---> Phase 3 (Storage + Payment + Location)
    |
    +---> Phase 4 (Ads + Reporting + RBAC roles)
    |
    v
Phase 5 (Frontend country + policy UI)
    |
Phase 6 (Docs) -- ongoing
```

---

## Part 5: নেক্সট স্টেপ চেকলিস্ট (অভিগমনযোগ্য)

**এখনই করা যাবে (প্রথম স্প্রিন্ট):**

- [ ] Country table in schema + migration
- [ ] Seed: BD + 2 countries (e.g. IN, US)
- [ ] CountryPolicy + PolicyFeature tables (minimal) + migration
- [ ] BD active policy seed (DONATION=true, PRODUCTS=true; donation rules)
- [ ] Policy Engine service (getActivePolicy, Redis cache)
- [ ] Country context middleware (header -> user -> org -> default BD)
- [ ] Register middleware in app.ts; default BD when no country
- [ ] Checkpoint: test X-Country-Code header, verify req.countryContext

**দ্বিতীয় স্প্রিন্ট (Phase 2 শুরু):**

- [ ] 403 POLICY_DENIED + reason_code helper
- [ ] Feature gate middleware requireFeature('DONATION')
- [ ] Donation endpoint: policy check before create
- [ ] Donation status enum extension (KYC_REQUIRED, ON_HOLD_REVIEW)
- [ ] AuditLog entity type DONATION/TRANSACTION; policy_version on tx

**পরবর্তী (Phase 3-6):** Part 3 টেবিল অনুযায়ী ধাপে ধাপে।

---

## Part 6: রিস্ক ও সতর্কতা

- **Backward compatibility:** সব পরিবর্তন additive; existing API without country = assume BD.
- **BPA Standard:** Ports unchanged; merge only, no overwrite; touch points confirm before code.
- **Data:** New country = new policy seed; default donation OFF for new countries.
- **Rollback:** Policy OFF per country without code deploy; DB migration rollback only if needed.

---

## Related docs

| Doc | Topic |
|-----|--------|
| [BPA_STANDARD.md](../BPA_STANDARD.md) | Ports, code change policy |
| [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) | Tech stack, API base |
| [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](./GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md) | 3-layer, URL, RBAC, rollout |
| [GLOBAL_READY_PRODUCT_SYSTEM.md](./GLOBAL_READY_PRODUCT_SYSTEM.md) | GPR, Serialization, Supply chain |
| [LOCATION_MODULE_SPEC.md](./LOCATION_MODULE_SPEC.md) | Map, picker, geocode |
| [PRODUCT_AUTHENTICITY_SERIAL_ISSUANCE_BLUEPRINT.md](./PRODUCT_AUTHENTICITY_SERIAL_ISSUANCE_BLUEPRINT.md) | Authenticity, serial/QR security, KYB, fingerprint, threat model |
| Plan: Global-Ready Analysis (section 8) | Phase 1-2-3 start guideline |

এই প্ল্যান অনুসরণ করলে পরবর্তী স্টেপগুলো ক্রমে সম্পন্ন করে সিস্টেমকে সারা বিশ্বের জন্য উন্মুক্ত করার দিকে এগিয়ে যেতে পারবেন।
