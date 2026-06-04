# Bangladesh Location Migration Report

## Migration Safety Model

The migration is designed to be non-destructive and resumable:

- Additive schema changes only
- Legacy fields/tables kept intact
- Centralized columns backfilled from existing data
- Validation-based normalization before writing
- Scripted report generation for auditability

## Execution Order

Run in this order:

1. `npm run seed:location-master`
2. `npm run verify:location-master`
3. `npm run migrate:location-references`
4. `npm run verify:location-master`
5. `npx ts-node scripts/location-audit-counts.ts`

## Output Artifacts

Reports are written under `docs/location-system-migration/`:

- `verification-report.json`
- `data-migration-report.json`

These files contain record counts, integrity checks, and module-level backfill outcomes.

## Backfill Coverage

Backfill currently covers:

- Owner profiles
- Organizations
- Branches
- Doctor verification profiles
- Producer organizations
- Producer factories

Backfill source precedence:

1. Existing explicit location columns (if present)
2. Legacy JSON location fields
3. Derived union from area when possible
4. Hierarchy normalization via centralized validator

## Rollback Guidance

If issues are found post-migration:

1. Keep old read paths enabled (`/api/v1/locations/*` remains active)
2. Stop new backfill runs
3. Re-run verification to isolate broken rows
4. Patch invalid source rows and rerun migration script

Since migration is additive and idempotent, rollback is operationally done by routing and write controls rather than dropping data.

## Current Constraints

- The repository currently has no dedicated Swagger/OpenAPI wiring; API behavior is documented in migration docs and implemented routes/controllers.
- Some legacy modules still depend on JSON snapshots; centralized columns are now available and backfilled to support gradual cutover.

## Completion Criteria

Migration is considered complete when:

- Canonical location columns are populated for active records in covered modules
- Integrity checks report no critical hierarchy mismatches
- New writes pass centralized validation
- Clients consume canonical hierarchy endpoints consistently
