# Phase-5 Step-3 Report: Owner Branch Profile Location Wiring

**Scope:** Persist `BranchProfileDetails.latitude`, `longitude`, `coverageRadiusKm`, and `coveragePolygon` when the owner saves the branch profile draft. No frontend changes; merge/add only; backward compatible.

---

## 1. Exact Files Changed

| File | Change |
|------|--------|
| `src/api/v1/modules/owner/owner.controller.ts` | In `saveBranchProfileDraft`: read `latitude`, `longitude`, `coverageRadiusKm`, `coveragePolygon` from `req.body`; pass them into `upsertBranchProfileDetails` only when present (existing request bodies without these fields still work). |

**Not changed:** No Zod or other validation layer for this route; no separate owner service file; no route or Prisma schema changes (columns already exist from Phase-5 Step-1).

---

## 2. Request / Response Examples (curl)

**Base:** Owner auth required. Replace `OWNER_TOKEN` and `BRANCH_ID` and `BASE_URL` (e.g. `http://localhost:3000`).

### 2.1 Update only location fields (lat/lng, radius, optional polygon)

```bash
curl -s -X POST "%BASE_URL%/api/v1/owner/branches/%BRANCH_ID%/profile/save-draft" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer %OWNER_TOKEN%" \
  -d "{
    \"latitude\": 23.8103,
    \"longitude\": 90.4125,
    \"coverageRadiusKm\": 5,
    \"coveragePolygon\": {
      \"type\": \"Polygon\",
      \"coordinates\": [[[90.41, 23.81], [90.42, 23.81], [90.42, 23.82], [90.41, 23.82], [90.41, 23.81]]]
    }
  }"
```

**Example response (200):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "branchId": 42,
    "branchPhone": null,
    "branchEmail": null,
    "managerName": null,
    "managerPhone": null,
    "addressJson": null,
    "latitude": 23.8103,
    "longitude": 90.4125,
    "googleMapLink": null,
    "coveragePolygon": { "type": "Polygon", "coordinates": [[[90.41, 23.81], [90.42, 23.81], [90.42, 23.82], [90.41, 23.82], [90.41, 23.81]]] },
    "coverageRadiusKm": 5,
    "openingHoursJson": null,
    "weeklyOffDaysJson": null,
    "verificationStatus": "UNSUBMITTED",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### 2.2 Backward compatibility: existing body without location fields

```bash
curl -s -X POST "%BASE_URL%/api/v1/owner/branches/%BRANCH_ID%/profile/save-draft" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer %OWNER_TOKEN%" \
  -d "{\"branchPhone\": \"+8801712345678\", \"branchEmail\": \"branch@example.com\"}"
```

**Example response (200):** `success: true`, `data` includes existing `latitude`/`longitude`/`coverageRadiusKm`/`coveragePolygon` unchanged (or null if never set).

### 2.3 Clear optional polygon (send null)

```bash
curl -s -X POST "%BASE_URL%/api/v1/owner/branches/%BRANCH_ID%/profile/save-draft" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer %OWNER_TOKEN%" \
  -d "{\"coveragePolygon\": null}"
```

**Example response (200):** `data.coveragePolygon` is `null`.

---

## 3. How to Verify the DB Row Updated

**Table:** `branch_profile_details` (Prisma model: `BranchProfileDetails`).

**Columns persisted by this step:**

| Column | Type | Notes |
|--------|------|--------|
| `latitude` | `Float` (nullable) | Only updated if key sent in request body. |
| `longitude` | `Float` (nullable) | Only updated if key sent in request body. |
| `coverage_radius_km` | `Float` (nullable) | Only updated if key sent; non‑negative. |
| `coverage_polygon` | `Json` (nullable) | Only updated if key sent; object or `null`. |

**Verification (Postgres):**

```sql
SELECT id, branch_id, latitude, longitude, coverage_radius_km, coverage_polygon, updated_at
FROM branch_profile_details
WHERE branch_id = :branchId;
```

**Verification (Prisma / Node):**

```js
const row = await prisma.branchProfileDetails.findUnique({
  where: { branchId: branchId },
  select: { latitude: true, longitude: true, coverageRadiusKm: true, coveragePolygon: true, updatedAt: true }
});
```

After a successful save-draft with location fields, `latitude`, `longitude`, `coverageRadiusKm`, and `coveragePolygon` should match the request (or `null` where sent as null/invalid). `updated_at` should reflect the last save.

---

## 4. Summary

- **Single touch point:** `owner.controller.ts` → `saveBranchProfileDraft` and the existing `upsertBranchProfileDetails` helper.
- **Backward compatible:** Requests without `latitude`/`longitude`/`coverageRadiusKm`/`coveragePolygon` leave existing DB values unchanged.
- **No frontend or route changes;** no new migrations (schema already had these columns).

Phase-5 Step-3 is complete. Stop here as requested.
