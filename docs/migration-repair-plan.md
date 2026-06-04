# Migration repair plan

**Status:** Implemented patches applied in-repo (2026-05-15).  
**Constraints satisfied:** No migration folders deleted or renamed; `_prisma_migrations` folder names unchanged.

---

## 1. Objectives

1. Allow `prisma migrate deploy` to progress past ordering-invalid steps (`pick_lists`, `allocation_plans` / `BackorderStatus`, `owner_discount_cards` / POS).
2. Keep **additive / idempotent** SQL where practical.
3. Document every patched migration with **inline comments** pointing here and to `migration-governance-report.md`.

---

## 2. Patched migrations (inventory)

### 2.1 Warehouse / allocation / picking

| Migration | Change |
|-----------|--------|
| `20260411191500_pick_lists_allow_multiple_per_allocation_plan` | **Placeholder** (`SELECT 1`). Substance: `pick_lists` index shape in `20260429120000`. |
| `20260411200000_backorder_status_linked` | **Placeholder** (`SELECT 1`). Substance: partial index + `BackorderStatus` in `20260429130000`. |
| `20260429120000_warehouse_enterprise_po_allocation_pick_pod` | **`pick_lists`**: non-unique `pick_lists_allocationPlanId_idx` (multi-wave dispatch). |
| `20260429130000_multi_warehouse_fulfillment_system` | **`BackorderStatus`**: includes `LINKED` + guarded `ADD VALUE`; **`allocation_plans`**: drop blanket unique on `stockRequestId`, add partial unique index. |

### 2.2 Pricing / POS / drift (owner discount cards)

| Migration | Change |
|-----------|--------|
| `20260416140000_enterprise_pricing_recovery_ddl` | **`CREATE TABLE IF NOT EXISTS owner_discount_cards`** (+ indexes + FKs, including `membershipTierId`) **after** `membership_*` tables so **`20260420190000`** POS FK can resolve. Replaces prior `ALTER`-only block that required a non-existent table. |
| `20260501000000_drift_reconciliation_baseline` | **`owner_discount_cards`**: `CREATE TABLE IF NOT EXISTS` including `membershipTierId`; indexes `IF NOT EXISTS`; FKs in **`DO $$ … EXCEPTION WHEN duplicate_object`** to tolerate table already created in `20260416140000`. |

---

## 3. Documentation created

| File | Role |
|------|------|
| `docs/migration-governance-report.md` | Root causes, governance principles, CI recommendations |
| `docs/migration-dependency-graph.md` | Module ordering overview + Mermaid |
| `docs/migration-repair-analysis.md` | Prior deep-dive on pick-list chain |

---

## 4. Automation added

| Artifact | Purpose |
|----------|---------|
| `scripts/audit-migration-dependencies.mjs` | Heuristic “reference before create” scan |
| `npm run migrate:audit-deps` | Wrapper in `package.json` |

---

## 5. Verification commands

**Schema:**

```bash
npx prisma validate
```

**Static ordering (heuristic):**

```bash
npm run migrate:audit-deps
# Expect: "violationCount": 0
```

**Dry-run / full chain (canonical — requires PostgreSQL):**

```bash
# Example: empty database
# export DATABASE_URL="postgresql://USER:PASS@HOST:5432/EMPTY_DB?schema=public"
npx prisma migrate deploy
```

**Docker (when available):**

```bash
docker run -d --name pg-migrate -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=migratetest -p 55433:5432 postgres:16-alpine
set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/migratetest
npx prisma migrate deploy
```

---

## 6. Rollback / ops

- **Do not** rename migration directories after release branches cut.
- If a migration **failed mid-transaction**, resolve only after comparing Postgres transaction logs / `_prisma_migrations` with actual DDL.
- Editing **already-applied** migration bodies on production is **out of band**; prefer **forward** repair migrations for DBs that diverge.

---

## 7. Remaining risks

1. **`20260501000000_drift_reconciliation_baseline`** — Contains many **destructive** steps (drops, enum rewrites). Greenfield behavior depends on **exact** cumulative state from prior 250+ migrations. **Mandatory:** empty-DB CI job.
2. **Heuristic audit** — Ignores some edge cases (nested PL/pgSQL, nonstandard quoting). `migrate deploy` remains authoritative.
3. **Branch merges** — Multiple engineers adding migrations with same date prefix require **full name** comparison when rebasing.

---

## 8. Recommended future governance rules

1. **No `ALTER` on tables** introduced only in later-dated migrations — either **defer** DDL to the post-create migration or use **guarded** `DO` blocks + document.
2. **New tables** must appear in the **earliest** migration that needs them for FKs — or FKs must be **deferred** to a later migration with explicit comments.
3. **CI:** `prisma validate` + `migrate:audit-deps` + **empty DB** `migrate deploy` on default branch.
4. Avoid monolithic “drift dump” migrations where possible; prefer **small, guarded, additive** steps.

---

## 9. Mental model: clean deploy consistency

Simulation (conceptual):

1. Migrations sort lexically; core tables and enums appear first.
2. **`20260416140000`** creates `owner_discount_cards` before POS.
3. **`20260420190000`** adds `pos_carts` → FK to `owner_discount_cards` succeeds.
4. **Warehouse foundation** → **PO/allocation/pick** → **multi-warehouse** run in order; early April placeholders do not execute destructive DDL.
5. **`20260501000000`** runs last in this wave: `owner_discount_cards` path is **idempotent**; other drift steps still require **full prior chain** to be consistent.

If any step contradicts a **global** invariant (e.g. drift drop of a table never created), **empty-DB CI** will surface it.
