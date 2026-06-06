# Repository Seed Consistency Audit (BPA / WPA)

**Date:** 2026-06-06  
**Repository:** `backend-api`  
**Scope:** Analysis only — no code changes  
**Related:** [SEED_SYSTEM_AUDIT.md](./SEED_SYSTEM_AUDIT.md), [PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md](./PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md)

---

## 1. Executive summary

| Finding | Status |
|---------|--------|
| Main seed chain (`prisma/seed.ts`) imports | **All resolve** — verified by execution |
| Coverage seeders (`prisma/seeders/coverage/`) | **Present** (10 files) — **not** in main chain |
| `prisma/seed_all.js` | **Broken** — references missing `prisma/seed_social.js` |
| Legacy `prisma/seed.js` | **Dead path** — uses deprecated `cityCorporation` model |
| Prisma 7 dual seed config | **Consistent** — `prisma.config.ts` + `package.json` agree |
| Server deployment risk | Running `db:deploy` on prod wipes catalog via step 18 |

---

## 2. Expected vs actual: seed file inventory

### 2.1 Canonical chain (expected on server)

| File | In repo | In main chain | npm script |
|------|---------|---------------|------------|
| `prisma/seed.ts` | Yes | Entry | `seed`, `db:seed` |
| `prisma/seeders/*.ts` (active) | Yes (40+ modules) | Steps 1–20 | Partial |
| `prisma/seeds/seed-master-catalog.ts` | Yes | Step 18 | via full seed only |
| `prisma/seed-data/*.json` | Yes | Location deps | — |
| `prisma/seed-data/complete_veterinary_master_catalog.csv` | Yes | Step 18 | — |
| `prisma/seeders/coverage/**` | **Yes** | **No** | `seed:coverage-zones` |
| `scripts/bootstrap-super-admin.ts` | Yes | No | `admin:bootstrap` |

### 2.2 Standalone scripts

| File | In repo | npm script |
|------|---------|------------|
| `scripts/seed-location-master.ts` | Yes | `seed:location-master` |
| `scripts/seed-dhaka-city.ts` | Yes | `seed:dhaka-city` |
| `scripts/seed-dhaka-metro.ts` | Yes | `seed:dhaka-metro` |
| `scripts/seed-coverage-zones.ts` | Yes | `seed:coverage-zones` |
| `scripts/seed-locations-only.ts` | Yes | **None** |
| `scripts/seed-bd-locations-once.ts` | Yes | **None** |
| `scripts/seed-clinic-vaccine-items.ts` | Yes | `seed:clinic-vaccine-items` |
| `scripts/seed-campaign-checkout-anchor.ts` | Yes | `seed:campaign-checkout-anchor` |
| `scripts/seed-demo-catalog.ts` | Yes | **None** |
| `scripts/seed-campaign-included-vaccines.js` | Yes | **None** |
| `scripts/seed-test-stock.js` | Yes | **None** |

---

## 3. Broken imports and dead paths

### 3.1 Broken: `prisma/seed_all.js`

```javascript
await require("./seed.js");
await require("./seed_social.js");   // FILE MISSING
await require("./seed_location.js")();
```

| Issue | Impact |
|-------|--------|
| `prisma/seed_social.js` does not exist | `seed_all.js` throws on run |
| Not wired to npm | Low runtime risk unless manually invoked |

### 3.2 Legacy: `prisma/seed.js`

- Requires `./seeders/seedLocationsDhaka` → uses `prisma.cityCorporation` model.
- Current canonical path uses `bdArea` hierarchy (`seedBaseBdLocations` + dhaka seeders).
- **Risk:** Running on modern schema may fail or write to wrong tables.

### 3.3 Legacy: `prisma/seeders/seedLocationsDhaka.js`

- Exports `seedLocationsDhaka` for `cityCorporation` + `area` models.
- Superseded by `runDhakaCitySeed` / `BdArea` tree.

### 3.4 Orphan: `prisma/seeders/seedAnimalTypesAndBreeds.ts`

- Not imported by `prisma/seed.ts`.
- Superseded by `seedAnimalTaxonomy.ts`.

### 3.5 Duplicate schema copy: `prisma/schema_final_clean/`

- Contains alternate seed copies (`seedBaseBdLocations.ts`, `seed_location.js`).
- **Not** used by runtime seed — documentation/drift risk only.

---

## 4. Import chain validation

### 4.1 `prisma/seed.ts` direct imports — all present

| Import | Resolves |
|--------|----------|
| `../src/infrastructure/db/prismaClient` | Yes |
| `./seeders/seedBaseBdLocations` | Yes |
| `./seeders` (`runDhakaCitySeed`) | Yes |
| `./seeders/location` (`runGlobalLocationSeed`) | Yes |
| `./seeds/seed-master-catalog` | Yes |
| All other `./seeders/*` | Yes |

### 4.2 Dynamic imports (`prisma/seeders/index.ts`)

```typescript
await import('./coverage/seedCoverageZones')
await import('./coverage/seedDhakaNorthCity')
await import('./coverage/seedDhakaSouthCity')
await import('./coverage/seedBusinessCoverageReadiness')
```

All four modules exist under `prisma/seeders/coverage/`.

### 4.3 Verification method

```text
Node v22.22.0 + ts-node/register loaded prisma/seed.ts — all imports resolved.
Note: loading seed.ts executes the full seed pipeline (no import-only guard).
```

---

## 5. Coverage seeders gap

| Expected (docs + scripts) | Main `seed.ts` | Production impact |
|---------------------------|----------------|-------------------|
| `coverage/seedCoverageZones.ts` | Not called | Coverage empty after `db:seed` unless `seed:coverage-zones` run separately |
| `coverage/seedDhakaNorthCity.ts` | Not called | Same |
| `coverage/seedDhakaSouthCity.ts` | Not called | Same |
| `coverage/seedBusinessCoverageReadiness.ts` | Not called | Same |

**Deployment risk:** Teams assuming `npm run db:seed` covers coverage will have **missing coverage zones** on campaign booking flows.

**Mitigation:** Always run `npm run seed:coverage-zones` post-deploy per execution plan.

---

## 6. Configuration consistency

| Config location | Seed command | Match? |
|-----------------|--------------|--------|
| `prisma.config.ts` | `node -r ts-node/register prisma/seed.ts` | Yes |
| `package.json` `"prisma"."seed"` | same | Yes |
| `npm run seed` | `run-local-prisma.cjs db seed` → above | Yes |

**Prisma version:** package.json `^7.7.0`, installed **7.8.0** — compatible.

---

## 7. Server deployment risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `npm run db:deploy` on populated prod | **Critical** | Use `bootstrap:deploy` + targeted seeds |
| Step 18 CSV `deleteMany` | **Critical** | Skip step 18; see execution plan |
| Missing `seed-data` JSON/CSV on server | High | Ensure `prisma/seed-data/` in deploy artifact |
| Coverage not in main seed | Medium | Run `seed:coverage-zones` explicitly |
| Super Admin not bootstrapped | Medium | Run `admin:bootstrap` after deploy |
| Legacy `seed_all.js` run manually | Low | Document as obsolete |
| `npx prisma` version mismatch | Medium | Use `run-local-prisma.cjs` only |
| `SEED_WAREHOUSE_PHASE1=true` on prod | Medium | Leave unset |

---

## 8. Files referenced but absent

| Referenced by | Missing file | Status |
|---------------|--------------|--------|
| `prisma/seed_all.js` | `prisma/seed_social.js` | **Missing — broken** |
| `seed-master-catalog.ts` | `complete_veterinary_master_catalog.csv` | **Present** in repo |
| Location seeders | `bd.divisions.json`, etc. | **Present** in `prisma/seed-data/` |
| Coverage seeders | `coverage/data/*.ts` | **Present** |

---

## 9. Recommended repository hygiene (documentation only)

These are recommendations — **not implemented** in this audit:

1. Add `seed:roles` npm script wrapping RBAC seeders (reduces production one-liner risk).
2. Remove or archive `seed_all.js`, `seed.js`, `seedLocationsDhaka.js` after team sign-off.
3. Wire coverage into main seed **or** document mandatory post-seed step in deploy checklist.
4. Replace step 18 delete-and-reload with upsert (see `SEED_RECOVERY_PLAN.md`).
5. Add `SEED_DEMO_PRODUCTS=false` guard for step 13.1.

---

## 10. Consistency checklist for production deploy artifact

- [ ] `prisma/seed.ts` + all `prisma/seeders/**`
- [ ] `prisma/seeders/coverage/**` (all 10 files)
- [ ] `prisma/seeds/seed-master-catalog.ts`
- [ ] `prisma/seed-data/**` (JSON + CSV)
- [ ] `scripts/seed-*.ts` + `bootstrap-super-admin.ts`
- [ ] `prisma.config.ts`, `scripts/run-local-prisma.cjs`
- [ ] `node_modules/prisma` + `@prisma/client` (after `npm ci`)
- [ ] `.env` with `DATABASE_URL`, `SUPER_ADMIN_*`

---

*Audit complete. No application code was modified.*
