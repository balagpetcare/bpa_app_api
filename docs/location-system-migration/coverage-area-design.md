# Phase 6 — Coverage Area Design (Future-Ready)

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Implementation status:** Schema + API stubs exist; **no business logic rollout** in this phase.

---

## 1. Problem statement

Multiple actor types need to declare **where they operate**, not only **where they are registered**:

- Doctors (service coverage)
- Clinics / branches
- Volunteers & rescue teams
- Vaccination campaign teams
- Shops (delivery radius / service upazilas)
- Breeders (listing geography)

A single address on the entity row is insufficient for multi-area coverage.

---

## 2. Existing foundation (already migrated)

### Table: `location_coverage_assignments`

| Column | Purpose |
|--------|---------|
| `entityType` | `LocationCoverageEntityType` enum |
| `entityId` | PK of target entity |
| `divisionId` … `areaId` | Nullable hierarchy leaf (at least one required per row) |
| `isActive` | Soft enable |
| `priority` | Ordering for overlap resolution |
| `metadata` | JSON extensions (radius km, notes, effective dates) |

**Unique constraint:** `(entityType, entityId, divisionId, districtId, upazilaId, unionId, areaId)` — prevents duplicate identical coverage rows.

### API (implemented, permission-gated)

```
GET  /api/v1/location-master/coverage/:entityType/:entityId
PUT  /api/v1/location-master/coverage/:entityType/:entityId
```

**Service:** `location.service.replaceCoverage` / `listCoverage` with `validateSelection` per row.

---

## 3. Entity type mapping

| Business concept | `entityType` | `entityId` references |
|------------------|--------------|------------------------|
| Doctor coverage | `DOCTOR` | `doctor_verifications.id` or `users.id` (TBD — recommend userId for stability) |
| Clinic coverage | `CLINIC` | `branches.id` where clinic capability |
| Shop delivery | `SHOP` | `branches.id` where retail/shop capability |
| Branch operations | `BRANCH` | `branches.id` |
| Organization HQ region | `ORGANIZATION` | `organizations.id` |
| Producer territory | `PRODUCER` | `producer_orgs.id` |
| Breeder listings | `BREEDER` | Breeder profile id (when model exists) or user id |
| Volunteer | `VOLUNTEER` | `fundraising_accounts.id` or volunteer profile id |
| Rescue team | `RESCUE_TEAM` | Fundraising/org-linked id |
| Pet owner | `USER` | `users.id` |
| Staff | `STAFF` | `branch_members.id` or `users.id` |

**Decision needed before implementation:** canonical `entityId` for doctor/volunteer (user vs domain table).

---

## 4. Coverage granularity rules

| Granularity | Use case | Example |
|-------------|----------|---------|
| Division-only | National partners | Producer HQ — “all Dhaka division” |
| District | District hospital network | Clinic chain in 3 districts |
| Upazila | Field vet route | Doctor serves 5 upazilas |
| Union | Hyper-local volunteer | Rescue pickup union list |
| Area / ward | Urban micro-coverage | Dhaka ward-level shop delivery |

**Validation:** Reuse `validateSelection`; allow partial selection (division-only row) if business rules permit — document per entity type.

---

## 5. Proposed domain behaviors (not implemented)

### 5.1 Doctor coverage

- **Trigger:** Doctor onboarding complete + admin approval.
- **Default:** One row at registration `upazilaId` (home base).
- **Extended:** Doctor adds additional upazilas/unions via profile settings.
- **Query:** Find doctors serving union X → `location_coverage_assignments` where `entityType=DOCTOR` and hierarchy match.

### 5.2 Clinic coverage

- **Primary site:** `branches` address + relational IDs (already in onboarding).
- **Coverage:** Optional secondary unions for mobile clinic / outreach.
- **Link:** `CLINIC` rows reference same `branchId`.

### 5.3 Volunteer / rescue coverage

- Align with `fundraising_accounts` service area.
- Migrate fundraising “area of work” string → coverage rows on approval.

### 5.4 Vaccination campaign coverage

- **Phase 1:** Continue `campaign_rollout_regions` for scheduled venues.
- **Phase 2:** Mirror rollout region into `location_coverage_assignments` with `entityType` = custom campaign volunteer role OR link `campaignId` in `metadata`.
- **Avoid duplication:** Single write path from campaign admin UI → rollout table + coverage table in one transaction (future).

### 5.5 Shop delivery coverage

- `SHOP` coverage rows at upazila or union level.
- `metadata.deliveryModes`: `PICKUP`, `DELIVERY`.
- Order routing: match buyer union to shop coverage rows.

### 5.6 Breeder coverage

- When breeder profile model exists, attach `BREEDER` coverage at union level for marketplace search filters.

---

## 6. Resolution & overlap algorithm (design)

When multiple rows match a target location:

1. Filter `isActive = true`.
2. Sort by `priority` DESC, then specificity (area > union > upazila > district > division).
3. First match wins unless product requires union of all matches.

Store algorithm in shared `location.coverageResolver` (future module).

---

## 7. Indexing & performance

Existing indexes:

- `(entityType, entityId, isActive)` — lookup by entity
- Per-level indexes on `divisionId` … `areaId`

**Future:** composite partial indexes per hot query, e.g. `(entityType, upazilaId)` WHERE `isActive`.

---

## 8. Security

- Permissions already defined: `LOCATION_PERMISSIONS.COVERAGE_READ`, `COVERAGE_MANAGE`.
- Enforce entity ownership (doctor can only edit own coverage; org owner edits branch coverage).

---

## 9. Migration path from today

| Step | Action |
|------|--------|
| 1 | Complete union seed + entity backfill (Phases 3–4) |
| 2 | Product spec per entity type (required vs optional coverage) |
| 3 | Implement `coverageResolver` + module hooks |
| 4 | UI: coverage manager component (web/flutter) |
| 5 | Deprecate ad-hoc JSON “service areas” in favor of assignments |

---

## 10. Out of scope (this phase)

- Implementing resolver in order/dispatch/campaign services
- Geospatial radius (circle) — use `metadata.radiusKm` later with PostGIS if needed
- Deleting legacy JSON service-area fields

---

## 11. ASCII reference

```
Organization
    └── Branch (clinic | shop)
            ├── address: divisionId…areaId  (registered address)
            └── coverage[]: location_coverage_assignments
                    ├── DOCTOR / userId → unions [U1, U2]
                    ├── CLINIC / branchId → upazilas [Z1, Z2]
                    └── SHOP / branchId → upazilas [Z3] + metadata.delivery
```
