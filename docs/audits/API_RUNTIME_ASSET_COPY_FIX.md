# API Runtime Asset Copy Fix

**Date:** 2026-06-06  
**Project:** `backend-api`  
**Issue:** `tsc` build passes but production crashes with `Cannot find module` for legacy `.js` files under `src/`.

---

## Discovery: `find src -name "*.js"`

```text
src/api/v1/constants/pricingOwnerPermissions.js
src/api/v1/modules/barcodes/barcodes.service.js
src/api/v1/modules/owner/onboarding.controller.js
src/api/v1/modules/owner/utils/locationValidation.js
src/api/v1/services/ownerDelegation.service.js
src/api/v1/services/teamInvitation.service.js
src/api/v1/services/userContext.service.js
src/api/v1/utils/csvExportHelper.js
src/api/v1/utils/permissions.js
src/utils/helpers.js
```

**Total:** 10 legacy JavaScript files (entire `src/**/*.js` tree).

All other runtime code is TypeScript and is emitted by `tsc` as `dist/**/*.js`.

---

## Runtime import audit

| Legacy JS asset | Imported at runtime by |
|-----------------|------------------------|
| `api/v1/utils/permissions.js` | `middleware/auth.middleware.ts`, `authUnified.service.ts`, `warehouseOperations.service.ts`, `producer.service.ts`, `producer.controller.ts`, `auth.controller.ts`, `scopePermission.service.ts` |
| `api/v1/constants/pricingOwnerPermissions.js` | `permissions.js` (chain: auth middleware → **production failure**) |
| `api/v1/utils/csvExportHelper.js` | `campaignExportFormats.ts`, `export.service.ts`, `producer.service.ts` |
| `api/v1/services/userContext.service.js` | `me.controller.ts`, `auth.controller.ts`, `onboarding.controller.js` |
| `api/v1/services/teamInvitation.service.js` | `auth.controller.ts`, `ownerDelegation.controller.ts` |
| `api/v1/services/ownerDelegation.service.js` | `ownerDelegation.controller.ts`, `scopePermission.service.ts` |
| `api/v1/modules/barcodes/barcodes.service.js` | `barcodes.controller.ts` |
| `api/v1/modules/owner/onboarding.controller.js` | `owner.routes.ts` |
| `api/v1/modules/owner/utils/locationValidation.js` | `owner.controller.ts`, `organizations.controller.ts` |
| `utils/helpers.js` | `products.service.ts`, `master-catalog.service.ts`, `UpsertEngine.ts` |

### Also copied (non-JS runtime assets)

11 × `utils/emailTemplates/*.html` — loaded via `fs.readFile` in email services.

---

## Root cause

`tsconfig.json` includes only `src/**/*.ts`. Legacy `.js` files are never written to `dist/`. Previous build copied only `ownerDelegation.service.js` manually.

---

## Build changes

### `scripts/copy-runtime-assets.cjs`

Post-`tsc` step that:

1. Walks `src/` and copies `.js`, `.json`, `.html`, `.sql`, `.hbs`, `.ejs` → `dist/` (same paths)
2. **Fails the build** if any `src/**/*.js` file is missing from `dist/`
3. Logs every verified runtime JS asset

### `package.json`

```json
"build": "rimraf dist && tsc -p tsconfig.json && node scripts/copy-runtime-assets.cjs"
```

Replaces the one-file `copyFileSync` hack.

---

## Verification output

### Clean build

```bash
rm -rf dist
npm run build
```

```text
> rimraf dist && tsc -p tsconfig.json && node scripts/copy-runtime-assets.cjs
[copy-runtime-assets] Copied 21 file(s) from src/ to dist/
[copy-runtime-assets] Verified 10 runtime JS asset(s):
  - api/v1/constants/pricingOwnerPermissions.js
  - api/v1/modules/barcodes/barcodes.service.js
  - api/v1/modules/owner/onboarding.controller.js
  - api/v1/modules/owner/utils/locationValidation.js
  - api/v1/services/ownerDelegation.service.js
  - api/v1/services/teamInvitation.service.js
  - api/v1/services/userContext.service.js
  - api/v1/utils/csvExportHelper.js
  - api/v1/utils/permissions.js
  - utils/helpers.js
```

### Legacy assets in `dist/`

```text
dist/api/v1/utils/permissions.js              → present
dist/api/v1/constants/pricingOwnerPermissions.js → present
dist/api/v1/utils/csvExportHelper.js        → present
dist/utils/helpers.js                       → present
(all 10 src/**/*.js mirrored)
```

`find dist -name "*.js"` also includes ~800+ files emitted from TypeScript by `tsc`.

---

## Final startup confirmation

```bash
node dist/index.js
```

```text
[Redis] Redis disabled by configuration
[JOB] Starting expiryEngine job...
[OWNERS_AUTOMATION] Starting (check=1h, sync=6h, audit=daily 00:00)
🚀 Server running at http://0.0.0.0:3000/api/v1
```

**No `Cannot find module` errors.** Payment/storage warnings are environment configuration only.

---

## Production deploy

```bash
git pull
rm -rf dist
npm ci
npm run build
test -f dist/api/v1/utils/permissions.js
test -f dist/api/v1/constants/pricingOwnerPermissions.js
pm2 restart bpa-api
```

---

## Files modified

| File | Change |
|------|--------|
| `scripts/copy-runtime-assets.cjs` | Copy all static runtime assets; verify every `src/**/*.js` in `dist/` |
| `package.json` | `build` script invokes copy script |
| `docs/audits/API_RUNTIME_ASSET_COPY_FIX.md` | This report |
