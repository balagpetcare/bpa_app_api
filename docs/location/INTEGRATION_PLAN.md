# Location System Integration Plan

**Reference:** [LOCATION_AUDIT.md](./LOCATION_AUDIT.md)

This plan integrates a future-proof location system into the existing codebase without deleting or breaking any current behavior. It keeps `addressJson` and existing BD/Dhaka hierarchies intact and adds a canonical lat/lng-first path (Place), service areas, and policy linkage.

---

## 1. Principles (Non-Negotiable)

- **No deletion:** Never drop existing tables/columns or remove legacy location fields.
- **Backward compatible:** Existing `addressJson` (bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, cityCorporationId, fullPathText, countryCode) remains valid.
- **Additive only:** New fields and APIs are additive and optional for clients.
- **Ports fixed:** API stays on 3000; Next.js apps on 3100–3105.
- **Small patches:** Minimal, targeted changes only.

---

## 2. Data Model (Additive)

### 2.1 Place (lat/lng-first)

- **Concept:** A canonical Place is a lat/lng pair with optional admin hints and formatted address.
- **Storage (additive):**
  - Keep `addressJson` as-is on `Organization` and `Branch`.
  - Introduce a `Place` model (lat, lng, optional address snapshot) and link it to entities where needed.
  - Allow `addressJson` to co-exist with Place; do not replace it.

### 2.2 Existing Admin Hierarchies

- Keep `BdDivision`, `BdDistrict`, `BdUpazila`, `BdArea`, `CityCorporation`, `Area` unchanged.
- Continue reading/writing BD/Dhaka IDs in `addressJson`.
- Optionally surface an `adminUnit` snapshot in API responses (derived, not stored).

### 2.3 Branch Profile Location

- `BranchProfileDetails` already supports:
  - `latitude`, `longitude`, `coveragePolygon`.
- Add/maintain **service area radius**:
  - `coverageRadiusKm` (Float, optional).

---

## 3. Service Area (Radius First, Polygon Ready)

- **Radius first:** If `coverageRadiusKm` is present, use distance checks against branch lat/lng.
- **Polygon later:** If `coveragePolygon` is present, add optional polygon checks when needed.
- **No removal:** Coverage polygon remains valid and optional.

---

## 4. Country-Level Policy

- Keep existing policy layers (`CountryPolicy`, `StatePolicy`, `countryContext`, `policyEngine`).
- Derive country/state from Place or `addressJson` when needed.
- Policy checks remain backward compatible; only add new policy hooks for new features.

---

## 5. Universal Location Picker (Frontend)

- Single picker outputs **Place** (lat/lng + optional admin hints + formattedAddress).
- Existing components remain until consolidated; no removals.
- Backend keeps existing `geocode`, `reverse-geocode`, `resolve`, and `search` endpoints.

---

## 6. Phased Implementation

### Phase 1: Document + Minimal Wiring

- Produce `LOCATION_AUDIT.md` (current usage inventory).
- Wire owner branch profile to save lat/lng/coverage.
- Ensure location picker can submit lat/lng + radius.

### Phase 2: Place + Service Area

- Introduce `Place` model and `User.currentPlaceId`.
- Add coverage radius (`coverageRadiusKm`) where needed.
- Add nearby search and service-area checks (radius first).

### Phase 3: Policy + Picker Default

- Connect Place-derived country/state into policy checks.
- Make universal picker the default (without deleting old components).

---

## 7. Touch Points (No Code Yet)

**Backend**

- `src/api/v1/modules/locations/*`
- `src/api/v1/modules/owner/owner.controller.ts` (branch profile)
- `src/api/v1/services/policyEngine.service.ts`
- `src/middlewares/countryContext.ts`
- Prisma: `schema.prisma` (Place, BranchProfileDetails)

**Frontend**

- `app/owner/_components/location/*`
- `app/owner/organizations/*`
- `app/owner/branches/*`
- `app/owner/profile/*`

---

## 8. Notes

- All changes are additive and backward compatible.
- No code changes in this document; only planning.
