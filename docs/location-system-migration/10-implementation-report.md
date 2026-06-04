# Bangladesh Location System Implementation Report

## Scope Implemented

The backend implementation has been completed in additive mode for all requested phases:

1. Centralized location module foundation
2. Seeder + verification tooling
3. Location APIs with search/pagination/caching
4. Cross-module location reference integration (non-destructive)
5. Coverage assignments on centralized tables
6. Safe data migration/backfill scripts
7. Documentation and operational runbook updates

## Key Backend Changes

### 1) Centralized Module

Created and wired `src/modules/location`:

- `location.controller.ts`
- `location.routes.ts`
- `location.service.ts`
- `location.repository.ts`
- `location.validators.ts`
- `location.dto.ts`
- `location.cache.ts`
- `location.permissions.ts`
- `location.types.ts`

Mounted at:

- `/api/v1/location-master/*`

### 2) Schema (Additive)

Updated `prisma/schema.prisma` with:

- New table: `BdUnion` (`bd_unions`)
- Extended `BdArea` with `unionId`
- New coverage table: `LocationCoverageAssignment` (`location_coverage_assignments`)
- New enum: `LocationCoverageEntityType`
- New location reference columns for:
  - `UserProfile`
  - `OwnerProfile`
  - `Organization`
  - `Branch`
  - `DoctorVerification`
  - `StaffInvite`
  - `ProducerOrg`
  - `ProducerFactory`

Added migration SQL:

- `prisma/migrations/20260603031500_centralized_location_system/migration.sql`

### 3) API Endpoints

Implemented/updated:

- `/api/v1/locations/divisions`
- `/api/v1/locations/districts`
- `/api/v1/locations/upazilas`
- `/api/v1/locations/unions`
- `/api/v1/locations/search`
- `/api/v1/locations/validate-selection`
- `/api/v1/locations/coverage/:entityType/:entityId` (GET/PUT)

Canonical module endpoints:

- `/api/v1/location-master/divisions`
- `/api/v1/location-master/districts`
- `/api/v1/location-master/upazilas`
- `/api/v1/location-master/unions`
- `/api/v1/location-master/areas`
- `/api/v1/location-master/search`
- `/api/v1/location-master/validate-selection`
- `/api/v1/location-master/coverage/:entityType/:entityId` (GET/PUT)

Backward compatibility retained for existing Dhaka and legacy location flows.

### 4) Seeder + Verification

Updated:

- `prisma/seeders/seedBaseBdLocations.ts` (now seeds canonical unions when model available)

Added scripts:

- `scripts/seed-location-master.ts`
- `scripts/verify-location-master.ts`

Added package commands:

- `npm run seed:location-master`
- `npm run verify:location-master`

### 5) Data Migration

Added safe backfill script:

- `scripts/migrate-location-references.ts`

Command:

- `npm run migrate:location-references`

This script:

- Reads existing location signals from legacy columns/JSON
- Validates and normalizes hierarchy
- Backfills centralized reference columns
- Never deletes legacy data
- Writes migration report artifact

### 6) Integrations

Integrated centralized location validation and normalization into key write paths:

- Owner profile upsert
- Owner organization create/update
- Owner branch create/update
- Partner onboarding organization/branch create/update
- Doctor verification draft upsert
- Producer KYC submission
- Producer factory creation

### 7) Permissions

Added location permissions in role/permission seed logic:

- `location.master.read`
- `location.master.manage`
- `location.coverage.read`
- `location.coverage.manage`
- `location.migration.manage`

## Notes on Swagger

No explicit Swagger/OpenAPI generation pipeline was detected in this repository at implementation time.

To keep delivery unblocked, endpoint contracts were implemented directly in controllers/routes and documented here.  
If Swagger is later enabled, the above endpoint set can be mapped 1:1 into the OpenAPI spec.
