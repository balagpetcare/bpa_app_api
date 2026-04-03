# Warehouse Prisma column drift: `poOverReceiptTolerancePercent` (P2022)

## Symptom

- **Prisma error P2022** on `db.warehouse.findUnique()` in `warehouse.service.ts` (`getWarehouseById`, legacy `Warehouse` fallback path).
- Message: `The column warehouses.poOverReceiptTolerancePercent does not exist in the current database.`

## Audit summary

| Area | Finding |
|------|---------|
| **Prisma schema** | `Warehouse.poOverReceiptTolerancePercent` is defined (`Decimal?`, `DECIMAL(5,2)`). Intended for GRN over-receipt tolerance vs PO line qty. |
| **Migrations** | `20260403140000_enterprise_grn_po_line_barcode_void/migration.sql` includes `ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "poOverReceiptTolerancePercent" DECIMAL(5,2);` |
| **warehouse.service.ts** | Legacy fallback uses `findUnique` with `include`; Prisma loads **all** scalar columns on `Warehouse`, so any missing DB column causes P2022. Branch-backed path uses `branch` only and does not hit `warehouses` table. |
| **warehouse.controller.ts** | Passes through `getWarehouseById` result; no extra field mapping. |
| **GRN** | `grn.service.ts` selects `poOverReceiptTolerancePercent` for validation. Field is **product-intended**, not dead. |
| **Frontend** | No direct reference to `poOverReceiptTolerancePercent` in `bpa_web`; warehouse detail uses `/api/v1/warehouse/:id`. |

## Root cause

**Schema ↔ database drift**, not bad application logic:

1. The Prisma client was generated from a schema that includes `poOverReceiptTolerancePercent`.
2. The **target database** does not have that column—typically because **pending migrations were not applied** (`prisma migrate deploy` not run on that environment), or the DB was restored / diverged from migration history without the column.

**Not** the cause: removing the field from Prisma to “match” an old DB—that would break GRN over-receipt behavior and hide the real problem.

## Enterprise-safe fix

1. **Align the database** with the schema by applying migrations:
   - `20260403140000` adds the column (among other GRN changes).
   - `20260502000000_ensure_warehouses_po_over_receipt_tolerance_column` is an **idempotent** follow-up that only runs `ADD COLUMN IF NOT EXISTS` for `poOverReceiptTolerancePercent` on `warehouses`. It repairs drift if the column is missing while later migrations are already recorded (e.g. manual DB restore, partial apply edge cases). It is a no-op if the column already exists.

2. **Do not** strip the field from Prisma or replace `findUnique` with a broad try/catch—those approaches either regress features or mask schema problems.

3. **Backward compatibility**: Legacy `Warehouse` rows remain valid; nullable column defaults to NULL (unlimited over-receipt per product rules in `grn.service.ts`).

## Branch-backed warehouse convergence

- Primary resolution path resolves **branch** (`WAREHOUSE_DC`) first; only when no branch matches does code hit the legacy `Warehouse` table.
- Fixing `warehouses` DDL does not change branch semantics; it only prevents legacy reads from crashing.

## Local commands (after pulling this branch)

From `backend-api` root, with `DATABASE_URL` pointing at the target database:

```bash
npx prisma generate
npx prisma migrate deploy
node scripts/check-migration-integrity.js
```

- **`prisma generate`**: Required after schema/migration changes if the client is stale.
- **`migrate deploy`**: Applies pending migrations (including the ensure migration). Use in all non-dev shared/staging/prod environments per your runbook.
- **`migrate dev`**: Only for local development databases when **creating** new migrations; not required merely to apply existing migrations.

## Migration impact

- **Additive only**: adds nullable `poOverReceiptTolerancePercent` if missing. No data loss, no destructive DDL in this repair migration.
- **GRN**: After deploy, GRN validation can read warehouse tolerance from DB as designed.

## Rollback note

- **Do not** drop the column in production to “rollback” without a coordinated schema change and GRN behavior review; dropping would reintroduce P2022 for Prisma reads and break tolerance logic.
- If a migration must be reverted in an emergency, follow `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md` and treat column removal as a separate, reviewed migration.

## Verification checklist

- [ ] `migrate deploy` succeeds on the failing database.
- [ ] `SELECT "poOverReceiptTolerancePercent" FROM warehouses LIMIT 1;` runs without “column does not exist”.
- [ ] `GET /api/v1/warehouse/:id` for an id that only exists as legacy `Warehouse` (if any) returns 200.
- [ ] Branch-backed warehouse ids still resolve via branch path first.

## Cursor Composer fix command (paste as task prompt)

```
Fix P2022 on Warehouse: column poOverReceiptTolerancePercent missing.

1. Read docs/WAREHOUSE_PRISMA_COLUMN_DRIFT_FIX_PLAN.md in backend-api.
2. Root cause: DB behind Prisma schema; apply migrations—do not remove the field from schema.
3. Ensure migration 20260502000000_ensure_warehouses_po_over_receipt_tolerance_column exists and is deployed.
4. Run: npx prisma generate && npx prisma migrate deploy && node scripts/check-migration-integrity.js
5. Verify GET /api/v1/warehouse/:id and legacy warehouse fallback.
```
