# Location System Migration Plan

**Reference:** [LOCATION_SPEC.md](./LOCATION_SPEC.md), [LOCATION_AUDIT.md](./LOCATION_AUDIT.md)

This plan describes how to move from the current location usage to the WPA approach (Place, AdminUnit, ServiceArea, CountryPolicy) **without deleting existing data**. Existing data will be preserved and upgraded in place where needed.

---

## 1. Principles

- **No deletion:** Do not drop columns or remove existing location data. Only add or merge.
- **Backward compatible:** Existing addressJson, bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, cityCorporationId continue to work. New fields (e.g. lat/lng, coverageRadiusKm) are additive.
- **Ports and scripts:** No change to API port (3000) or Next.js ports (3100–3105).
- **Phased:** Place and API first; then ServiceArea (radius); then optional polygon and “nearby” API.

---

## 2. Data Preservation and Upgrade (বাংলা)

### ২.১ বর্তমান ডেটা কী কী আছে

- **Organization:** `addressJson` (একটি JSON ব্লব – ভিতরে kind, bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, fullPathText, countryCode ইত্যাদি থাকতে পারে)। `countryId` আলাদা কলাম।
- **Branch:** `addressJson` (একই রকম লোকেশন স্ন্যাপশট)। Branch-এর জন্য আলাদা করে BranchProfileDetails টেবিলে addressJson, latitude, longitude, coveragePolygon আছে – কিন্তু ওয়েব API দিয়ে latitude/longitude/coveragePolygon আপডেট হয় না।
- **FundraisingAccount:** BD লিংক (divisionId, districtId, upazilaId, areaId) + দেশ/গ্লোবাল ফিল্ড (countryCode, countryName, stateName, cityName, addressLine, latitude, longitude, formattedAddress)।
- **OwnerKyc:** divisionId, districtId, upazilaId, areaId (অপশনাল)।
- **BdDivision, BdDistrict, BdUpazila, BdArea:** বাংলাদেশের বিভাগ/জেলা/উপজেলা/এলাকা – অনেকেরই optional latitude/longitude আছে।
- **CityCorporation, Area:** ঢাকা সিটি কর্পোরেশন ও এরিয়া – Area-তে latitude/longitude আছে।

এই ডেটা **কোনোটা ডিলিট করা হবে না**। শুধু প্রয়োজন হলে নতুন কলাম যোগ হবে এবং পুরনো ডেটা থেকে নতুন ফর্ম্যাটে মান ভরার (backfill) পরিকল্পনা করা হবে।

### ২.২ Place (lat/lng-first) – ডেটা কীভাবে সংরক্ষণ ও আপগ্রেড হবে

- **সংরক্ষণ:**  
  - `addressJson` যেমন আছে তেমন থাকবে। ভবিষ্যতে আমরা API-তে একটি ইউনিফাইড “Place” রেসপন্স দেব (latitude, longitude, countryCode, state, city, formattedAddress, optional adminUnitIds)।  
  - যে টেবিলে ইতিমধ্যে latitude/longitude আছে (BranchProfileDetails, FundraisingAccount, BdArea, Area ইত্যাদি) সেগুলো অপরিবর্তিত থাকবে।

- **আপগ্রেড (কোড ছাড়া শুধু ধারণা):**  
  - **BranchProfileDetails:** ইতিমধ্যে latitude, longitude, coveragePolygon স্কিমায় আছে। আপগ্রেড = ওয়েব API (owner branch profile update) দিয়ে এই তিনটি ফিল্ড **লিখতে** পারা। কোনো পুরনো ডেটা মুছে ফেলা হবে না।  
  - **Organization / Branch:** addressJson-এর ভিতরে ইতিমধ্যে অনেক সময় fullPathText, kind, bdAreaId ইত্যাদি থাকে। ভবিষ্যতে আমরা চাইলে addressJson-এর সাথে সাথে optional “latitude”, “longitude” কিংবা “place” স্ন্যাপশট সেভ করতে পারি – এটা অ্যাডিটিভ; পুরনো ক্লায়েন্ট যারা শুধু addressJson পড়ে তারা ঠিক আগের মতো কাজ করবে।  
  - **Backfill (ঐচ্ছিক):** যেসব Branch/Org-এ addressJson আছে কিন্তু latitude/longitude নেই, সেখানে resolve API (bdAreaId বা dhakaAreaId দিয়ে) কল করে ল্যাট/লং নিয়ে DB-তে আপডেট করার একটা ওয়ান-টাইম স্ক্রিপ্ট চালানো যেতে পারে। এটা ঐচ্ছিক; ডিলিট বা রিপ্লেস নয়, শুধু খালি জায়গা পূরণ।

সংক্ষেপে: **পুরনো ডেটা সংরক্ষিত; নতুন ফিল্ড যোগ হলে সেটা অ্যাডিটিভ; ব্যাকফিল শুধু খালি মান পূরণের জন্য, কোনো ডেটা মুছে ফেলা হবে না।**

### ২.৩ AdminUnit (দেশভিত্তিক হায়ারার্কি) – সংরক্ষণ ও আপগ্রেড

- **সংরক্ষণ:**  
  - BdDivision, BdDistrict, BdUpazila, BdArea এবং CityCorporation, Area টেবিল ও তাদের ডেটা **অপরিবর্তিত** থাকবে।  
  - addressJson-এ যে bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, cityCorporationId সেভ করা হয় সেগুলো যেমন আছে তেমনই থাকবে।  
  - Country, State টেবিল ও পলিসি সম্পর্কিত ব্যবহার অপরিবর্তিত।

- **আপগ্রেড:**  
  - “AdminUnit” শুধু একটা ধারণা (কনসেপ্ট): দেশভেদে হায়ারার্কির গভীরতা আলাদা (বাংলাদেশ = বিভাগ→জেলা→উপজেলা→এলাকা; ঢাকা = সিটি কর্পোরেশন→এরিয়া)।  
  - কোনো টেবিল বা কলাম রিপ্লেস/ডিলিট করা হবে না। ভবিষ্যতে API রেসপন্সে আমরা চাইলে “adminUnit” হিসেবে এই আইডিগুলোর একটা স্ন্যাপশট দিতে পারি – এটা অ্যাডিটিভ।  
  - নতুন দেশ যোগ হলে সেই দেশের জন্য আলাদা AdminUnit টেবিল/স্ট্রাকচার পরবর্তী ফেজে যোগ করা যাবে; বর্তমান BD/ঢাকা ডেটা স্পর্শ করা হবে না।

সংক্ষেপে: **বর্তমান হায়ারার্কি ও সব আইডি সংরক্ষিত; AdminUnit = কনসেপ্ট ও অপশনাল API স্ন্যাপশট; কোনো ডেটা ডিলিট বা রিপ্লেস নয়।**

### ২.৪ ServiceArea (রেডিয়াস প্রথম, পলিগন পরে) – সংরক্ষণ ও আপগ্রেড

- **সংরক্ষণ:**  
  - BranchProfileDetails-এ ইতিমধ্যে latitude, longitude, coveragePolygon আছে। এই ডেটা **রাখা হবে**।  
  - coveragePolygon থাকলে সেটা পরবর্তী ফেজে “পয়েন্ট ইন পলিগন” চেকের জন্য ব্যবহার করা যাবে; মুছে ফেলা হবে না।

- **আপগ্রেড:**  
  - নতুন একটি কলাম যোগ হবে (যেমন `coverageRadiusKm` – Float, ঐচ্ছিক)। এই কলাম **অ্যাড** করা; কোনো পুরনো কলাম ডিলিট নয়।  
  - আগে থেকে যে শাখায় latitude, longitude বা coveragePolygon সেট করা আছে সেগুলো অপরিবর্তিত থাকবে।  
  - সার্ভিস এরিয়া চেক: প্রথমে রেডিয়াস দিয়ে (দূরত্ব ≤ coverageRadiusKm); যদি coveragePolygon থাকে তাহলে পরবর্তী ফেজে পলিগন দিয়েও চেক করা যাবে।  
  - কোনো পুরনো ডেটা মুছে ফেলা বা রিপ্লেস করা হবে না।

সংক্ষেপে: **coveragePolygon ও lat/lng সংরক্ষিত; শুধু coverageRadiusKm যোগ; লজিক আগে রেডিয়াস, পরে পলিগন – ডেটা লস নেই।**

### ২.৫ CountryPolicy – সংরক্ষণ

- CountryPolicy, StatePolicy, policyEngine, countryContext **কোনো পরিবর্তন নয়** ডেটা বা স্কিমার দিক থেকে।  
- শুধু ডকুমেন্টেশন: লোকেশন (countryCode/stateCode – Place বা হেডার থেকে) কিভাবে পলিসির ইনপুট সেটা স্পষ্ট করা হবে।  
- **কোনো ডেটা বা টেবিল ডিলিট/রিপ্লেস করা হবে না।**

---

## 3. Phased Migration (No Code Yet)

### Phase 1: Place + API (data preserved)

- **Schema:** No removal. Optionally add coverageRadiusKm on BranchProfileDetails (nullable).
- **API:**  
  - Owner branch profile update: accept and persist latitude, longitude, coveragePolygon (and coverageRadiusKm if added).  
  - Geocode/reverse/resolve: add optional unified “place” shape in response (lat, lng, countryCode, state, city, formattedAddress, optional adminUnitIds).  
- **Data:** No migration that deletes or overwrites. Backfill scripts only fill null lat/lng from resolve where applicable (optional).
- **UI:** Picker can send lat/lng to branch profile; existing addressJson flow unchanged.

### Phase 2: ServiceArea (radius)

- **Schema:** coverageRadiusKm already added in Phase 1 (or in this phase). Keep coveragePolygon.
- **API:**  
  - “Branches near me” (lat, lng, radius_km?) using Haversine + coverageRadiusKm (and optionally coveragePolygon later).  
  - “Is point in branch service area?” (branchId, lat, lng) – radius first, polygon optional.
- **Data:** No deletion. Existing latitude, longitude, coveragePolygon unchanged; only new/updated branches get coverageRadiusKm when set.

### Phase 3: Polygon and optional backfill

- **Logic:** Point-in-polygon for branches that have coveragePolygon set.
- **Backfill (optional):** Script to populate latitude/longitude (and optionally coverageRadiusKm) for branches that have addressJson (bdAreaId/dhakaAreaId) but null lat/lng, using resolve API. No delete/replace of existing rows.

---

## 4. What We Do Not Do

- We do **not** delete addressJson or any existing location columns.
- We do **not** drop BdDivision, BdDistrict, BdUpazila, BdArea, CityCorporation, Area or their data.
- We do **not** change Country, State, CountryPolicy, StatePolicy schema or existing data.
- We do **not** rename or remove existing API routes; we only add new fields and optional new endpoints.
- We do **not** change ports or build/run scripts.

---

## 5. Bengali Summary (সংক্ষিপ্ত সারাংশ)

- **বর্তমান ডেটা:** অর্গানাইজেশন/ব্রাঞ্চের addressJson, BD/ঢাকা হায়ারার্কি আইডি, BranchProfileDetails-এর latitude/longitude/coveragePolygon, FundraisingAccount-এর লোকেশন ফিল্ড – **কোনোটা ডিলিট বা রিপ্লেস করা হবে না।**
- **Place:** addressJson যেমন আছে তেমন থাকবে; নতুন করে শুধু API-তে ইউনিফাইড “Place” রেসপন্স ও ব্রাঞ্চ প্রোফাইলে lat/lng লিখার সুযোগ যোগ হবে। প্রয়োজনে ব্যাকফিল স্ক্রিপ্ট দিয়ে খালি lat/lng পূরণ করা যাবে – **ডেটা সংরক্ষণই থাকবে।**
- **AdminUnit:** BD/ঢাকা টেবিল ও সব আইডি অপরিবর্তিত; AdminUnit শুধু কনসেপ্ট ও ঐচ্ছিক API স্ন্যাপশট – **কোনো ডেটা মুছে ফেলা হবে না।**
- **ServiceArea:** coveragePolygon ও lat/lng রাখা হবে; শুধু coverageRadiusKm কলাম যোগ; সার্ভিস এরিয়া চেক আগে রেডিয়াস পরে পলিগন – **পুরনো ডেটা সংরক্ষিত।**
- **CountryPolicy:** কোনো স্কিমা বা ডেটা পরিবর্তন নয় – **সংরক্ষণই।**

**কোনো কোড এই ডকুমেন্টে লেখা নেই; শুধু ডিজাইন ও মাইগ্রেশন প্ল্যান।** কোড পরিবর্তন আলাদা স্টেপে করা হবে।
