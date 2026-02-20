# Global-Ready স্ট্যাটাস এনালাইসিস – API ও Next.js অ্যাপ

**তারিখ:** ২০২৫-০১-৩০
**রেফারেন্স:** [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md), [GLOBAL_READY_REMAINING_STEPS.md](./GLOBAL_READY_REMAINING_STEPS.md), [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md)

---

## ১. পরিকল্পনা অনুযায়ী ফেজ সারাংশ

| ফেজ | বিষয় | সময় (পরিকল্পনা) |
|-----|--------|-------------------|
| **Phase 1** | Country + Policy + Context (Foundation) | ৪–৬ সপ্তাহ |
| **Phase 2** | Donation + Compliance (AML/KYC, audit, admin review) | ৪–৬ সপ্তাহ |
| **Phase 3** | Storage + Payment + Location (geocode, map, per-country storage) | ৩–৪ সপ্তাহ |
| **Phase 4** | Ads + Govt Reporting + RBAC (Global/Country roles) | ২–৪ সপ্তাহ |
| **Phase 5** | Frontend + App (X-Country-Code, country picker, policy UI) | ২–৩ সপ্তাহ |
| **Phase 6** | Docs + Launch Prep | চলমান |

---

## ২. বর্তমান অবস্থা – কী করা হয়েছে

### ২.১ Backend API (backend-api) – সম্পন্ন অংশ

| এলাকা | স্ট্যাটাস | বিবরণ |
|--------|----------|--------|
| **Phase 1** | ✅ সম্পন্ন | Country টেবিল, country_policies, policy_features, policy_donation_rules; Policy Engine (`policyEngine.service.ts`) + Redis cache; Country context middleware (`countryContext.ts`); `X-Country-Code` হেডার থেকে দেশ রিজলভ; `app.ts` এ middleware রেজিস্টার। |
| **Phase 2** | ✅ সম্পন্ন | POLICY_DENIED/response helpers (`policyResponses.ts`); requireFeature middleware; Donation policy check, idempotency, audit, status enum (KYC_REQUIRED, ON_HOLD_REVIEW); Admin donation hold list + PATCH status; donation rate limiter। |
| **Phase 3** | ✅ সম্পন্ন | Storage per-country prefix; Geocode/reverse API (Nominatim); Rate limit + cache; Policy payment methods; Migration + seed। |
| **Phase 4** | ✅ সম্পন্ন | Ads মডেল + `GET /api/v1/ads/serve`; Govt reporting service (threshold + webhook); Global/Country roles (user_global_roles, user_country_roles); `GET /api/v1/me/permissions`; Admin user-roles routes (global-roles, country-roles)। |
| **Migrations** | ✅ উপস্থিত | Phase 1–4 মাইগ্রেশন ফোল্ডারে আছে (20260129000000, 20260129100000, 20260129120000, 20260129130000)। |

**API টাচ পয়েন্ট (যেগুলো চেক করা হয়েছে):**

- `src/middlewares/countryContext.ts` – `X-Country-Code` → `req.countryContext`
- `src/api/v1/services/policyEngine.service.ts` – `getActivePolicy(countryCode)`, Redis
- `src/api/v1/modules/meta/meta.controller.ts` – `GET /api/v1/meta/features?countryCode=XX`
- `src/api/v1/middlewares/requireFeature.ts` – policy-based feature gate
- `src/api/v1/modules/fundraising/` – donate with countryContext, idempotency, audit
- `src/api/v1/modules/ads/` – serve by country
- `src/api/v1/services/govtReporting.service.ts` – threshold + webhook
- `src/api/v1/modules/me/me.controller.ts` – `GET /api/v1/me/permissions` (country-scoped)
- `src/api/v1/modules/admin_user_roles/` – global/country role assign/unassign

---

### ২.২ Next.js অ্যাপ (bpa_web) – সম্পন্ন ও অসম্পন্ন

| এলাকা | স্ট্যাটাস | বিবরণ |
|--------|----------|--------|
| **X-Country-Code পাঠানো** | ✅ আংশিক | `lib/api.ts` – `getApiHeaders()` দিয়ে সব `apiGet`/`apiPost`/`apiPatch`/`apiPut`/`apiDelete` এ `X-Country-Code` যুক্ত। **কিন্তু** `src/lib/apiFetch.js` ব্যবহার করা পেজগুলোতে (যেমন `app/shop/products/page.tsx`) কোনো `X-Country-Code` হেডার যাচ্ছে না। |
| **Country রিজলভ** | ✅ করা | `lib/countryContext.ts` – subdomain (bd., in., us., ae.) → localStorage `bpa_country_code` → ডিফল্ট BD। `getCountryCode()`, `setCountryCode()`, `getApiHeaders()`। |
| **Country picker UI** | ❌ নেই | ইউজার দেশ বদলানোর জন্য কোনো পেজ/কম্পোনেন্ট নেই। `setCountryCode()` শুধু lib-এ আছে; কোন লেআউট বা সেটিংসে ব্যবহার হচ্ছে না। |
| **Policy-based UI** | ❌ অ্যাপ্লাই হয়নি | `lib/usePolicyFeatures.ts` হুক আছে (donationEnabled, adsEnabled, productsEnabled) কিন্তু **কোনো লেআউট বা পেজে usePolicyFeatures() ব্যবহার নেই**। তাই Donation/Ads নেভ বা সেকশন policy অনুযায়ী লুকানো/নিষ্ক্রিয় হচ্ছে না। |
| **Admin fundraising** | ⚠️ প্লেসহোল্ডার | `app/admin/fundraising/page.jsx` শুধু placeholder; রিয়েল মডিউল UI ওয়্যার করা নেই। |

**সংক্ষেপ:**
API দিক দিয়ে Backend প্রায় সম্পূর্ণ (Phase 1–4)। Next.js এ Phase 5 এর ইনফ্রা (country context, api headers) আছে, কিন্তু **country picker UI** এবং **policy-based hide/disable (Donation/Ads)** এখনও অ্যাপ্লাই হয়নি; এবং কিছু পেজ `apiFetch.js` ব্যবহার করায় সেখানে country হেডার যাচ্ছে না।

---

## ৩. বাকি কাজ – কী করতে হবে

### ৩.১ Backend (backend-api)

- **কোনো বড় ফেজ বাকি নেই।** Phase 1–4 ইমপ্লিমেন্ট করা আছে।
- অপশনাল (পরবর্তী):
  - AML/risk অটো সেট (donation status ON_HOLD_REVIEW/KYC_REQUIRED) – এখন শুধু অ্যাডমিন ম্যানুয়াল।
  - Geocode এ Photon fallback (Nominatim ফেইল করলে)।

### ৩.২ Next.js (bpa_web) – Phase 5 সম্পূর্ণ করতে

| ক্রম | কাজ | কিভাবে করবেন |
|-----|-----|----------------|
| **৫.১** | সব API কলে X-Country-Code যাওয়া নিশ্চিত করা | `src/lib/apiFetch.js` এ `getApiHeaders()` বা `getCountryCode()` ইমপোর্ট করে প্রতিটি রিকোয়েস্টের হেডারে `X-Country-Code: getCountryCode()` যোগ করুন। অথবা apiFetch কে এমনভাবে বদলান যেন এটি `lib/countryContext` ব্যবহার করে (সার্ভার কম্পোনেন্টে window নেই বলে সার্ভার সাইডে ডিফল্ট BD পাঠাতে হবে)। |
| **৫.২** | Country picker UI | একটি ছোট কম্পোনেন্ট বা পেজ যেখানে ইউজার দেশ সিলেক্ট করতে পারবে (যেমন BD, IN, US, AE)। সিলেক্ট করলে `setCountryCode(code)` কল করুন এবং localStorage আপডেট হবে; পরবর্তী সব API কল থেকে `getCountryCode()` দিয়ে সেই মান যাবে। এটাকে হেডার/লেআউট বা সেটিংস পেজে লিংক দিন। |
| **৫.৩** | Policy-based UI (Donation/Ads লুকানো) | যে লেআউট/পেজে Donation বা Ads নেভ/সেকশন আছে সেখানে `usePolicyFeatures()` ব্যবহার করুন। `donationEnabled === false` হলে Donation লিংক/বাটন হাইড বা ডিজেবল করুন; `adsEnabled === false` হলে Ads সেকশন হাইড করুন। |
| **৫.৪** | Admin fundraising পেজ | `app/admin/fundraising/page.jsx` এ রিয়েল ফান্ডরেইজিং মডিউল UI ওয়্যার করুন (ক্যাম্পেইন লিস্ট, ডোনেশন হোল্ড লিস্ট, স্ট্যাটাস আপডেট ইত্যাদি)। |

### ৩.৩ Flutter অ্যাপ (bpa_app)

- ডকুমেন্ট অনুযায়ী: প্রথম লঞ্চে country picker, `bpa_country_code` পারসিস্ট, সব রিকোয়েস্টে `X-Country-Code`; policy অনুযায়ী Donation/Ads এন্ট্রি হাইড।
- এই অ্যানালাইসিসে শুধু API ও Next.js চেক করা হয়েছে; Flutter কোড বেস আলাদা ভাবে ভেরিফাই করতে হবে।

### ৩.৪ Phase 6 (Docs + Launch)

- GLOBAL_READY_MASTER.md, DEVELOPER_ONBOARDING_GLOBAL.md ইত্যাদি ডক ইতিমধ্যে আছে।
- PROJECT_CONTEXT.md এ Global-Ready সেকশন আপডেট এবং নতুন দেশ রোলআউট চেকলিস্ট রানবুক হিসেবে রাখা।

---

## ৪. পরিকল্পনা অনুযায়ী কতটুকু হয়েছে – সংখ্যা দিয়ে

| ফেজ | পরিকল্পনা | সম্পন্ন (API) | সম্পন্ন (Next.js) | বাকি (Next.js) |
|-----|------------|----------------|---------------------|------------------|
| Phase 1 | Foundation | ✅ 100% | ✅ (context + headers via lib/api) | - |
| Phase 2 | Donation + Compliance | ✅ 100% | - | Admin fundraising UI |
| Phase 3 | Storage + Location | ✅ 100% | (ম্যাপ পিকার ডক অনুযায়ী ওয়েবে থাকার কথা – আলাদা চেক দরকার) | - |
| Phase 4 | Ads + RBAC | ✅ 100% | - | - |
| Phase 5 | Frontend country + policy UI | - | আংশিক (header + getCountryCode) | Country picker UI, policy-based hide, apiFetch এ header |
| Phase 6 | Docs | ✅ ডক ফাইল আছে | - | PROJECT_CONTEXT আপডেট, রানবুক |

**সংক্ষেপ:**

- **API:** পরিকল্পনা অনুযায়ী সারা বিশ্বে উন্মুক্ত করার জন্য **প্রায় সম্পূর্ণ** (Phase 1–4)। Country, policy, donation, ads, govt reporting, RBAC – সব টাচ পয়েন্ট ইমপ্লিমেন্ট করা।
- **Next.js:** পরিকল্পনা অনুযায়ী **প্রায় ৬০–৭০%** – country context ও lib/api দিয়ে X-Country-Code যাচ্ছে, কিন্তু country picker UI নেই, policy-based Donation/Ads লুকানো অ্যাপ্লাই হয়নি, এবং apiFetch ব্যবহারকারী পেজগুলোতে X-Country-Code যুক্ত করা বাকি।

---

## ৫. পরবর্তী স্টেপ (অগ্রাধিকার)

1. **bpa_web:** `src/lib/apiFetch.js` এ X-Country-Code যোগ করা (ক্লায়েন্টে `getCountryCode()`, সার্ভারে ডিফল্ট BD)।
2. **bpa_web:** একটি Country picker কম্পোনেন্ট/পেজ যোগ করা এবং হেডার বা সেটিংসে ব্যবহার করা।
3. **bpa_web:** Donation/Ads যেসব লেআউট বা পেজে আছে সেখানে `usePolicyFeatures()` ব্যবহার করে `donationEnabled`/`adsEnabled` অনুযায়ী লুকানো/নিষ্ক্রিয় করা।
4. **bpa_web:** Admin fundraising পেজে রিয়েল UI ওয়্যার করা।
5. **bpa_app:** ডক ও চেকলিস্ট অনুযায়ী country picker, X-Country-Code ও policy-based UI ভেরিফাই করা।
6. **Docs:** PROJECT_CONTEXT.md এ Global-Ready সেকশন ও নিউ কান্ট্রি রোলআউট চেকলিস্ট আপডেট করা।

এই স্ট্যাটাস অনুযায়ী এগিয়ে গেলে পরিকল্পনা অনুযায়ী সারা বিশ্বে প্রযুক্তি উন্মুক্ত করার দিকটি API ও Next.js উভয়েই পূরণ হবে।
