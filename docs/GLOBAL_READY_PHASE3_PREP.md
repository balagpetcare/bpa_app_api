# Global-Ready Phase 3 – প্রস্তুতি (Storage + Payment + Location)

**Reference:** [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md) Part 3 Phase 3, [LOCATION_MODULE_SPEC.md](./LOCATION_MODULE_SPEC.md).

Phase 2 সম্পূর্ণ। Phase 3 শুরু করার আগে নিচের টাচ পয়েন্ট ও ডিপেন্ডেন্সি মেনে এগোবেন।

---

## Phase 3 Goal

Per-country storage; payment plugin (policy-driven); geocode + reverse API (Nominatim/Photon, cache); web + Flutter map/location picker; Branch lat/lng + coverage_polygon.

---

## Step 3.1: MinIO bucket per country (or prefix)

| কী করবেন | টাচ পয়েন্ট |
|----------|--------------|
| Bucket নাম বা prefix দেশভিত্তি | `src/config/appConfig.ts` – `storage.bucketName` বা নতুন `storage.bucketPrefix` / per-country bucket list |
| আপলোড/রিড পাথ দেশ অনুযায়ী | `src/api/v1/modules/media/media.service.ts` – `buildKey()`, `uploadToStorage()`, `buildPublicUrl()`; `req.countryContext.countryCode` ব্যবহার করে prefix (e.g. `BD/...`) বা আলাদা bucket |
| বাকেট তৈরি/নিশ্চিতকরণ | স্ক্রিপ্ট বা startup: দেশ কোড অনুযায়ী bucket থাকলে ব্যবহার, না থাকলে create (MinIO API বা env তালিকা) |

**ডিপেন্ডেন্সি:** Phase 1 (req.countryContext)।

---

## Step 3.2: Payment gateway plugin (policy_payment_methods)

| কী করবেন | টাচ পয়েন্ট |
|----------|--------------|
| Policy টেবিল (যদি না থাকে) | `prisma/schema.prisma` – `PolicyPaymentMethod` (countryPolicyId, providerCode, enabled, configJson); migration |
| Policy থেকে gateway তালিকা | Policy Engine বা নতুন service – দেশভিত্তি সক্রিয় payment methods ফেরত দেওয়া |
| Provider interface | একটিমাত্র interface (e.g. `createIntent`, `capture`, `refund`) – দেশভিত্তি কনফিগ (API key ইত্যাদি) policy/config থেকে |

**ডিপেন্ডেন্সি:** Phase 1 (CountryPolicy)।

---

## Step 3.3: Geocode + reverse API (Nominatim/Photon, cache)

| কী করবেন | টাচ পয়েন্ট |
|----------|--------------|
| পাবলিক API শেপ | `src/api/v1/modules/locations/` – **GET** `/locations/geocode?q=...`, **GET** `/locations/reverse?lat=...&lng=...` (বর্তমান POST থাকলে একই লজিক GET এ বা আলাদা রাউটে; [LOCATION_MODULE_SPEC.md](./LOCATION_MODULE_SPEC.md) অনুযায়ী) |
| Rate limit | Geocode/reverse রাউটে per-IP বা per-user limiter (উদাহরণ: 1 req/sec public Nominatim) |
| Redis cache | Reverse key যেমন `geocode:reverse:{lat_bucket}:{lng_bucket}`, TTL 24h–7d; forward search optional cache |
| Fallback | Nominatim → Photon; ব্যর্থ হলে lat/lng ফেরত, formatted_address null |

**ডিপেন্ডেন্সি:** নেই।
**রেফারেন্স:** [LOCATION_MODULE_SPEC.md](./LOCATION_MODULE_SPEC.md) § 8 (API, cache, fallback)।

---

## Step 3.4: Web – map + location picker (Leaflet/MapLibre)

| কী করবেন | টাচ পয়েন্ট |
|----------|--------------|
| ম্যাপ কম্পোনেন্ট | **bpa_web** – Leaflet বা MapLibre; center pin বা draggable marker |
| Confirm → lat/lng | পিকার থেকে lat/lng API/state এ পাঠানো; reverse geocode শুধু Confirm এ (optional, Step 3.3 থেকে API কল) |

**ডিপেন্ডেন্সি:** 3.3 (GET geocode/reverse optional কিন্তু সুবিধাজনক)।

---

## Step 3.5: Flutter – map + location picker

| কী করবেন | টাচ পয়েন্ট |
|----------|--------------|
| ম্যাপ স্ক্রিন/উইজেট | **bpa_app** – একই কনসেপ্ট (center pin বা draggable marker); Confirm → lat/lng |
| Backend API | Step 3.3 এর GET geocode/reverse কল করা |

**ডিপেন্ডেন্সি:** 3.3।

---

## Step 3.6: Branch lat/lng + coverage_polygon (schema)

| কী করবেন | টাচ পয়েন্ট |
|----------|--------------|
| Branch-এ স্থান বা প্রোফাইল | `BranchProfileDetails` এ ইতিমধ্যে `latitude`, `longitude`, `addressJson`। প্রয়োজন হলে Branch বা BranchProfileDetails এ `coveragePolygon` (GeoJSON) যোগ করা |
| Validation | lat/lng রেঞ্জ; polygon সঠিক GeoJSON; optional max area |

**ডিপেন্ডেন্সি:** নেই। মাইগ্রেশন + প্রোফাইল আপডেট API।

---

## অর্ডার ও চেকলিস্ট

1. **3.3** Geocode + reverse (GET, rate limit, Redis cache) – বাকি স্টেপের জন্য ভিত্তি।
2. **3.6** Branch coverage_polygon (যদি দরকার) – schema + migration।
3. **3.1** Storage per country – appConfig + media.service।
4. **3.2** Payment plugin – policy table + provider interface (মিনিমাল)।
5. **3.4 / 3.5** Web ও Flutter পিকার – 3.3 ব্যবহার।

Phase 2 সম্পূর্ণ; Phase 3 শুরুর জন্য এই ডক ও [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md) এবং [LOCATION_MODULE_SPEC.md](./LOCATION_MODULE_SPEC.md) রেফারেন্স হিসেবে ব্যবহার করুন।
