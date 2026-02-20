<br />

## লক্ষ্য

* `http://localhost:3104/owner/organizations/new` পেজে “Business Location (Bangladesh / Dhaka City)” BD-only অপশন বাদ দিয়ে এমন Location picker করা, যাতে যে কোনো দেশের ইউজার একই UI দিয়ে লোকেশন সিলেক্ট করতে পারে।

* বাংলাদেশের জন্য বর্তমান Division/District/Upazila/Area এবং Dhaka City Corporation/Ward/Area flow বজায় থাকবে (কারণ এটা লোকাল অপারেশনাল প্রয়োজন)।

## গুরুত্বপূর্ণ ধারণা (সারা বিশ্বের জন্য “একই মডেল” কি সম্ভব?)

* **একই exact hierarchy সব দেশে হয় না**। Bangladesh: Division→District→Upazila→Area; India: State→District→Tehsil/Block→Village; USA/Canada: State/Province→County/Region→City→ZIP/Postal; UK: Country→County→District/Borough→Town/City→Postcode; Singapore: State নেই—Planning Area/Subzone/Postal Code ইত্যাদি।

* তাই Standard সমাধান হলো:

  * **Structured fields (কমন সেট):** countryCode, countryName, state/province, city/locality, postalCode, formattedAddress, lat/lng

  * **Provider place id:** (OSM/Google ইত্যাদির place\_id/osm\_id) যাতে future verify/update করা যায়

  * **Bangladesh-এর মতো দেশের জন্য** আপনার নিজের curated hierarchy (existing BD tables) রাখা—কারণ এটা বেশি accurate/local-friendly।

## Facebook/ Social মিডিয়া কিভাবে Location collect করে (high-level)

* **User provided:** profile city/hometown, page/business address, check-in, tagged location

* **Device signals (permission-based):** GPS, Wi‑Fi/Bluetooth proximity (অনেক সময়), cell network

* **Network inference:** IP-based approximate location

* **Reverse geocoding:** lat/lng → human-readable address (provider/place database)

* বড় প্ল্যাটফর্মগুলো সাধারণত “সব দেশের জন্য আলাদা hierarchy table” maintain না করে **Place database + geocoding + standard components** ব্যবহার করে এবং granularities (country/state/city/zip) level এ store করে।

## আপনার বর্তমান কোডে কী আছে (সংক্ষেপ)

* Frontend: `ImprovedLocationPicker` → `EnhancedLocationDropdown` শুধুই BD+Dhaka data টানে এবং dropdown দেয়।

* Backend: `/api/v1/locations/geocode` ইতিমধ্যে আছে কিন্তু **Bangladesh-এ restrict** করা (`countrycodes: 'bd'`)।

* Backend org create: location data `Organization.addressJson`-এ store হয়, এবং org `countryId` countryContext থেকে আসে।

## Proposed Standard Solution (আপনার সিস্টেমে)

### 1) UI: “Country first, then location”

* Organization New পেজে Business Location field হবে:

  * **Country dropdown** (Country table থেকে)

  * Country=BD হলে: existing BD/Dhaka dropdown picker

  * Country≠BD হলে: **Global address search dropdown (autocomplete)** + optional lat/lng

### 2) Backend: Global geocoding endpoint

* বিদ্যমান `GET/POST /api/v1/locations/geocode` কে upgrade করা:

  * `countrycodes` hardcoded `bd` না রেখে optional করা

  * request থেকে `countryCode(s)` পেলে filter করা, না পেলে global search

  * response এ `place_id/osm_id/osm_type`, `display_name`, `lat/lon`, `address` components রাখা

  * caching + rate limit already আছে—এটা বজায় থাকবে

### 3) Backend: Countries list endpoint

* নতুন endpoint (read-only): `GET /api/v1/locations/countries?active=1`

  * returns: `{id, code, name}`

  * UI এর country dropdown populate করবে

### 4) Data model (migration ছাড়া backward-compatible)

* Organization table change না করে `Organization.addressJson` এ global fields add করা:

  * `locationKind: 'BD' | 'GLOBAL'`

  * `countryCode`, `countryName`, `stateName`, `cityName`, `postalCode`, `addressLine`, `formattedAddress`, `latitude`, `longitude`, `provider`, `providerPlaceId`

  * BD mode এ আগের মতো `divisionId/districtId/upazilaId/bdAreaId` অথবা `cityCorporationId/dhakaAreaId`

## Code Changes (যেখানে কাজ হবে)

### Frontend (bpa\_web)

* `app/owner/organizations/new/page.jsx`: title/field update + new global-capable picker use

* `app/owner/_components/location/ImprovedLocationPicker.jsx`: country selector + BD vs Global mode UI

* `app/owner/_components/location/EnhancedLocationDropdown.jsx`:

  * bugfix: `/api/v1/locations/resolve-location` → `/api/v1/locations/resolve`

  * global mode এ geocode autocomplete support (new flow)

### Backend (backend-api)

* `src/api/v1/modules/locations/locations.controller.ts`:

  * `geocode()` থেকে `countrycodes:'bd'` hardcode remove/parameterize

  * optional new `listCountries` controller

* `src/api/v1/modules/locations/locations.routes.ts`:

  * `GET /countries` route add

## Testing / Verification

* Unit-ish: geocode endpoint BD filter + global search both return

* Manual UI:

  * Country=BD: আগের মতো BD/Dhaka dropdown কাজ করে

  * Country=IN/US/UK: address autocomplete কাজ করে, selection এ `formattedAddress + lat/lng` সেট হয়

  * Organization create payload এ addressJson এর locationKind অনুযায়ী fields save হয়

## Out-of-scope (প্রথম ধাপে)

* প্রতিটি দেশের জন্য Bangladesh-এর মতো full normalized hierarchy tables (খুব বড় কাজ)

* Offline/own-hosted geocoder (Pelias/Photon) — পরে scalability/security এর জন্য add করা যাবে

আপনি কনফার্ম করলে আমি এই প্ল্যান অনুযায়ী কোড চেঞ্জ শুরু করবো।
