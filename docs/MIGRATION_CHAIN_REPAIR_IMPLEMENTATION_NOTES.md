# Migration chain repair — implementation notes (2026-04-11)

## 2026-04-11 — delivery-system pass (forward refs + wave2 guards)

| Path | Change |
|------|--------|
| `prisma/migrations/20260404200000_enterprise_allocation_picking_enhancement/migration.sql` | **No-op** `SELECT 1` — substantive DDL moved to `20260429120500` (ran after `allocation_plans` exist). |
| `prisma/migrations/20260408140000_procurement_demand_lines_central_fulfillment/migration.sql` | **No-op** — same. |
| `prisma/migrations/20260409180000_stock_transfer_enterprise_superseded_allocation_trigger/migration.sql` | **No-op** — same. |
| `prisma/migrations/20260429120500_enterprise_allocation_post_foundation/migration.sql` | **New** — idempotent consolidated DDL: `AllocationPlanStatus` extra values, plan/line columns, `allocation_plan_events`, procurement enums + `procurement_demand_lines` + `backorderStatus`, `enterpriseSupersededAt` + trigger; **§D** deferred wave2 FKs (`purchase_orders`↔`purchase_requisitions`, `vendors`↔`warehouses`, inbound/putaway). |
| `prisma/migrations/20260402140000_wave2_procurement_inbound_putaway/migration.sql` | Conditional `ALTER` when `purchase_orders`, `purchase_order_lines`, `warehouses`, `warehouse_bins` exist; deferred FKs if targets missing. |
| `prisma/migrations/20260408180000_member_role_branch_invite_rbac/migration.sql` | Per-value `duplicate_object` guards. |

### Session 2 — shadow replay completion

`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma` **succeeds** on shadow DB (2026-04-11).

| Path | Change |
|------|--------|
| `20260402160000_warehouse_access_backfill/migration.sql` | Sections 2–3 guarded until `warehouses`, `warehouse_staff_assignments`, `WarehouseStaffRole`, `warehouses.branchId` exist |
| `20260503000000_deferred_warehouse_branch_staff_backfill/migration.sql` | **New** — `warehouses.branchId` + FK + index; idempotent warehouse staff INSERTs |
| `20260402180000_warehouse_enterprise_hardening_indexes/migration.sql` | Guard early indexes; composites at end of `20260428150000` |
| `20260403140000_enterprise_grn_po_line_barcode_void/migration.sql` | Guard `warehouses`; defer `grn_lines`→`purchase_order_lines` FK + index to `20260429120000` |
| `20260403163736_stock_request_procurement_intent/migration.sql` | Defer `stock_requests`→`purchase_orders` FK to `20260429120000` |
| `20260405120000_controlled_receive_sessions/migration.sql` | Backfill without `grns.purchaseOrderId`; PO-only vendor session backfill in `20260429120000` |
| `20260428150000_central_warehouse_foundation/migration.sql` | Appends composite indexes deferred from `02180000` |
| `20260429120000_warehouse_enterprise_po_allocation_pick_pod/migration.sql` | Appends deferred FKs, `grn_lines` index, `stock_requests` FK, vendor session backfill |

---

## Files changed (earlier 2026-04-11 batch)

| Path | Change |
|------|--------|
| `prisma/migrations/20260401143000_staff_invites_warehouse_target/migration.sql` | Prepend idempotent `CREATE TYPE "WarehouseStaffRole" ...` (matches foundation labels). Gate `staff_invites` → `warehouses` FK on `warehouses` existing. |
| `prisma/migrations/20260411180000_multi_warehouse_fulfillment_system/migration.sql` | Replaced with no-op `SELECT 1` + comment (DDL moved to `20260429130000`). |
| `prisma/migrations/20260428150100_staff_invites_warehouse_id_fkey_deferred/migration.sql` | **New** — adds `staff_invites_warehouseId_fkey` if missing after warehouses exist. |
| `prisma/migrations/20260429130000_multi_warehouse_fulfillment_system/migration.sql` | **New** — enums `AllocationScope`, `AllocationSourceStatus`, `BackorderStatus`; `AllocationPlanStatus` values; `allocation_plans.allocationScope`, `sourceCount`, `parentPlanId` + self-FK; `allocation_plan_lines.sourceWarehouseId`; `allocation_source_summaries`; `backorders` (camelCase columns per `schema.prisma`). |
| `prisma/migrations/20260402140000_warehouse_phase1_rack_bin_transfer_line/migration.sql` | Removed `warehouse_racks_zoneId_fkey` (deferred). |
| `prisma/migrations/20260430140100_warehouse_racks_zone_id_fkey_deferred/migration.sql` | **New** — add `warehouse_racks_zoneId_fkey` after `warehouse_zones` exists. |

## Commands run (verification)

From repository root `D:\BPA_Data\backend-api` (PowerShell):

```powershell
Set-Location D:\BPA_Data\backend-api
npx prisma validate
```

**Result:** `The schema at prisma\schema.prisma is valid`

```powershell
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script
```

**Result (after rack/zone repair):** `P3006` — migration `20260402140000_wave2_procurement_inbound_putaway` failed on shadow DB: underlying table `purchase_orders` does not exist (created in `20260429120000`). Full migration-folder vs shadow replay still has additional ordering issues beyond this task’s scope.

```powershell
npx prisma generate
```

**Result:** `Generated Prisma Client (v7.6.0)` (success).

```powershell
node scripts/check-migration-integrity.js
```

**Expected:** Requires `DATABASE_URL` in `.env`. Run against each environment after `migrate deploy`; use `--fix` only under governance if checksums must be updated after intentional migration edits.

## `migrate deploy` (apply migrations)

On each target database (no reset):

```powershell
npx prisma migrate deploy
```

Then:

```powershell
node scripts/check-migration-integrity.js
```

## Remaining risks

1. **Checksum drift**: Any environment that already applied **old** contents of `20260401143000` or `20260411180000` will show checksum mismatch until reconciled (`--fix` or restore files per policy).
2. **Partial manual applies**: If someone applied a **partial** or **edited** copy of `20260411180000` with snake_case columns, the new `20260429130000` adds **camelCase** columns; you may need a one-off SQL rename/drop of wrong columns — not automated here.
3. **Shadow replay** — **resolved** for `migrate diff` as of 2026-04-11 (see session 2 table above). Re-run after any new migration edits.
4. **PostgreSQL version**: `ADD VALUE IF NOT EXISTS` for enums was avoided in `20260429130000`; enum extensions use `pg_enum` checks for broader PG compatibility.

---

Updated: `/docs/MIGRATION_CHAIN_REPAIR_IMPLEMENTATION_NOTES.md`
