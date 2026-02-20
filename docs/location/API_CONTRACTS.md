# Location API Contracts

**Reference:** [LOCATION_AUDIT.md](./LOCATION_AUDIT.md), [LOCATION_SPEC.md](./LOCATION_SPEC.md)

Minimal API design without breaking existing routes. **JSON examples only; no implementation.**

---

## 1. Get / Set User Location

**Scope:** Current user’s saved location (e.g. for “my location,” default address, or UI prefill). Additive under existing `/me` namespace.

### 1.1 Get user location

**Method / path:** `GET /api/v1/me/location`  
**Auth:** Required (session/JWT).  
**Existing routes:** No existing `GET /me/location`; additive.

**Response (200) – has location:**

```json
{
  "success": true,
  "data": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "countryCode": "BD",
    "stateName": null,
    "cityName": "Dhaka",
    "formattedAddress": "Dhanmondi, Dhaka, Bangladesh",
    "updatedAt": "2025-02-02T10:00:00.000Z"
  }
}
```

**Response (200) – no location set:**

```json
{
  "success": true,
  "data": null
}
```

### 1.2 Set user location

**Method / path:** `PUT /api/v1/me/location`  
**Auth:** Required.  
**Existing routes:** Additive.

**Request body:**

```json
{
  "latitude": 23.8103,
  "longitude": 90.4125,
  "countryCode": "BD",
  "stateName": null,
  "cityName": "Dhaka",
  "formattedAddress": "Dhanmondi, Dhaka, Bangladesh"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "countryCode": "BD",
    "stateName": null,
    "cityName": "Dhaka",
    "formattedAddress": "Dhanmondi, Dhaka, Bangladesh",
    "updatedAt": "2025-02-02T10:00:00.000Z"
  }
}
```

**Note:** All fields in request/response except `latitude` and `longitude` are optional. At least `latitude` and `longitude` required for set.

---

## 2. Reverse Geocode (lat/lng → address)

**Scope:** Turn coordinates into an address (and optional Place / admin match). Aligns with existing locations module; contracts only.

### 2.1 GET (query params)

**Method / path:** `GET /api/v1/locations/reverse?lat=23.8103&lng=90.4125`  
**Existing:** Yes ([LOCATION_AUDIT](./LOCATION_AUDIT.md)).

**Response (200):**

```json
{
  "success": true,
  "data": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "formattedAddress": "Dhanmondi, Dhaka, Bangladesh",
    "countryCode": "BD",
    "countryName": "Bangladesh",
    "stateName": null,
    "cityName": "Dhaka",
    "address": {
      "road": "Road 2",
      "suburb": "Dhanmondi",
      "city": "Dhaka",
      "country": "Bangladesh"
    },
    "matchedLocation": {
      "kind": "BD_AREA",
      "bdAreaId": 123,
      "divisionId": 1,
      "districtId": 2,
      "upazilaId": 5,
      "fullPathText": "Dhaka > Dhaka > Dhanmondi > Dhanmondi"
    }
  }
}
```

**Response (200) – no admin match (e.g. outside BD/Dhaka):**

```json
{
  "success": true,
  "data": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "formattedAddress": "Dhanmondi, Dhaka, Bangladesh",
    "countryCode": "BD",
    "countryName": "Bangladesh",
    "stateName": null,
    "cityName": "Dhaka",
    "address": { "city": "Dhaka", "country": "Bangladesh" },
    "matchedLocation": null
  }
}
```

### 2.2 POST (body)

**Method / path:** `POST /api/v1/locations/reverse-geocode`  
**Existing:** Yes.

**Request body:**

```json
{
  "latitude": 23.8103,
  "longitude": 90.4125
}
```

**Response (200):** Same shape as GET response above.

---

## 3. Search Place

**Scope:** Place search by text (and optional filters). Aligns with existing `/locations/geocode` and `/locations/search`; contracts only.

### 3.1 Place search (geocode / global)

**Method / path:** `GET /api/v1/locations/geocode?q=Dhanmondi%20Dhaka&countryCode=BD`  
**Existing:** Yes.  
**Query:** `q` (required), `countryCode` (optional, hint).

**Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "placeId": "12345678",
      "latitude": 23.8103,
      "longitude": 90.4125,
      "formattedAddress": "Dhanmondi, Dhaka, Bangladesh",
      "countryCode": "BD",
      "countryName": "Bangladesh",
      "stateName": null,
      "cityName": "Dhaka",
      "address": {
        "road": "Road 2",
        "suburb": "Dhanmondi",
        "city": "Dhaka",
        "country": "Bangladesh"
      }
    }
  ]
}
```

### 3.2 Unified search (BD + Dhaka + optional geocode)

**Method / path:** `GET /api/v1/locations/search?q=Dhanmondi&limit=20`  
**Existing:** Yes.  
**Query:** `q`, `limit` (optional), `countryCode` / `countryCodes` (optional), `global` (optional).

**Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "kind": "BD_AREA",
      "id": "123",
      "bdAreaId": 123,
      "divisionId": 1,
      "districtId": 2,
      "upazilaId": 5,
      "nameEn": "Dhanmondi",
      "nameBn": "ধানমন্ডি",
      "fullPathText": "Dhaka > Dhaka > Dhanmondi > Dhanmondi",
      "latitude": 23.8103,
      "longitude": 90.4125
    },
    {
      "kind": "GLOBAL_PLACE",
      "id": "osm:98765",
      "providerPlaceId": "98765",
      "latitude": 23.8103,
      "longitude": 90.4125,
      "countryCode": "BD",
      "formattedAddress": "Dhanmondi, Dhaka, Bangladesh"
    }
  ]
}
```

---

## 4. Nearby Service Query

**Scope:** Branches (or services) that serve a point, by radius. **New route;** additive. Uses branch center + optional `coverageRadiusKm` / `coveragePolygon` when implemented.

### 4.1 Branches near a point

**Method / path:** `GET /api/v1/locations/nearby?latitude=23.8103&longitude=90.4125&radiusKm=10&limit=20`  
**Auth:** Optional (public or session).  
**Existing:** No; new under `/locations` to keep location-related endpoints together.

**Query:** `latitude` (required), `longitude` (required), `radiusKm` (optional, default e.g. 10), `limit` (optional, default 20).

**Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "branchId": 1,
      "name": "Branch One",
      "orgId": 10,
      "orgName": "Org Name",
      "latitude": 23.811,
      "longitude": 90.413,
      "distanceKm": 0.5,
      "formattedAddress": "Road 2, Dhanmondi, Dhaka",
      "status": "PUBLISHED"
    },
    {
      "branchId": 2,
      "name": "Branch Two",
      "orgId": 11,
      "orgName": "Other Org",
      "latitude": 23.820,
      "longitude": 90.420,
      "distanceKm": 2.1,
      "formattedAddress": "Mirpur, Dhaka",
      "status": "PUBLISHED"
    }
  ]
}
```

**Response (200) – none in radius:**

```json
{
  "success": true,
  "data": []
}
```

**Note:** Implementation will use Haversine distance from (latitude, longitude) to branch center; optional later: filter by `coverageRadiusKm` or `coveragePolygon`. Contract stays the same.

---

## 5. Country Policy Read

**Scope:** Read-only active policy for a country (and optionally state) for features and rules. No admin write; additive read contract. Can be implemented under `/meta` or a dedicated read-only path so existing admin routes stay unchanged.

### 5.1 Get active country policy

**Method / path:** `GET /api/v1/meta/policy?countryCode=BD`  
**Auth:** Optional (public or session; policy is non-sensitive feature/rules).  
**Existing:** `/meta` exists; no existing `GET /meta/policy` in audit; additive.

**Query:** `countryCode` (required, ISO 3166-1 alpha-2). Optional: `stateCode` for state override.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "countryCode": "BD",
    "countryName": "Bangladesh",
    "policyId": 1,
    "policyName": "Bangladesh Default Policy",
    "status": "ACTIVE",
    "features": [
      { "featureCode": "DONATION", "enabled": true },
      { "featureCode": "PRODUCTS", "enabled": true },
      { "featureCode": "ADS", "enabled": false }
    ],
    "currencyCode": "BDT",
    "stateCode": null,
    "stateName": null
  }
}
```

### 5.2 Get active policy with state override

**Method / path:** `GET /api/v1/meta/policy?countryCode=US&stateCode=CA`  
**Query:** `countryCode`, `stateCode` (optional).

**Response (200):**

```json
{
  "success": true,
  "data": {
    "countryCode": "US",
    "countryName": "United States",
    "policyId": 2,
    "policyName": "US Default",
    "status": "ACTIVE",
    "features": [
      { "featureCode": "DONATION", "enabled": true },
      { "featureCode": "PRODUCTS", "enabled": true }
    ],
    "currencyCode": "USD",
    "stateCode": "CA",
    "stateName": "California",
    "statePolicyId": 5,
    "statePolicyName": "California Override"
  }
}
```

**Response (404) – no active policy:**

```json
{
  "success": false,
  "message": "No active policy for country"
}
```

---

## 6. Summary

| Capability           | Method / path                               | Status    |
|-----------------------|---------------------------------------------|-----------|
| Get user location     | `GET /api/v1/me/location`                   | New       |
| Set user location     | `PUT /api/v1/me/location`                   | New       |
| Reverse geocode       | `GET /api/v1/locations/reverse`, `POST .../reverse-geocode` | Existing  |
| Search place          | `GET /api/v1/locations/geocode`, `GET .../search` | Existing  |
| Nearby service        | `GET /api/v1/locations/nearby`              | New       |
| Country policy read   | `GET /api/v1/meta/policy`                   | New (additive) |

All new routes are additive; existing location and meta routes are unchanged. JSON only; no implementation in this document.
