# Migration governance report

**Repository:** BPA/WPA backend-api (`prisma/migrations`)  
**Scope:** Enterprise Prisma + PostgreSQL, 250+ migrations, multi-tenant modules  
**Last updated:** 2026-05-15

---

## 1. Executive summary

Migration failures observed in deployment were caused primarily by **unsafe lexicographic ordering** (migration folder names sort globally by timestamp + suffix) combined with **DDL that referenced relations created only in much later migrations**. A secondary class of issues was **`owner_discount_cards`**: table `CREATE` appeared only in a **late “drift reconciliation” migration** while **earlier migrations** ran `ALTER TABLE` and `REFERENCES` against that table.

Governance response (non-destructive, forward-only):

| Principle | Application |
|-----------|-------------|
| Preserve lineage | **No migration folders renamed or deleted.** |
| Placeholders | Early, ordering-invalid migrations converted to **`SELECT 1`** where substantive DDL was moved later. |
| Consolidation | Substantive DDL moved to migrations that run **after** prerequisite `CREATE TABLE` / enums. |
| Idempotency | `IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, and `DO $$ … EXCEPTION WHEN duplicate_object`** for replays and branch divergence. |
| Auditability | `scripts/audit-migration-dependencies.mjs` + docs (`migration-dependency-graph.md`, `migration-repair-plan.md`). |

---

## 2. Root cause taxonomy

### 2.1 Lexicographic ordering vs. business dependency

Prisma applies migrations in **strict ascending order of the full directory name** (see `migration_lock.toml`). Therefore:

- A migration dated **`20260411…`** always runs before **`20260428…`** and **`20260429…`**, regardless of business “phase” naming.
- Any `ALTER`/`INDEX`/`REFERENCES` touching objects created only in **later-dated** folders is **ordering-invalid** unless wrapped in **guards** or **moved** to the later migration.

### 2.2 “Drift” baseline migrations

`20260501000000_drift_reconciliation_baseline` encodes **schema drift from a live database** (drops, enum rewrites, etc.). It is **not** a pure “greenfield” migration. Empty-database deploys must be validated in CI; that migration can fail if **prior** migrations do not leave the DB in the exact shape the script assumes.

### 2.3 Consolidation and placeholders

Several migrations were already converted to no-ops with comments pointing to **`20260429120500_enterprise_allocation_post_foundation`**. The same pattern applies to warehouse/picking and pricing/order patches listed in `migration-repair-plan.md`.

---

## 3. Confirmed defect classes addressed in this repair cycle

| ID | Symptom | Root cause | Mitigation |
|----|---------|------------|------------|
| W1 | `pick_lists` does not exist | Index change migration **before** `CREATE TABLE pick_lists` | Placeholder early migration; `CREATE` + correct index in `20260429120000` |
| W2 | `BackorderStatus` / `allocation_plans` not ready | Backorder migration **before** enum/table extensions | Placeholder + DDL in `20260429130000` |
| P1 | `owner_discount_cards` referenced early | Table first `CREATE` in **`20260501000000`**, FK/ALTER in **`20260416` / `20260420`** | **Create `owner_discount_cards` in `20260416140000`** (after `membership_tiers`); drift migration **idempotent** |

---

## 4. Schema alignment (`schema.prisma`)

- `PickList.allocationPlanId` — indexed, **not** unique: aligns with non-unique `pick_lists_allocationPlanId_idx` in `20260429120000`.
- `OwnerDiscountCard.membershipTierId` — present on model; created in early migration with FK to `membership_tiers`.
- `BackorderStatus` includes `LINKED`: enum extended in `20260429130000`.

---

## 5. Static migration audit tool

- **Script:** `scripts/audit-migration-dependencies.mjs`
- **Command:** `npm run migrate:audit-deps`
- **Behavior:** Two-pass scan: (1) first `CREATE TABLE` per table; (2) `REFERENCES` / `ALTER TABLE` after stripping `DO $$ … END $$;` blocks to reduce false positives on **deferred FK** patterns.
- **Exit code:** `0` if no heuristic violations, `2` if any remain.
- **Canonical check:** `prisma migrate deploy` on an **empty** PostgreSQL instance (recommended in CI).

---

## 6. Duplicate / collision notes

The repo uses **duplicate date prefixes** for different feature folders (e.g. multiple `20260402120000_*`). Ordering is **not** ambiguous: the **full folder name** sorts lexicographically. Reviewers must compare **complete** names, not dates alone.

---

## 7. Obsolete migrations

Migrations superseded by consolidated “post-foundation” or later files remain as **documented placeholders** (`SELECT 1`) to keep `_prisma_migrations` history stable. Do not delete those directories.

---

## 8. Remaining risks

| Risk | Mitigation |
|------|------------|
| `20260501000000_drift_reconciliation_baseline` assumes cumulative prior state | Treat as **high-churn**; run full **empty DB** deploy in CI; split future drift into smaller guarded steps |
| Heuristic audit can miss problems inside **complex PL/pgSQL** | Keep **`migrate deploy`** as the source of truth |
| Production DBs that **partially applied** failed migrations | Use **`prisma migrate resolve`** only after DB inspection |

---

## 9. CI/CD recommendations

1. **`npm run migrate:audit-deps`** (exit 0).
2. **`npx prisma validate`**.
3. **Ephemeral PostgreSQL** → `npx prisma migrate deploy` from empty DB (see `migration-repair-plan.md` commands).
4. Optional: **`npm run migrate:check-files`** / **`npm run check:migrations`** if already in pipeline.

---

## 10. Related documents

- [`migration-dependency-graph.md`](./migration-dependency-graph.md) — module ordering graph.
- [`migration-repair-plan.md`](./migration-repair-plan.md) — patched files and verification.
- [`migration-repair-analysis.md`](./migration-repair-analysis.md) — warehouse pick-list chain detail.
