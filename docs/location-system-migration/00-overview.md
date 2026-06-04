# BPA/WPA Bangladesh Location System Migration Overview

## Goal

Create a single, centralized Bangladesh location master for BPA/WPA that is shared by all business modules and replaces fragmented location usage patterns.

This document set is plan-only and intentionally avoids implementation changes.

## Scope

- **Reference analysis source:** `D:\PraniDoctor\pranidoctor-backend`
- **Target implementation project:** `D:\BPA_Data\backend-api`
- **Primary hierarchy for BPA/WPA:** Division -> District -> Upazila -> Union -> Area/Ward (optional)
- **Modules that must share the same source of truth:**
  - Pet Owner
  - Doctor
  - Clinic
  - Shop
  - Breeder
  - Producer
  - Volunteer
  - Rescue Team
  - Branch
  - Organization

## Deliverables In This Folder

1. `00-overview.md` - overall migration direction
2. `01-current-pranidoctor-analysis.md` - reference architecture and behavior
3. `02-bpa-gap-analysis.md` - target repo current state and gaps
4. `03-database-design.md` - proposed BPA centralized schema and data rules
5. `04-api-design.md` - proposed API surface and compatibility strategy
6. `05-nextjs-integration.md` - web integration plan
7. `06-flutter-integration.md` - mobile integration plan
8. `07-data-migration-plan.md` - rollout and backfill strategy
9. `08-security-and-performance.md` - security, integrity, and scale concerns
10. `09-implementation-checklist.md` - phased execution checklist

## Key Findings That Drive This Plan

- PraniDoctor has strong Bangladesh hierarchy modeling but currently runs two parallel location paradigms:
  - Normalized master (`Division`, `District`, `Upazila`, `Union`, `Village`)
  - Separate `Area` tree used for coverage and filtering
- PraniDoctor does not implement a separate `Thana` model; sub-district is represented as `Upazila`.
- BPA already has substantial Bangladesh data (`bd_divisions`, `bd_districts`, `bd_upazilas`, `bd_areas`) but location usage is fragmented across modules and response shapes.
- BPA currently mixes:
  - Relational FKs in a few places
  - JSON snapshots in many places
  - Parallel Dhaka-specific tree representations

## Migration Principles

1. **One master hierarchy:** all modules use the same Bangladesh master tables.
2. **Union as mandatory operational leaf:** Area/Ward remains optional child level.
3. **Additive migration first:** avoid destructive cutovers early.
4. **Compatibility period:** preserve existing APIs while new APIs are adopted.
5. **Strict hierarchy validation:** prevent invalid parent-child combinations.
6. **Repeatable seeding and verification:** source-controlled seed + integrity checks.

## Recommended End State

- BPA/WPA exposes one canonical location API family for all clients.
- Every supported module stores a consistent location reference contract.
- Dhaka-specific legacy patterns are normalized into the central Bangladesh tree.
- Search, filtering, and assignment logic all resolve from one hierarchy.

## How To Read This Pack

- Start with `01-current-pranidoctor-analysis.md` to understand reference behavior.
- Read `02-bpa-gap-analysis.md` for exact target repo deltas.
- Use `03` to `08` for design and execution details.
- Execute using `09-implementation-checklist.md` as the working runbook.
