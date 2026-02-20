## Goal
- Make `backend-api` compile, start, and run core endpoints without runtime/type errors.

## Current Observations
- Repo uses TypeScript compiled to CommonJS (`tsconfig.json`), with `build`/`typecheck` scripts in [package.json](file:///d:/BPA_Data/backend-api/package.json).
- Codebase contains multiple auth/permission middleware variants under different folders (e.g. `src/middleware/*` vs `src/middlewares/*`), which often leads to import-path mistakes and inconsistent behavior.
- Project-wide semantic search indexing is currently unavailable, so I will rely on file globs + ripgrep searches for navigation.

## Plan
### 1) Establish an “error baseline” (no code changes yet)
- Run `npm run typecheck` and `npm run build` in `d:\BPA_Data\backend-api`.
- Start the API with `npm run dev` and hit `/health`.
- Capture and group failures into:
  - TypeScript compile errors
  - Runtime errors (startup / request-time)
  - Prisma/schema mismatches

### 2) Fix TypeScript/Module errors first
- Resolve CommonJS/ESM incompatibilities (e.g. `export {}` usage, default exports, `require()` imports) only where they break build.
- Standardize problematic imports to match existing conventions in neighboring files.

### 3) Fix runtime errors in middleware & routing
- Verify middleware order is correct globally (auth/optional-auth, country context, route guards).
- Eliminate inconsistent middleware usage by aligning route files to a single auth middleware approach where required.
- Validate critical protected routes return expected statuses (401 vs 403) with/without token.

### 4) Fix Prisma-related errors
- For any failing queries/includes, align code to the actual Prisma schema relations.
- Ensure permission resolution paths do not reference non-existent fields.

### 5) Verify end-to-end
- Re-run `typecheck` + `build`.
- Smoke-test key endpoints:
  - `/health`
  - `/api/v1/auth/health`
  - One country-scoped route (e.g. country access invites) with valid auth.

## Deliverables
- A set of code changes that makes `npm run typecheck` and `npm run build` pass.
- Quick smoke-test results confirming server starts and core routes respond.

Approve this plan and I will start executing it (run checks, fix issues, and re-verify).