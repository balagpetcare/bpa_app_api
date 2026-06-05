# Prisma Seeder TypeScript Fix Report

**Date:** 2026-06-05  
**Issue:** `npm run seed` failed — `seedBaseBdLocations.ts` line 159: `Type 'unknown' is not assignable to type 'number'` on `unionId`

---

## Root cause

In `prisma/seeders/seedBaseBdLocations.ts`, union ID lookups used a pattern that broke type inference under **ts-node strict checking**:

1. **`prismaAny: any`** — `bdUnion` rows were loaded through an untyped delegate (`prismaAny.bdUnion.findMany`), producing `any[]`.
2. **`new Map(..., [code, id] as const)`** — When built from `any[]`, TypeScript inferred the map’s values as **`unknown`**, not `number`.
3. **`unionId`** — The expression `unionIdByCode.get(...) ?? null` therefore typed as `unknown | null`, which is invalid for Prisma’s `BdArea.unionId: number | null`.

Division/district/upazila maps used typed `prisma.bdDivision.findMany` results and did not hit this error; only the union path (via `prismaAny`) failed at compile time.

---

## Files modified

| File | Change |
|------|--------|
| `prisma/seeders/seedBaseBdLocations.ts` | Removed `prismaAny`; added typed helpers; use `prisma.bdUnion` directly |
| `src/api/v1/payments/strategies/eps.strategy.ts` | Renamed `parseCallbackQuery` → `parseEpsCallbackQuery` (unblocks `tsc --noEmit`) |

---

## Type fixes applied

### Helpers (no `any`, no casts)

```typescript
type IdCodeRow = { id: number; code: string };

function buildIdByCodeMap(rows: IdCodeRow[]): Map<string, number> { ... }
function lookupId(map: Map<string, number>, code?: string): number | null { ... }
function resolveUnionId(area: AreaSeed, unionIdByCode: Map<string, number>): number | null { ... }
```

### Behavioral changes

- All ID maps (`divIdByCode`, `disIdByCode`, `upzIdByCode`, `unionIdByCode`) now use `buildIdByCodeMap()` → explicit `Map<string, number>`.
- `unionId`, `upazilaId`, and `districtId` for `bdArea.upsert` are always `number | null`.
- `prisma.bdUnion.upsert` / `findMany` used directly (model exists in schema); removed runtime `prismaAny` guards.

### Not used (per requirements)

- `as any`
- `@ts-ignore` / `@ts-nocheck`

---

## Seeder audit (other files)

| Pattern | Files | Action |
|---------|-------|--------|
| `prismaAny` / `unknown` on location IDs | `seedBaseBdLocations.ts` only | **Fixed** |
| `prisma: any` param | `seedVaccineTypes.ts`, `modelResolver.ts` | Pre-existing; compiles under ts-node; no seed failure |
| `as const` on Prisma filter modes | `seedGlobalCountryRoles.ts`, `seedFundraisingPayoutCatalog.ts` | Valid literal narrowing; OK |

No other seeders failed compilation during `npm run seed`.

---

## Validation results

### `npx tsc --noEmit`

```
Exit code: 0
```

(Required fix to `eps.strategy.ts` export name; seeders are compiled via ts-node during seed, not via root `tsconfig.json` which only includes `src/`.)

### `npm run seed`

```
Exit code: 0
```

Seed completed successfully, including:

- Base BD locations (divisions, districts, upazilas, unions, areas)
- Dhaka city hierarchy
- Roles, products, countries, clinical catalog, etc.

No destructive DB operations; idempotent upserts only.

---

## Status

| Check | Result |
|-------|--------|
| `seedBaseBdLocations.ts` compiles | ✅ |
| `npm run seed` | ✅ |
| `npx tsc --noEmit` | ✅ |
| Data preserved | ✅ (upsert-only seed) |

**Goal met:** Prisma seeders compile and run without TypeScript errors.
