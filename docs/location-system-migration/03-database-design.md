# BPA/WPA Centralized Location Database Design

## Design Objective

Define one authoritative Bangladesh location master that all modules consume with strict hierarchy integrity.

Target hierarchy:

Division -> District -> Upazila -> Union -> Area/Ward (optional)

## 1) Recommended Schema Strategy

Use a normalized hierarchical model with explicit tables per level and optional leaf extension.

## A. Master tables

1. `bd_divisions`
2. `bd_districts` (`division_id` FK)
3. `bd_upazilas` (`district_id` FK)
4. `bd_unions` (`upazila_id` FK)
5. `bd_areas` (`union_id` FK, optional usage, `area_type` = `WARD` or `AREA`)

Notes:

- `bd_areas` in current BPA should be migrated to explicit union/area semantics.
- If minimizing disruption, keep table name `bd_areas` during transition but split semantics via migration and constraints.

## B. Common columns (all master levels)

- `id` (PK)
- `code` (official/admin code; scoped uniqueness by parent where required)
- `name_en`
- `name_bn`
- `slug` (globally unique)
- `is_active`
- `is_verified`
- `latitude` (optional)
- `longitude` (optional)
- `sort_order`
- `created_at`
- `updated_at`

## C. Constraints and indexes

- Parent FK constraints for full hierarchy.
- Parent-scoped unique code constraints (trim-safe).
- Composite indexes on `(parent_id, name_en)` and `(parent_id, name_bn)`.
- Search index support for `name_en`, `name_bn`, `slug`, `code`.
- Optional geospatial index strategy for leaf coordinates if needed by nearby queries.

## 2) Standard Module Location Contract

Every business entity should resolve to one canonical location reference pattern.

## A. Required columns for module entities

- `division_id` (required or derived)
- `district_id` (required or derived)
- `upazila_id` (required or derived)
- `union_id` (required operational leaf)
- `area_id` (optional)

## B. Optional denormalized snapshot

To stabilize reads and reduce joins for some endpoints:

- `location_path_bn`
- `location_path_en`
- `location_code_path`

These are derived/cache fields and must never replace FK truth.

## C. Relationship enforcement

Application-level validator must enforce:

- district belongs to division
- upazila belongs to district
- union belongs to upazila
- area belongs to union

Optional DB triggers/check procedures can reinforce this in high-risk write paths.

## 3) Module Mapping Plan

## A. Core actors

- Pet Owner
- Doctor
- Volunteer
- Rescue Team
- Breeder
- Producer

Each actor profile should carry standardized location FK set.

## B. Business units

- Organization
- Branch
- Clinic
- Shop

Each should use the same standardized FK set and optional area leaf.

## C. Campaign/domain-specific records

Any campaign/discovery/rollout tables that currently store partial hierarchy should align with the same contract.

## 4) Legacy Data Compatibility

## A. Existing BPA structures

- Keep existing `BdDivision`, `BdDistrict`, `BdUpazila` data and IDs where possible.
- Transform current `BdArea` into:
  - union records in `bd_unions`
  - optional area/ward records in `bd_areas` (new meaning)

## B. Dhaka model consolidation

Current dual-tree patterns (`CityCorporation` + `Area`, and `BdArea` typed variants) should converge into central hierarchy:

- city corporation concepts represented through standard administrative levels and optional area metadata, not a parallel master.

## 5) Seed and Versioning Design

## A. Seed source

- Source-controlled Bangladesh master data files (JSON/CSV)
- Repeatable idempotent upsert strategy

## B. Seed version tracking

- Store applied seed version in settings/meta table
- Expose via API for client sync awareness

## C. Verification

Automated checks after each import:

- expected count by level
- orphan checks
- duplicate code/name checks per parent
- coordinate validity checks

## 6) Proposed Migration Sequence (DB Perspective)

1. Additive schema introduction (`bd_unions`, revised `bd_areas` semantics, new indexes).
2. Data backfill from current `BdArea` and Dhaka structures.
3. Add module FK columns where missing.
4. Populate FK columns from JSON and legacy IDs.
5. Enable stricter validation and constraints.
6. Decommission ambiguous legacy structures once all reads/writes use canonical model.
