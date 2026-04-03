# Prisma migration policy — non-destructive (production-like DB)

Treat the current PostgreSQL database as **production-like** at all times. Preserve existing data.

## Mandatory rules

1. **Production-like database** — Assume every change can affect real business data. No throwaway assumptions.

2. **Never `prisma migrate reset`** — Drops schema and data. Forbidden on this database.

3. **Never `prisma db push` on this database** — Bypasses migration history and causes drift. Use migrations only.

4. **Never edit already-applied migration files** — Once a folder under `prisma/migrations/` has been applied, its `migration.sql` is immutable. Fix forward with a **new** migration.

5. **Schema changes workflow**
   - Edit `prisma/schema.prisma`.
   - Create a **new** migration (e.g. `npx prisma migrate dev --name <descriptive_name> --create-only` on a safe dev clone, or hand-author SQL in a new folder after reviewing diff).
   - **Review** the generated SQL line by line (destructive DDL = stop and reassess).
   - Apply on shared / production-like hosts with **`prisma migrate deploy`**, not reset-based dev flows.

6. **Integrity check — before and after** migration work:

   ```bash
   node scripts/check-migration-integrity.js
   ```

   Expect: `All migration checksums match. No drift detected.`

7. **If drift is detected**
   - **Stop** — do not apply more migrations blindly.
   - **Do not reset** the database.
   - **Plan** — document root cause and a reconciliation approach (see `docs/non_destructive_prisma_drift_recovery_plan.md`).

8. **Always preserve existing data** — Prefer additive migrations, idempotent steps, and manual review for anything that drops columns, tables, or constraints.

## Related

- Drift recovery playbook: `docs/non_destructive_prisma_drift_recovery_plan.md`
- Integrity script: `scripts/check-migration-integrity.js`

## Quick reference

| Safe | Avoid |
|------|--------|
| `prisma migrate deploy` | `prisma migrate reset` |
| `prisma migrate status` | `prisma db push` (this DB) |
| `prisma migrate diff` (inspect only) | Editing applied `migration.sql` |
| `prisma validate` / `prisma generate` | Dropping schema or bulk deletes without backup |
