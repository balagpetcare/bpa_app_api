# Migration chain repair — multi-warehouse fulfillment (2026-04-11)

## Executive summary

Shadow-database replay (`prisma migrate diff --from-migrations`, `migrate dev`) failed because several migrations referenced **objects that did not exist yet** at their timestamp position in the folder-sorted chain. The first surfaced error was:

`type "WarehouseStaffRole" does not exist` in `20260401143000_staff_invites_warehouse_target`.

Additional ordering problems were found for **staff_invites → warehouses**, **multi-warehouse allocation DDL vs allocation_plans / warehouses**, and (still outstanding for a fully clean shadow replay) **warehouse_racks → warehouse_zones**.

This document records root causes and the **non-destructive** repair approach (no `db push`, no `migrate reset` on production-like data).

---

## Root causes (exact)

### A. `WarehouseStaffRole` before creation

| Event | Detail |
|--------|--------|
| **Where created** | `20260428150000_central_warehouse_foundation/migration.sql` (`CREATE TYPE "WarehouseStaffRole" ...` with idempotent `duplicate_object` guard). |
| **Where used too early** | `20260401143000_staff_invites_warehouse_target/migration.sql` adds column `"warehouseRole" "WarehouseStaffRole"`. |
| **Why shadow DB fails** | Migrations apply in **lexicographic order** on folder names. `20260401...` runs before `20260428...`, so the enum does not exist when the April 1 migration runs. |

### B. `staff_invites.warehouseId` → `warehouses` before `warehouses` exists

The same April 1 migration adds `FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id")`, but `warehouses` is first created in `20260428150000`. Replay fails when it reaches the FK unless the FK is deferred.

### C. Multi-warehouse fulfillment migration timestamp vs `allocation_plans` / column names

| Issue | Detail |
|--------|--------|
| **Order** | `20260411180000_multi_warehouse_fulfillment_system` ran **before** `allocation_plans` is created in `20260429120000_warehouse_enterprise_po_allocation_pick_pod`. |
| **Order** | The same migration adds FKs to `warehouses` before `20260428150000` on a fresh replay. |
| **Naming** | The SQL used **snake_case** (`allocation_scope`, `source_warehouse_id`, …) while `schema.prisma` maps fields to **camelCase** PostgreSQL identifiers (`allocationScope`, `sourceWarehouseId`, …). |

### D. `warehouse_racks` → `warehouse_zones` before `warehouse_zones` exists (repaired)

`20260402140000_warehouse_phase1_rack_bin_transfer_line` added `warehouse_racks_zoneId_fkey` to `warehouse_zones`, but `warehouse_zones` is first created in `20260430140000_warehouse_phase4_qc_zones_audit`.

**Repair:** Remove the FK from `20260402140000` (keep `zoneId` column) and add `20260430140100_warehouse_racks_zone_id_fkey_deferred` immediately after phase 4 so the FK is applied when both tables exist.

### E. Further chain debt (still breaks full shadow replay)

Other migrations reference tables created much later (example: `20260402140000_wave2_procurement_inbound_putaway` vs `purchase_orders` created in `20260429120000`). Resolving **fully** clean `migrate diff --from-migrations` requires auditing each P3006 in order. This batch focused on the multi-warehouse / staff-invite / allocation DDL blockers above.

---

## Repair strategy (safe, additive)

1. **`20260401143000`**: Idempotently create `WarehouseStaffRole` before use (same labels as foundation). Make `staff_invites` → `warehouses` FK conditional on `warehouses` existing.
2. **`20260428150100` (new)**: After `central_warehouse_foundation`, add the deferred `staff_invites_warehouseId_fkey` if still missing.
3. **`20260411180000`**: Replace substantive DDL with a **no-op** (`SELECT 1`) so the timestamp remains in history without referencing missing tables.
4. **`20260429130000` (new)**: Apply the full multi-warehouse DDL **after** `allocation_plans` and `warehouses` exist, with **camelCase** columns aligned to Prisma and idempotent `CREATE TYPE` / `IF NOT EXISTS` where appropriate.

---

## Checksums and production-like databases

Per `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`, editing migration files changes SHA-256 checksums in `_prisma_migrations` for any migration **already applied**. After deploying these file changes:

- Run `node scripts/check-migration-integrity.js`.
- If drift is reported for modified folders, reconcile per policy (restore files **or** governed `--fix` on a known-good database — see `scripts/check-migration-integrity.js`).

---

## Related documents

- `docs/MIGRATION_CHAIN_REPAIR_IMPLEMENTATION_NOTES.md` — file-level changes and commands.
- `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`
- `docs/non_destructive_prisma_drift_recovery_plan.md`

---

Updated: `/docs/MIGRATION_CHAIN_REPAIR_PLAN_MULTI_WAREHOUSE.md`
