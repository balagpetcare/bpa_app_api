# WPA / BPA Location System – Cursor AI Execution Guide
Version: 1.0
Scope: Complete Global Location System (Backend + Frontend)
Rule: Follow instructions EXACTLY. Do not improvise.

---

## 0. GLOBAL RULES (MANDATORY)

- Do NOT scan the entire repository.
- Touch ONLY files explicitly mentioned per step.
- Do NOT refactor, redesign, or rename existing logic.
- Do NOT delete old code; only merge or extend.
- If something is missing, add TODO — do NOT ask questions unless blocked.
- Output format for every task:
  1) Changed file list
  2) Code diff blocks only
  3) No explanations

---

## 1. PROJECT CONTEXT (READ ONLY)

Backend:
- Path: `backend-api`
- Stack: Node.js, Express, TypeScript, Prisma, PostgreSQL
- API base: `/api/v1`
- Auth already exists under `/me` module
- Port 3000 is fixed

Frontend:
- Path: `bpa_web`
- Stack: Next.js (App Router)
- Owner UI path: `app/owner/organizations/new`
- Existing UI style must not change

Goal:
Implement a production-ready, ad-grade, global location system with:
- OSM map drag-drop
- GPS/IP auto-detect
- Location history & inference
- Auto-fill from last location
- Global country/state dataset support

---

## 2. STEP EXECUTION ORDER (DO NOT CHANGE)

You MUST execute steps in this order:

1) Backend: Location Event History
2) Backend: recently_in + home inference
3) Backend: Manual place save + normalization + geohash
4) Frontend: Auto-fill from last location
5) Frontend: Use my current location (GPS/IP)
6) Frontend: OSM Map drag & drop
7) Frontend: Global dataset (country/state/city)
8) Frontend: Final submit glue

---

## 3. STEP 1 – BACKEND: LOCATION EVENT HISTORY

Files to attach:
- backend-api/src/api/v1/modules/me/me.routes.ts
- backend-api/src/api/v1/modules/me/me.controller.ts

Allowed new file:
- backend-api/src/api/v1/modules/me/location.service.ts

Tasks:
- Ensure POST `/api/v1/me/location/events`
  - Saves UserLocationEvent
  - Updates UserLocationProfile.lastLat/lastLng/lastUpdatedAt
- Ensure GET `/api/v1/me/location`
  - Returns profile + last 20 events
- STRICT TypeScript narrowing:
  - Never access `.message` without `if (result.ok === false)`

---

## 4. STEP 2 – BACKEND: recently_in + home INFERENCE

Files to attach:
- backend-api/src/api/v1/modules/me/location.service.ts
- backend-api/src/api/v1/modules/me/me.controller.ts

Tasks:
- recently_in:
  - Most frequent city/admin1 from last 7 days
- home:
  - Most frequent location from last 30 days
  - Manual override wins
- Extend GET `/me/location` response:
  - geoKeys: country, admin1, city, postal, geohash, home, recently_in

No cron, no ML. Simple logic only.

---

## 5. STEP 3 – BACKEND: MANUAL PLACE + GEOHASH

Files to attach:
- backend-api/src/api/v1/modules/me/location.service.ts
- backend-api/prisma/schema.prisma

Allowed new files:
- backend-api/src/api/v1/modules/me/geohash.util.ts
- backend-api/src/api/v1/modules/me/location.normalize.ts

Tasks:
- Implement POST `/api/v1/me/location/manual`
- Upsert LocationPlace using stable dedupe key
- Set manualOverridePlaceId + currentPlaceId
- Create MANUAL_SET event
- Compute geohash (no external API)

---

## 6. STEP 4 – FRONTEND: AUTO-FILL FROM LAST LOCATION

Files to attach:
- bpa_web/app/owner/organizations/new/page.jsx
- bpa_web/lib/api.ts

Tasks:
- On page load call GET `/api/v1/me/location`
- Pre-fill location fields from:
  - manualOverridePlace OR currentPlace
- Show small helper text: “Loaded from last saved location”

No UI redesign.

---

## 7. STEP 5 – FRONTEND: USE MY CURRENT LOCATION (GPS/IP)

Files to attach:
- bpa_web/app/owner/organizations/new/page.jsx
- bpa_web/components/LocationPicker.jsx
- bpa_web/lib/api.ts

Tasks:
- Add button: “Use my current location”
- Use `navigator.geolocation.getCurrentPosition`
- On success:
  - Set lat/lng in form
  - POST `/api/v1/me/location/events`
    - source=GPS
    - eventType=PING
- On failure:
  - Fallback to IP-based coarse location
  - If backend endpoint missing, add TODO only

---

## 8. STEP 6 – FRONTEND: MAP DRAG & DROP (OSM)

Files to attach:
- bpa_web/components/LocationPicker.jsx
- bpa_web/app/owner/organizations/new/page.jsx

Allowed new files:
- bpa_web/components/MapPicker.jsx
- bpa_web/lib/reverseGeocode.ts

Tasks:
- Use Leaflet + OpenStreetMap tiles
- Toggle: “Pick on map”
- Draggable marker updates lat/lng
- Default center:
  - Existing lat/lng OR (23.8103, 90.4125)
- Reverse geocode via Nominatim (best effort, debounced)

No Google Maps. No redesign.

---

## 9. STEP 7 – FRONTEND: GLOBAL DATASET (SEARCHABLE)

### 7A – Country List
Allowed new file:
- bpa_web/lib/countries.ts

Tasks:
- ISO country list
- Searchable dropdown

### 7B – State / Province
Allowed new file:
- bpa_web/lib/admin1.ts

Tasks:
- Provide dataset for:
  BD, IN, US, CA, UK, AU, DE, FR, UAE, SA
- If dataset exists → dropdown
- Else → text input fallback

### 7C – City
Tasks:
- Keep text input
- Add TODO for future backend city search API

---

## 10. STEP 8 – FINAL SUBMIT GLUE

Files to attach:
- bpa_web/app/owner/organizations/new/page.jsx
- bpa_web/lib/api.ts

Tasks:
- Before org create submit:
  - POST `/api/v1/me/location/manual`
- Payload must include:
  - countryCode, admin1, admin2, city, postalCode
  - formattedAddress, lat, lng
  - Bangladesh fields if countryCode=BD

---

## 11. DEFINITION OF DONE

System is considered complete when:
- Location history is stored
- User can auto-detect or manually select location
- Map drag-drop works without Google Maps
- Last location auto-fills forms
- recently_in and home are computed
- Global dataset supports multiple countries
- No TypeScript build errors
- No UI redesign occurred

END OF INSTRUCTIONS.
