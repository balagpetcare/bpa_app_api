# Producer Governance — Release Checklist

Use this checklist when releasing or deploying Producer Governance (Phases 1–4).

## Pre-deploy

- [ ] **Migrations:** Run `npx prisma migrate deploy` (or `npx prisma migrate dev` in dev). Ensure migration `20260228200000_producer_governance_phase3_indexes` (and any Phase 1 migrations) are applied.
- [ ] **Migrations not ignored:** Confirm `prisma/migrations` is **not** in `.gitignore` (only `migration_lock.toml` may be ignored). Migrations must be committed and deployed with the app.
- [ ] **Env:** No new required env vars for Phase 4. Optional: `RL_GOVERNANCE_MUTATION_WINDOW_MS`, `RL_GOVERNANCE_MUTATION_MAX` for rate-limit tuning.
- [ ] **Feature flags:** Print Jobs tab in admin UI is controlled by `NEXT_PUBLIC_PRODUCER_GOVERNANCE_PRINT_JOBS_TAB` (set to `false` to hide). No backend feature flags required for governance endpoints.

## Post-deploy

- [ ] **Smoke test:** Run `BASE_URL=<your-api> ADMIN_TOKEN=<token> ORG_ID=<producer-org-id> npm run smoke:governance` (see [GOVERNANCE_SMOKE.md](./GOVERNANCE_SMOKE.md)). Both `ADMIN_TOKEN` and `ORG_ID` are required.
- [ ] **RBAC:** Ensure admin roles have the correct permissions (see [GOVERNANCE_RBAC_MATRIX.md](./GOVERNANCE_RBAC_MATRIX.md)). Users need at least `admin.producers.read` (or `admin.audit.read`) for read routes and `admin.producers.write` / `admin.approvals.manage` for mutations. Assign via Role → RolePermission → Permission (keys: `admin.producers.read`, `admin.producers.write`, `admin.approvals.manage`, `admin.audit.read`, `admin.permissions.read`).

## Rollback

- **Code rollback:** Revert to previous version. No schema rollback needed for Phase 4 (no new tables). Index migration is additive; leaving it in place is safe.
- **Rate limit:** If governance mutations are blocked by rate limit, increase `RL_GOVERNANCE_MUTATION_MAX` or temporarily remove `governanceMutationLimiter` from routes (not recommended for production).
- **RBAC:** If users lose access after adding permission checks, assign the governance permission keys to the appropriate roles or grant `global.admin` / `country.admin` for full bypass.
