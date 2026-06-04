# Migration dependency graph (overview)

**Purpose:** High-level ordering for warehouse, pricing/POS, and “deferred consolidation” migrations.  
**Detail:** Full ordering is the **sorted list of folder names** under `prisma/migrations/`.

---

## 1. Lexicographic ordering rule

```mermaid
flowchart LR
  subgraph ordering["Prisma applies migrations as"]
    A["Sort folder names ascending"] --> B["Execute migration.sql in sequence"]
  end
```

Implication: **`20260411…` < `20260428…` < `20260429…` < `20260501…`** always.

---

## 2. Module-level dependency (simplified)

```mermaid
flowchart TD
  subgraph core["Core / org / branch"]
    O[organizations branches users]
  end

  subgraph wh_base["20260428150000 central_warehouse_foundation"]
    W[warehouses inventory_locations …]
  end

  subgraph wh_po["20260429120000 warehouse_enterprise_po_allocation_pick_pod"]
    PO[purchase_orders allocation_plans pick_lists pick_list_lines proof_of_deliveries]
  end

  subgraph alloc_post["20260429120500 enterprise_allocation_post_foundation"]
    AP[allocation_plan_events procurement_demand_lines triggers …]
  end

  subgraph mwf["20260429130000 multi_warehouse_fulfillment_system"]
    BO[backorders allocation_source_summaries BackorderStatus LINKED partial indexes]
  end

  subgraph pricing["20260416140000 enterprise_pricing_recovery_ddl"]
    PR[membership_tiers enterprise_discount_rules owner_discount_cards]
  end

  subgraph pos["20260420190000 pos_enterprise_cart_order_payment"]
    PC[pos_carts → owner_discount_cards]
  end

  subgraph drift["20260501000000 drift_reconciliation_baseline"]
    DR[enum/table drift catch-up — high coupling]
  end

  core --> wh_base
  wh_base --> wh_po
  wh_po --> alloc_post
  wh_po --> mwf
  core --> pricing
  pricing --> pos
  pos --> drift
  mwf --> drift
```

---

## 3. Critical ordering constraints

| Dependency | Must exist before |
|------------|------------------|
| `warehouses` | Warehouse-scoped FKs (often deferred in `DO` blocks + applied in `20260428150100`, `20260429120500`, etc.) |
| `membership_tiers` | `owner_discount_cards.membershipTierId` |
| `owner_discount_cards` | `pos_carts.ownerDiscountCardId` (`20260420190000`) |
| `allocation_plans` (+ `parentPlanId` for partial unique) | Supplementary-plan rules (`20260429130000` absorbs earlier intent) |
| `pick_lists` | Any index/ALTER on `pick_lists` |

---

## 4. Consolidation migrations (merge targets)

When an early migration would reference tables that do **not** exist until later, the codebase uses:

1. **Placeholder** early migration (`SELECT 1` + comment).
2. **Substantive DDL** in the **first migration that runs after** all prerequisites exist.

Examples: `20260404200000` → `20260429120500`; April 2026 pick/backorder placeholders → `20260429120000` / `20260429130000`.

---

## 5. Tooling

Generating a machine-readable graph for all 250+ folders is best done by:

```bash
ls prisma/migrations | sort
npm run migrate:audit-deps
```

The JSON output lists **heuristic** dependency violations (should be empty after repairs).
