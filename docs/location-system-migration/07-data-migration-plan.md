# Data Migration Plan (PraniDoctor-Informed, BPA/WPA Targeted)

## Objective

Migrate BPA/WPA to a centralized Bangladesh location master without breaking existing production flows.

## 1) Migration Approach

Adopt a phased, additive migration with dual-read/dual-write window where needed.

High-level sequence:

1. Audit and baseline
2. Additive schema introduction
3. Master data seeding and verification
4. Backfill business entity location references
5. API/service cutover
6. Client cutover (web/flutter)
7. Legacy decommissioning

## 2) Phase 0 - Audit Baseline

## A. Data inventory

- Count records by each location level.
- Identify null or invalid IDs in module tables.
- Profile JSON-based address payloads and key variants.

## B. API usage inventory

- Identify traffic split across current location-related endpoints.
- Map client versions and endpoint dependencies.

## C. Integrity baseline reports

- orphan checks
- duplicate code/name checks
- hierarchy mismatch checks in existing module records

## 3) Phase 1 - Additive Schema

1. Introduce/normalize canonical tables (`division`, `district`, `upazila`, `union`, optional `area`).
2. Add required indexes and constraints in non-breaking mode.
3. Add missing FK columns to module tables where absent.
4. Keep legacy columns/JSON untouched for compatibility.

## 4) Phase 2 - Seed and Verify Master

1. Load canonical master from controlled source files.
2. Record seed version metadata.
3. Run automated verify script:
   - counts by level
   - parent-child integrity
   - duplicate and slug/code checks
4. Store verification report artifact.

## 5) Phase 3 - Backfill Existing Business Data

## A. Backfill strategy by confidence

- **High confidence:** direct ID mappings from existing columns.
- **Medium confidence:** deterministic name+parent matches.
- **Low confidence:** unresolved rows flagged for manual review.

## B. Data sources

- existing FK-like columns on profile tables
- `addressJson` snapshots on organization/branch-like entities
- campaign and other domain-specific location payloads

## C. Output

- migration table/report with:
  - source record ID
  - derived canonical IDs
  - confidence
  - status (`AUTO_MIGRATED`, `MANUAL_REVIEW_REQUIRED`)

## 6) Phase 4 - Application Cutover

1. Introduce shared location validation service for all write paths.
2. Switch canonical reads to centralized APIs.
3. Enable dual-write:
   - write canonical ID fields
   - continue legacy JSON snapshots temporarily
4. Monitor mismatch logs and error codes.

## 7) Phase 5 - Client Cutover

1. Next.js and Flutter update to standardized location DTO.
2. Move all location fetches to canonical endpoints.
3. Remove screen-level custom mapping logic gradually.
4. Track adoption metrics by endpoint and app version.

## 8) Phase 6 - Legacy Cleanup

1. Retire redundant location endpoints.
2. Freeze and then remove legacy ambiguous structures.
3. Remove no-longer-needed JSON location IDs once all clients migrated.
4. Keep display-only snapshots where useful for auditing, not as source of truth.

## 9) Rollback Strategy

For each phase, maintain rollback boundaries:

- schema additions are backward-compatible
- old endpoints remain available during cutover window
- feature flags control new validation strictness
- import jobs are idempotent and repeatable

If severe production issue occurs:

1. disable strict hierarchy enforcement
2. route reads back to compatibility adapters
3. pause backfill pipeline
4. preserve captured migration state for resume

## 10) Success Criteria

- All supported modules persist canonical location IDs.
- Hierarchy mismatches are blocked at write time.
- One API contract is used by all active clients.
- Legacy location structures are decommissioned safely.
