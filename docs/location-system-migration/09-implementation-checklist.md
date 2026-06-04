# BPA/WPA Location System Migration Implementation Checklist

This checklist is execution-oriented and mapped to the plan documents in this folder.

## Phase 0 - Analysis and Baseline

- [ ] Confirm business sign-off on target hierarchy: Division -> District -> Upazila -> Union -> Area/Ward(optional).
- [ ] Confirm module scope: Pet Owner, Doctor, Clinic, Shop, Breeder, Producer, Volunteer, Rescue Team, Branch, Organization.
- [ ] Capture baseline counts for existing `bd_*` location tables.
- [ ] Inventory all current location-related endpoints and active clients.
- [ ] Inventory module tables storing location in JSON/partial IDs.
- [ ] Freeze canonical seed source files and naming conventions.

## Phase 1 - Database Foundation

- [ ] Finalize canonical schema for division/district/upazila/union/area.
- [ ] Add missing tables/columns in additive migrations.
- [ ] Add parent FK constraints and required indexes.
- [ ] Add unique constraints for code/slug strategy.
- [ ] Add seed version tracking table/setting key.
- [ ] Prepare integrity verification scripts for post-seed validation.

## Phase 2 - Master Seed Pipeline

- [ ] Implement idempotent seed import for all hierarchy levels.
- [ ] Implement verify step (counts, duplicates, orphans, hierarchy checks).
- [ ] Generate machine-readable and human-readable seed reports.
- [ ] Add operational runbook for import + verify + activate flow.
- [ ] Test repeat seed runs in staging.

## Phase 3 - Shared Service and API Layer

- [ ] Implement canonical API family (`/api/v1/location-master/*`).
- [ ] Standardize response envelope and error contract.
- [ ] Implement shared hierarchy validation service.
- [ ] Add resolve/path endpoint for canonical display text generation.
- [ ] Add compatibility adapters for legacy endpoint families.
- [ ] Add deprecation metadata for legacy APIs.

## Phase 4 - Module Adoption (Backend)

- [ ] Define standardized location DTO for all module writes.
- [ ] Integrate shared validator into owner-related write APIs.
- [ ] Integrate shared validator into doctor/clinic/shop flows.
- [ ] Integrate shared validator into producer/breeder flows.
- [ ] Integrate shared validator into volunteer/rescue flows.
- [ ] Integrate shared validator into organization/branch flows.
- [ ] Integrate campaign/discovery flows into canonical location source.

## Phase 5 - Data Backfill

- [ ] Build backfill job for location columns from existing IDs and `addressJson`.
- [ ] Run dry-run backfill and generate confidence report.
- [ ] Execute high-confidence auto-migrations.
- [ ] Queue low-confidence rows for manual review.
- [ ] Re-run validation until mismatch threshold is acceptable.

## Phase 6 - Next.js Integration

- [ ] Consolidate to one reusable web location picker contract.
- [ ] Switch web calls to canonical location-master endpoints.
- [ ] Update form payloads to standardized location IDs.
- [ ] Add UX for hierarchy mismatch and stale ID recovery.
- [ ] Verify all targeted web modules use same location DTO.

## Phase 7 - Flutter Integration

- [ ] Implement shared Flutter location repository/service.
- [ ] Implement reusable cascading picker component.
- [ ] Add local caching with seed-version refresh behavior.
- [ ] Update all targeted app module forms to standardized IDs.
- [ ] Add robust offline draft and online validation flow.

## Phase 8 - Security and Performance Hardening

- [ ] Enforce RBAC on admin import/verify endpoints.
- [ ] Add rate limits for search and high-frequency location endpoints.
- [ ] Add audit logs for import/verify/activate operations.
- [ ] Add dashboard metrics for latency, mismatch, and integrity status.
- [ ] Complete load tests for list/search/resolve endpoints.

## Phase 9 - Cutover and Decommission

- [ ] Enable strict hierarchy validation in production via feature flag rollout.
- [ ] Confirm client adoption threshold for canonical endpoints.
- [ ] Disable writes to legacy ambiguous location fields.
- [ ] Remove redundant legacy location endpoints.
- [ ] Remove obsolete location schema/components after stable window.
- [ ] Publish final migration completion report.

## Go/No-Go Gate (Before Final Decommission)

- [ ] 100% critical module writes use canonical location IDs.
- [ ] No critical hierarchy mismatches in production logs.
- [ ] Canonical endpoint stability and latency within target.
- [ ] Rollback plan validated and documented.
