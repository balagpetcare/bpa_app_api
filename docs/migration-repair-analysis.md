# Migration repair analysis: warehouse / allocation / picking chain

**Date:** 2026-05-15  
**Project:** BPA_Data backend-api (Prisma / PostgreSQL)  
**Incident:** `prisma migrate deploy` fails at `20260411191500_pick_lists_allow_multiple_per_allocation_plan` with `ERROR: relation "pick_lists" does not exist`.

---

## 1. Executive summary

| Item | Finding |
|------|---------|
| **Root cause** | Migration **ordering** (lexicographic by folder name), not a missing table migration. DDL for `pick_lists` lives in **`20260429120000_warehouse_enterprise_po_allocation_pick_pod`**, which runs **after** **`20260411191500_...`** in the canonical chain. |
| **Companion bug** | **`20260411200000_backorder_status_linked`** runs before `allocation_plans` / `BackorderStatus` exist and would fail immediately after fixing the pick_lists migration unless addressed. |
| **Model rename?** | No. `PickList` maps to `pick_lists` (`schema.prisma`); no alternate table name. |
| **Primary fix** | Move substantive DDL **into migrations that execute after creators** (`20260429120000`, `20260429130000`); retain early migration folders as **historical placeholders** (`SELECT 1`) per existing repo pattern (`20260404200000`, `20260408140000`). |

---

## 2. How Prisma orders migrations

Folders under `prisma/migrations/` are applied in **full directory name lexical sort** (`migration_lock.toml` provider = `postgresql`). The timestamp prefix determines order globally.

Therefore:

- `20260411191500_*` runs **before** `20260428150000_*` and **before** `20260429120000_*`.

Any migration dated `20260411*` that ALTERs tables created only in `202604291*` is **ordering-inconsistent**.

---

## 3. Dependency graph (warehouse / allocation / pick / fulfillment)

Simplified causal order (later steps depend on earlier):

```
… → stock_dispatches, stock_requests, inventory_locations (pre-April enterprise)
→ 20260428150000_central_warehouse_foundation          (warehouses, …)
→ 20260429120000_warehouse_enterprise_po_allocation_pick_pod
      creates: medicine_requisitions, purchase_orders*, allocation_plans*, pick_lists*,
               pick_list_lines*, proof_of_deliveries*, grns.purchaseOrderId, …
→ 20260429120500_enterprise_allocation_post_foundation (allocation_plans columns, triggers, procurement_demand_lines, …)
→ 20260429130000_multi_warehouse_fulfillment_system
      adds: AllocationScope types, allocation_plans.parentPlanId*, backorders, …
→ 20260429140000_* … subsequent warehouse modules
```

\* Objects **required** before `20260411200000`'s partial unique index (`parentPlanId`).

---

## 4. File-level findings

### 4.1 `pick_lists` creation

| File | Role |
|------|------|
| `prisma/migrations/20260429120000_warehouse_enterprise_po_allocation_pick_pod/migration.sql` | **Authoritative DDL** creating `pick_lists`, unique on `stockDispatchId`, indexes. |
| `prisma/schema.prisma` (`model PickList`) | `allocationPlanId` is **indexed, not `@unique`**; `stockDispatchId` is **`@unique`**. |

Original bug: **`20260429120000`** used `CREATE UNIQUE INDEX "pick_lists_allocationPlanId_key"` while the Prisma model allows multiple pick lists per plan (multi-wave dispatch).

### 4.2 Premature migrations (April 11)

| Migration | Issue |
|-----------|--------|
| `20260411180000_multi_warehouse_fulfillment_system` | Already a **placeholder** (fixed earlier). |
| `20260411191500_pick_lists_allow_multiple_per_allocation_plan` | References `pick_lists` **before** `20260429120000`. |
| `20260411200000_backorder_status_linked` | Uses `BackorderStatus` and `allocation_plans` before **`20260429130000`** / **`20260429120000`** respectively. |

### 4.3 Related consolidated patterns (reference)

Migrations such as `20260404200000_enterprise_allocation_picking_enhancement` and `20260408140000_procurement_demand_lines_central_fulfillment` were already turned into no-ops with DDL moved to `20260429120500`. This repair **extends the same governance pattern** to the April 11 pair.

### 4.4 Duplicate timestamp prefixes

Multiple folders share the same date prefix (e.g. several `20260402120000_*`). Prisma disambiguates by **full folder name** (second part sorts alphabetically). This is **not** the failure mode here but explains non-obvious ordering; worth noting for reviews.

---

## 5. Root cause statement (exact)

Deploy failed because **`20260411191500_pick_lists_allow_multiple_per_allocation_plan/migration.sql`** executes **`CREATE INDEX` / `DROP INDEX` on `"pick_lists"`** at a position in the chain **before** **`20260429120000_warehouse_enterprise_po_allocation_pick_pod`** creates **`public.pick_lists`**. The migration SQL is valid for a DB that already has the table; the **applied order** is invalid.

---

## 6. Recommended fix (additive / governance-safe)

1. **`20260429120000`**  
   Replace `pick_lists_allocationPlanId_key` (**unique**) with **`pick_lists_allocationPlanId_idx`** (**non-unique**) to match **`schema.prisma`** and intended multi-wave behavior.

2. **`20260429130000`**  
   - Ensure **`BackorderStatus`** includes **`LINKED`** (extend `CREATE TYPE` + guarded `ALTER TYPE ADD VALUE` for databases that created the enum without **`LINKED`**).  
   - After **`parentPlanId`** exists on **`allocation_plans`**, apply the **partial unique index** from **`20260411200000`** (drop blanket **`allocation_plans_stockRequestId_key`**, create **`allocation_plans_one_primary_stock_request_uidx`**).

3. **`20260411191500`** / **`20260411200000`**  
   Replace body with **`SELECT 1;`** plus comments pointing to consolidating migrations (**preserve migration directory names** and `_prisma_migrations` history).

No **`prisma db push`** required. Do **not** delete migration folders.

---

## 7. Implementation steps

1. Edit `20260429120000_.../migration.sql` (pick_lists index shape).  
2. Edit `20260429130000_.../migration.sql` (BackorderStatus + allocation_plans indexes).  
3. No-op placeholders for `20260411191500` and `20260411200000`.  
4. Run `npx prisma migrate deploy` against a disposable database (CI / local) from empty or from a restored snapshot **as applicable**.  
5. For environments that **recorded failure** at `20260411191500` without marking it rolled forward: retry deploy after deploying this code (**no migrate resolve** needed unless partial application occurred).

---

## 8. Rollback considerations

- **Do not rollback** `_prisma_migrations` manually in production unless following incident procedure.  
- **Editing migrations that already succeeded** on production is discouraged. This change is justified when **migrate deploy fails before applying** these migrations — i.e. production has **not** applied the broken SQL as success.  
- If any environment falsely marked **`20260411191500`** as **`SUCCESS`** while the transaction failed (**rare corruption**), use **`prisma migrate resolve`** only after manual DB inspection.

---

## 9. Verification checklist

- [ ] Fresh **`migrate deploy`**: succeeds past **`20260411191500`** and **`20260411200000`**.  
- [ ] After full chain: **`\d pick_lists`** shows **`pick_lists_allocationPlanId_idx`** (non-unique), **`pick_lists_stockDispatchId_key`** (unique nullable semantics per PG).  
- [ ] **`allocation_plans`**: **`allocation_plans_one_primary_stock_request_uidx`** exists; blanket **`allocation_plans_stockRequestId_key`** absent.  
- [ ] **`BackorderStatus`** includes **`LINKED`**.  
- [ ] **`prisma migrate status`** reflects expected applied set.

---

## 10. Prisma-safe migration strategy

- Prefer **squashing behavior via consolidation comments** (`SELECT 1`) over **rename of migration timestamps** once names may exist on shared branches — **preserve IDs**.  
- Prefer **moving DDL forward** into the migration that follows **table creation**.  
- Use **conditional / `IF EXISTS` guards** only when repairing **ambiguous legacy states**; here, forward-move + no-op is sufficient and matches repo precedent (`20260429120500`).  
- Maintain **additive** DDL where possible (`IF NOT EXISTS`, `DROP INDEX IF EXISTS`).

---

## 11. Files touched by this repair

| Path | Change |
|------|--------|
| `prisma/migrations/20260429120000_warehouse_enterprise_po_allocation_pick_pod/migration.sql` | Non-unique `allocationPlanId` index. |
| `prisma/migrations/20260429130000_multi_warehouse_fulfillment_system/migration.sql` | `BackorderStatus` + partial unique index on `allocation_plans`. |
| `prisma/migrations/20260411191500_pick_lists_allow_multiple_per_allocation_plan/migration.sql` | Placeholder. |
| `prisma/migrations/20260411200000_backorder_status_linked/migration.sql` | Placeholder. |
| `docs/migration-repair-analysis.md` | This document. |
