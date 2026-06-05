# Media Module Recovery Report

**Date:** 2026-06-05  
**Incident:** Backend failed to start — `Cannot find module '../../../shared/storage/publicMediaUrl'`

---

## Root cause

`publicMediaUrl.ts` was added at the correct location:

```
src/shared/storage/publicMediaUrl.ts
```

But callers under `src/api/v1/modules/{media,posts}/` used a **short relative path**:

```js
require('../../../shared/storage/publicMediaUrl')
```

From `src/api/v1/modules/media/`, three `../` segments resolve to **`src/api/`**, not **`src/`**:

| Resolved path | Exists? |
|---------------|---------|
| `src/api/shared/storage/publicMediaUrl` | **No** |
| `src/shared/storage/publicMediaUrl` | **Yes** |

This is a **depth miscount**, not a missing or deleted file. The module was never moved or renamed; only the `require()` paths were wrong.

**Convention in this repo:** modules at `src/api/v1/modules/<name>/` reach `src/` with **four** parents: `../../../../`.

---

## Reference inventory

### References to `publicMediaUrl`

| File | Import |
|------|--------|
| `src/api/v1/modules/media/media.service.ts` | `buildPublicMediaUrl`, `resolveClientMediaUrl` |
| `src/api/v1/modules/posts/posts.service.ts` | `resolveClientMediaUrl` |

No `publicMediaUrl.js` source file (TypeScript only). No barrel `index.ts` under `shared/storage/`.

### File status

| Path | Status |
|------|--------|
| `src/shared/storage/publicMediaUrl.ts` | **Exists** — not moved, renamed, or deleted |
| `publicMediaUrl.js` (source) | N/A — compiled to `dist/shared/storage/publicMediaUrl.js` on `npm run build` |

---

## Fixes applied

### Import paths (corrected)

```diff
- require('../../../shared/storage/publicMediaUrl')
+ require('../../../../shared/storage/publicMediaUrl')
```

**Files updated:**

1. `src/api/v1/modules/media/media.service.ts`
2. `src/api/v1/modules/posts/posts.service.ts`

### Files recreated

None — the utility file was already present; only paths were fixed.

---

## Image URL strategy (unchanged intent)

`publicMediaUrl.ts` centralizes client-facing MinIO URLs:

| Function | Role |
|----------|------|
| `publicMediaBase()` | `MINIO_PUBLIC_URL` or `AWS_ENDPOINT` (no trailing slash) |
| `buildPublicMediaUrl(key)` | `{base}/{bucket}/{key}` path-style URL |
| `resolveClientMediaUrl({ url, key })` | Prefer `key`; rewrite localhost / docker / minio hosts in legacy `url` |

**Config** (`appConfig.storage`):

- `bucketName` → `AWS_BUCKET_NAME` (default `bpa-pets`)
- `publicUrl` → `MINIO_PUBLIC_URL`
- `endpoint` → `AWS_ENDPOINT` (API → MinIO)

---

## Compatibility matrix

| Area | Uses `publicMediaUrl`? | Notes |
|------|------------------------|-------|
| **MinIO upload** | Yes — `media.service.ts` | `buildPublicMediaUrl` after `PutObject`; dedup/orphan repair |
| **Media module** | Yes | Upload + `listMyMedia` return resolved URLs |
| **Feed posts** | Yes — `posts.service.ts` | `mapPostForClient` rewrites post media + avatars |
| **Profile images** | Partial | Avatars in **post feed** responses rewritten; dedicated profile APIs may still return raw DB URLs until wired |
| **Campaign images** | No direct import | Campaign assets use their own paths / gateways; same MinIO env vars apply if stored in `media` table |

**Presigned URLs** (`src/services/presign.service.ts`) remain separate (KYC/documents); not routed through `publicMediaUrl`.

---

## Validation

| Check | Result |
|-------|--------|
| `npx tsc -p tsconfig.json --noEmit` | **Pass** (exit 0) |
| `node -r ts-node/register` require chain | **Pass** — `media.service` + `publicMediaUrl` load |
| `npm run dev` (nodemon) | **Pass** — `Server running at http://0.0.0.0:3000/api/v1` |

---

## Remaining risks

1. **Orphan DB media** — Rows pointing at keys not in MinIO still return 404 until re-upload (see `docs/image-storage-audit-report.md`).
2. **Profile / other APIs** — Not every endpoint uses `resolveClientMediaUrl`; extend helper where raw `media.url` is returned to mobile.
3. **Production `npm start`** — Uses `dist/`; run `npm run build` after path fixes so `dist/**` matches `src/**`.
4. **LAN IP drift** — Update `MINIO_PUBLIC_URL` and Flutter `MEDIA_BASE_URL` together; run `node scripts/repair-media-urls.mjs`.
5. **Fresh MinIO data dir** — Run `npm run minio:init` for public read policy on `bpa-pets`.

---

## Ops checklist

```bash
# After pull / path fix
npm run dev          # or npm run build && npm start
npm run minio:init   # once per new MinIO volume
node scripts/repair-media-urls.mjs   # optional URL sync from keys
```

---

## Summary

| Item | Detail |
|------|--------|
| **Root cause** | Wrong relative depth (`../../../` vs `../../../../`) |
| **Missing files** | None |
| **Imports fixed** | 2 files |
| **Files recreated** | 0 |
| **Backend start** | OK after path correction |
