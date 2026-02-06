# Location System Spec – WPA Approach vs Current

**Reference:** [LOCATION_AUDIT.md](./LOCATION_AUDIT.md), [LOCATION_MODULE_SPEC.md](../LOCATION_MODULE_SPEC.md), [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](../GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md)

---

## 1. WPA Location Approach (Target)

চারটি ধারণা দিয়ে লোকেশন সিস্টেম ডিজাইন করা হবে:

| Concept | Description |
|--------|--------------|
| **Place** | Lat/lng-first ground truth. Every addressable location is a point (latitude, longitude) plus optional display/address metadata. |
| **AdminUnit** | Optional country-specific hierarchy (country → state → division → district → city → area). Depth varies by country; BD has Division/District/Upazila/Area + Dhaka CityCorporation/Area. |
| **ServiceArea** | Where a branch (or org) serves: radius-based initially (center + radius in km), polygon-ready later (GeoJSON). Used for “delivery zone,” “nearby branches,” etc. |
| **CountryPolicy** | Feature and rule control per country (and optionally state): which features are on, payment methods, KYC rules, etc. Location (country/state) feeds into policy, not the other way around. |

---

## 2. Current State vs WPA

### 2.1 Place (lat/lng-first)

| Aspect | Current | WPA target |
|--------|---------|------------|
| **Ground truth** | Mixed: BD/Dhaka hierarchy IDs (bdAreaId, dhakaAreaId) + optional lat/lng on BranchProfileDetails, FundraisingAccount, BdArea, Area. No single “Place” type. | **Place** = canonical (lat, lng) + optional formattedAddress, countryCode, state/city names. Hierarchy is optional overlay. |
| **Storage** | addressJson blobs (Organization, Branch); latitude/longitude on BranchProfileDetails (not written by owner API); FundraisingAccount has lat/lng + hierarchy. | Normalize to: every stored “location” has at least (lat, lng) when available; address/hierarchy as optional snapshot. |
| **API** | Geocode/reverse return lat/lng + address; resolve returns BD/Dhaka by id. No unified “place” response shape. | Single “place” payload: `{ latitude, longitude, countryCode?, state?, city?, formattedAddress?, adminUnitIds? }` for search/geocode/resolve. |
| **Gap** | Owner branch profile update does not send latitude/longitude to BranchProfileDetails. No shared Place type in API. | Add Place as first-class notion in API and storage; ensure branch/org can store and return lat/lng. |

### 2.2 AdminUnit (optional country-specific depth)

| Aspect | Current | WPA target |
|--------|---------|------------|
| **BD hierarchy** | BdDivision → BdDistrict → BdUpazila → BdArea (with parentId for tree). All have optional latitude/longitude. | Keep as **AdminUnit** for BD: same tables, optional depth (e.g. “up to upazila” or “up to area”). Place can reference adminUnitIds for display/filter. |
| **Dhaka** | CityCorporation → Area (parent tree). Area has lat/lng. | Keep as AdminUnit for Dhaka; map to Place via center lat/lng when needed. |
| **Global** | Country, State tables (policy/RBAC). No geo hierarchy for other countries yet. | **AdminUnit** = country-specific: BD depth 4, others TBD (e.g. state/city). Country + State already exist; city/region can be added per country. |
| **Usage** | addressJson stores bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, cityCorporationId; validation in owner API. | Preserve all; add optional “adminUnit” snapshot on Place (e.g. BD: divisionId, districtId, upazilaId, bdAreaId) for display and policy. |
| **Gap** | No generic “AdminUnit” abstraction; BD and Dhaka are hard-coded. | Document BD/Dhaka as first AdminUnit implementations; design optional generic AdminUnit layer for future countries. |

### 2.3 ServiceArea (radius-based, polygon-ready)

| Aspect | Current | WPA target |
|--------|---------|------------|
| **Branch coverage** | BranchProfileDetails has coveragePolygon (GeoJSON), latitude, longitude. Not set via owner API. | **ServiceArea**: center = (lat, lng); radius_km (required initially); optional polygon (GeoJSON) later. “Point in service area” = distance ≤ radius or point-in-polygon. |
| **Storage** | coveragePolygon only; no radius. | Add coverageRadiusKm (Float, km). Keep coveragePolygon for Phase 2. |
| **API** | No “is point in service area” or “branches near me.” | GET “branches near me” (lat, lng, radius_km?) and/or “is this point served by branch X.” |
| **Logic** | locationMatcher finds nearest BdArea/Area within maxDistance; not branch service area. | Reuse Haversine/distance; add “branch.serviceArea.contains(lat, lng)” (radius first, polygon optional). |
| **Gap** | coveragePolygon and lat/lng not written from UI/API. No radius, no “nearby” API. | Expose lat/lng + coverageRadiusKm in branch profile API; add service-area checks and nearby API. |

### 2.4 CountryPolicy (feature + rule control)

| Aspect | Current | WPA target |
|--------|---------|------------|
| **Policy** | CountryPolicy, StatePolicy; policyEngine.service (getActivePolicy(countryCode), getActiveStatePolicy(countryCode, stateCode)); features, payment methods, rules. | Same: **CountryPolicy** = feature flags + rules per country (and state). No change to model; clarify that “location” (country/state from Place or header) is input to policy. |
| **Context** | countryContext middleware: X-Country-Code → user country role → org country → default BD. Sets req.countryContext (countryCode, policy, state). | Keep; document that Place.countryCode (or header) drives policy. |
| **Usage** | Permissions (country/state roles), fundraising, ads, wallet, requireFeature. | Unchanged; document flow: Place or request context → countryCode/stateId → policy → features/rules. |
| **Gap** | None for policy itself. | Only: ensure any new “location” features (e.g. “service area required”) can be gated by CountryPolicy if needed. |

---

## 3. Conceptual Model (WPA)

```
Place (lat, lng; optional address, countryCode, state, city)
  ├── optional AdminUnit refs (country-specific: BD = division/district/upazila/area; Dhaka = cityCorp/area)
  └── used by: Branch address, Org address, FundraisingAccount, picker output

ServiceArea (center = Place; radius_km; optional polygon)
  └── owned by: Branch (delivery/coverage zone)

CountryPolicy / StatePolicy
  └── input: countryCode (and stateCode) from Place or request header; output: features, rules
```

- **Place** = single source of “where” (lat/lng first); AdminUnit is optional labelling per country.
- **ServiceArea** = “where we serve” (branch): radius first, polygon later.
- **CountryPolicy** = “what’s allowed here” (country/state); no schema change, only clear usage of location as input.

---

## 4. What Stays the Same (No Breaking Change)

- BD hierarchy: BdDivision, BdDistrict, BdUpazila, BdArea (and their lat/lng columns).
- Dhaka: CityCorporation, Area.
- Country, State, CountryPolicy, StatePolicy, countryContext, policyEngine.
- addressJson on Organization, Branch: keep; add or merge lat/lng and optional “place” snapshot so existing consumers still see addressJson.
- Geocode/reverse/resolve APIs: keep; extend response with unified “place” shape.
- InventoryLocation: unchanged (branch/warehouse, not geo Place).
- All existing location picker UIs can keep working; new “Place” payload can be added alongside current response shapes.

---

## 5. Summary Table

| WPA concept   | Current alignment | Change direction |
|---------------|-------------------|------------------|
| **Place**     | Partial (lat/lng in some tables; no single type) | Add Place as API/storage notion; ensure branch/org store and return lat/lng; unified place payload. |
| **AdminUnit** | BD + Dhaka exist; Country/State for policy | Keep as is; document as AdminUnit; optional generic layer later. |
| **ServiceArea** | coveragePolygon + lat/lng in schema, not in API | Add coverageRadiusKm; expose lat/lng + radius in API; add “nearby” / “point in area” when needed. |
| **CountryPolicy** | In place | No schema change; document location → policy flow. |

This spec is the design only; implementation and data migration are in [MIGRATION_PLAN.md](./MIGRATION_PLAN.md).
