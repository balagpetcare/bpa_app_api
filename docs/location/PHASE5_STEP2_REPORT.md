# Phase-5 Step-2 Report (Backend API Only)

**Scope:** Implement GET /me/location, PUT /me/location, GET /locations/nearby, GET /meta/policy per API_CONTRACTS.md. No frontend, no refactors outside listed files, no deletions.

---

## 1. Exact Files Changed

Step-2 uses the following files (endpoints were already implemented; no further edits in this step):

| File | Purpose |
|------|--------|
| `src/api/v1/modules/me/me.controller.ts` | `getLocation`, `setLocation` – GET/PUT /api/v1/me/location |
| `src/api/v1/modules/me/me.routes.ts` | Routes: GET /location, PUT /location (auth) |
| `src/api/v1/modules/locations/locations.controller.ts` | `getNearby` – GET /api/v1/locations/nearby |
| `src/api/v1/modules/locations/locations.routes.ts` | Route: GET /nearby |
| `src/api/v1/modules/meta/meta.controller.ts` | `getPolicy` – GET /api/v1/meta/policy |
| `src/api/v1/modules/meta/meta.routes.ts` | Route: GET /policy |

**No other files were modified.** Existing behavior and payloads remain backward compatible.

---

## 2. How to Test Each Endpoint (curl)

Base URL: `http://localhost:3000` (API on port 3000). For auth endpoints, replace `YOUR_JWT` with a valid Bearer token after login.

### 2.1 GET /api/v1/me/location

**No location set:**
```bash
curl -s -X GET "http://localhost:3000/api/v1/me/location" \
  -H "Authorization: Bearer YOUR_JWT"
```
Expected: `200` – `{"success":true,"data":null}`

**After setting a location (see PUT below):**
```bash
curl -s -X GET "http://localhost:3000/api/v1/me/location" \
  -H "Authorization: Bearer YOUR_JWT"
```
Expected: `200` – `{"success":true,"data":{ "latitude": 23.8103, "longitude": 90.4125, "countryCode": "BD", ... }}`

**No auth:**
```bash
curl -s -X GET "http://localhost:3000/api/v1/me/location"
```
Expected: `401` – Unauthorized

---

### 2.2 PUT /api/v1/me/location

**Set location (minimal: lat/lng only):**
```bash
curl -s -X PUT "http://localhost:3000/api/v1/me/location" \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"latitude\": 23.8103, \"longitude\": 90.4125}"
```
Expected: `200` – `{"success":true,"data":{ "latitude": 23.8103, "longitude": 90.4125, ... }}`

**Set location (full Place shape):**
```bash
curl -s -X PUT "http://localhost:3000/api/v1/me/location" \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"latitude\": 23.8103, \"longitude\": 90.4125, \"countryCode\": \"BD\", \"cityName\": \"Dhaka\", \"formattedAddress\": \"Dhanmondi, Dhaka, Bangladesh\"}"
```
Expected: `200` – same shape with optional fields in `data`

**Missing lat/lng:**
```bash
curl -s -X PUT "http://localhost:3000/api/v1/me/location" \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"countryCode\": \"BD\"}"
```
Expected: `400` – "latitude and longitude are required"

---

### 2.3 GET /api/v1/locations/nearby

**With required query params:**
```bash
curl -s -X GET "http://localhost:3000/api/v1/locations/nearby?latitude=23.8103&longitude=90.4125"
```
Expected: `200` – `{"success":true,"data":[...]}` (array of branches with branchId, name, orgId, orgName, latitude, longitude, distanceKm, formattedAddress, status)

**With optional radiusKm and limit:**
```bash
curl -s -X GET "http://localhost:3000/api/v1/locations/nearby?latitude=23.8103&longitude=90.4125&radiusKm=5&limit=10"
```
Expected: `200` – same shape; default radiusKm=10, limit=20 if omitted

**Missing latitude or longitude:**
```bash
curl -s -X GET "http://localhost:3000/api/v1/locations/nearby?latitude=23.8103"
```
Expected: `400` – "latitude and longitude are required"

---

### 2.4 GET /api/v1/meta/policy

**Country only:**
```bash
curl -s -X GET "http://localhost:3000/api/v1/meta/policy?countryCode=BD"
```
Expected: `200` – `{"success":true,"data":{ "countryCode": "BD", "countryName": "...", "policyId": ..., "policyName": "...", "status": "ACTIVE", "features": [...], "currencyCode": "...", "stateCode": null, "stateName": null }}`  
Or `404` – "No active policy for country" if no ACTIVE policy for BD.

**Country + state (optional):**
```bash
curl -s -X GET "http://localhost:3000/api/v1/meta/policy?countryCode=US&stateCode=CA"
```
Expected: `200` – same shape with stateCode/stateName/statePolicyId/statePolicyName when state policy exists; or `404` if none.

**Missing countryCode:**
```bash
curl -s -X GET "http://localhost:3000/api/v1/meta/policy"
```
Expected: `400` – "countryCode is required" (when req.countryContext is also empty)

---

## 3. Migration Needed

**None.** Step-1 (Prisma migration for Place + coverageRadiusKm) was already applied. Step-2 only adds/uses existing backend route and controller code; no schema or migration changes.

---

## 4. Summary

| Endpoint | Method | Auth | File(s) |
|----------|--------|------|---------|
| /api/v1/me/location | GET | Yes | me.controller.ts, me.routes.ts |
| /api/v1/me/location | PUT | Yes | me.controller.ts, me.routes.ts |
| /api/v1/locations/nearby | GET | No | locations.controller.ts, locations.routes.ts |
| /api/v1/meta/policy | GET | No | meta.controller.ts, meta.routes.ts |

All four endpoints are implemented per API_CONTRACTS.md and IMPLEMENTATION_SUMMARY.md. No frontend changes; no refactors outside the listed files; no deletions; existing behavior and payloads remain backward compatible.
