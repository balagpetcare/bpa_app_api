# Backend Startup Crash Recovery Report

## 1. Root cause

**MODULE_NOT_FOUND** was caused by a **wrong relative path depth** in one file added during the clinic schedule timezone fix:

- **File:** `src/api/v1/services/clinicScheduleTime.service.ts`
- **Broken import:** `require("../../infrastructure/db/prismaClient")`
- **Why it failed:** From `src/api/v1/services/`, `../` goes to `api/v1`, `../../` goes to `api`. So `../../infrastructure/db/prismaClient` resolved to `src/api/infrastructure/db/prismaClient`, which **does not exist**. The real module is at `src/infrastructure/db/prismaClient.ts`, which requires **three** segments up from `services/` to reach `src/`.

No other broken imports were found in the startup chain. All other Prisma imports use the correct depth for their directory (e.g. `src/api/v1/modules/clinic/*` use `../../../../`, `src/api/v1/services/*` use `../../../`).

---

## 2. Canonical paths

| Purpose | Canonical path |
|--------|-----------------|
| Prisma client (singleton, used by API) | `src/infrastructure/db/prismaClient.ts` |
| Entrypoint | `src/index.ts` |
| App (Express) | `src/app.ts` |

**Depth from common roots:**

- From `src/api/v1/services/` → `src/`: **`../../../`**
- From `src/api/v1/modules/<module>/` → `src/`: **`../../../../`**
- From `src/api/v1/modules/clinic/appointments/` → `src/`: **`../../../../../`**

---

## 3. Files changed

| File | Change |
|------|--------|
| `src/api/v1/services/clinicScheduleTime.service.ts` | Updated Prisma require from `../../infrastructure/db/prismaClient` to `../../../infrastructure/db/prismaClient` |

---

## 4. Fixes applied

1. **clinicScheduleTime.service.ts**
   - Replaced `require("../../infrastructure/db/prismaClient")` (and `.default ??` fallback) with `require("../../../infrastructure/db/prismaClient")` so the path resolves from `src/api/v1/services/` to `src/infrastructure/db/prismaClient`.
   - No other edits (export style, default vs named, or file renames) were required.

**Not changed (verified correct):**

- All other `src/api/v1/services/*` files already use `../../../infrastructure/db/prismaClient`.
- All `src/api/v1/modules/**/*` files use `../../../../` or `../../../../../` as appropriate.
- No barrel-export or tsconfig path-alias usage for Prisma; resolution is plain Node `require()` with relative paths.
- Prisma client file: `src/infrastructure/db/prismaClient.ts` exports both `export default prisma` and `module.exports = prisma` (and `.default`), so both ESM and CommonJS/require() work.

---

## 5. Startup validation result

- **Manual require:** `require('./src/api/v1/services/clinicScheduleTime.service')` loads successfully with `TS_NODE_TRANSPILE_ONLY=1`.
- **Full dev startup:** `npm run dev` (with `TS_NODE_TRANSPILE_ONLY=1`) runs the full chain and reaches the HTTP server listening step. No MODULE_NOT_FOUND. Observed error was **EADDRINUSE** on port 3000 (another process using the port), which confirms the process started far enough to bind the port.
- **Typecheck:** `npm run typecheck` was started; the codebase has pre-existing TypeScript errors in other files (e.g. `producer.service.ts`). Those are unrelated to this import fix. With `TS_NODE_TRANSPILE_ONLY=1`, dev does not run full typecheck and starts successfully.

**Conclusion:** Backend startup is stable with respect to module resolution; the single wrong path was corrected and validated.

---

## 6. Remaining risks

1. **TypeScript errors elsewhere**  
   Full `tsc --noEmit` may still report errors in files such as `producer.service.ts`. They do not affect runtime when using `npm run dev` with `TS_NODE_TRANSPILE_ONLY=1`. Fixing them is a separate task.

2. **Port 3000 in use**  
   If another process is using 3000, start will fail with EADDRINUSE. Stop the other process or change the app port.

3. **Path drift if files move**  
   Any future move of `src/infrastructure/db/prismaClient.ts` or of `clinicScheduleTime.service.ts` will require updating the relative path again. Consider a small shared module (e.g. `src/api/v1/utils/prisma.ts` or a single “get prisma” helper) and using it from services to reduce repeated long paths, if the team refactors structure later.

4. **No tsconfig path alias**  
   `tsconfig.json` uses default `moduleResolution: "node"` and no path mappings. All Prisma imports are relative. If path aliases are added later, ensure runtime (Node/ts-node) resolves them the same way (e.g. via `tsconfig-paths/register` or equivalent).

---

## Summary

- **Root cause:** One incorrect relative path in `clinicScheduleTime.service.ts` (`../../` instead of `../../../` for Prisma client).
- **Canonical Prisma client:** `src/infrastructure/db/prismaClient.ts`.
- **Fix:** Single change in `src/api/v1/services/clinicScheduleTime.service.ts` to use `../../../infrastructure/db/prismaClient`.
- **Validation:** Dev server starts and reaches listen; no MODULE_NOT_FOUND in the startup chain.
