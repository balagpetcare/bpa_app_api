# Backblaze B2 Storage Implementation Report

**Date:** 2026-06-05  
**Plan:** `docs/plans/backblaze-b2-migration-plan.md`  
**Status:** Implemented

---

## Summary

Implemented a **storage provider architecture** supporting **MinIO** (development) and **Backblaze B2** (production) behind a single S3-compatible adapter. All existing upload APIs and database schemas are unchanged. Runtime provider selection uses `STORAGE_PROVIDER=minio|b2`.

---

## What was built

### New modules

| File | Purpose |
|------|---------|
| `src/infrastructure/storage/storage.types.ts` | Provider interface types |
| `src/infrastructure/storage/storage.config.ts` | Env resolution (`AWS_*`, `S3_*`, `STORAGE_PROVIDER`) |
| `src/infrastructure/storage/s3Compatible.provider.ts` | MinIO + B2 implementation (Put/Get/Delete/Head/presign) |
| `src/infrastructure/storage/storage.factory.ts` | Singleton `getStorageProvider()` |
| `src/infrastructure/storage/storage.bootstrap.ts` | Startup validation + HeadBucket check |
| `src/shared/storage/fileAccessUrl.ts` | Private doc URLs (presigned or JWT proxy) |
| `src/infrastructure/storage/storage.config.test.ts` | Unit tests for config resolution |
| `scripts/storage-env.mjs` | Shared env helper for CLI scripts |
| `docs/integrations/storage-providers.md` | Operator documentation |

### Updated modules

| File | Change |
|------|--------|
| `src/config/appConfig.ts` | `storage` block delegates to `resolveStorageConfig()` |
| `src/infrastructure/storage/s3Client.ts` | Thin backward-compat export from factory |
| `src/api/v1/modules/media/media.service.ts` | Uses `getStorageProvider()` instead of raw SDK |
| `src/controllers/files.controller.ts` | Uses provider `getObject()` |
| `src/services/presign.service.ts` | Uses provider `getSignedGetUrl()` |
| `src/infrastructure/storage/s3Upload.ts` | Uses provider |
| `src/shared/storage/publicMediaUrl.ts` | Uses provider for URL building |
| `src/middlewares/optionalAuth.ts` | Validates `?token=` FILE_VIEW JWT |
| `src/api/v1/modules/owner/owner.controller.ts` | `buildPrivateFileAccessUrl()` for KYC docs |
| `src/api/v1/modules/doctor/doctorVerification.controller.ts` | Same |
| `src/api/v1/modules/admin_verifications/admin_verifications.controller.ts` | Same (async) |
| `src/controllers/ownerKyc.presign.patch.ts` | Updated to use shared helper |
| `src/index.ts` | `bootstrapStorage()` on startup |
| `scripts/init-minio.ts` | Skips when `STORAGE_PROVIDER=b2` |
| `scripts/repair-media-urls.mjs` | Provider-aware bucket/public base |
| `scripts/audit-media-urls.mjs` | Provider-aware logging |
| `scripts/test-minio-upload.mjs` | Provider-aware smoke test |
| `scripts/list-minio-objects.mjs` | Provider-aware listing |
| `package.json` | `storage:init`, `storage:test-upload` |
| `docker-compose.yml` | Uses `storage:init` |
| `.env.example` | MinIO + B2 blocks; secrets redacted |
| `docs/DEPLOYMENT_CHECKLIST_FINAL.md` | Storage deployment steps |
| `DISASTER-RECOVERY-PLAYBOOK.md` | B2 provider note |

---

## Provider configuration

### MinIO (development)

```env
STORAGE_PROVIDER=minio
AWS_REGION=us-east-1
AWS_BUCKET_NAME=bpa-pets
AWS_ENDPOINT=http://localhost:9000
STORAGE_PUBLIC_URL=http://192.168.x.x:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_FORCE_PATH_STYLE=true
```

### Backblaze B2 (production)

```env
STORAGE_PROVIDER=b2
S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
S3_REGION=us-east-005
S3_BUCKET=bpa-production-media
S3_ACCESS_KEY=<application_key_id>
S3_SECRET_KEY=<application_key>
S3_FORCE_PATH_STYLE=true
STORAGE_PUBLIC_URL=https://f000.backblazeb2.com/file/bpa-production-media
```

---

## Preserved behavior

| Area | Status |
|------|--------|
| `POST /api/v1/media/upload` | Unchanged |
| `GET /api/v1/media/my` | Unchanged |
| `DELETE /api/v1/media/:id` | Unchanged |
| `GET /api/v1/files/*` | Unchanged (+ `?token=` now works) |
| Prisma `media` schema | Unchanged |
| Upload folders (avatars, KYC, clinical-items, etc.) | Unchanged |
| Campaign certificates / QR | Still runtime-generated (no object storage) |
| Org legal docs local disk | Unchanged (future migration optional) |
| Hash-based media deduplication | Unchanged |

---

## Signed URLs

| Use case | Behavior |
|----------|----------|
| Public feed / avatars | Direct public URL (`buildPublicMediaUrl`) |
| Private KYC / verification | `buildPrivateFileAccessUrl()` |
| MinIO default | API proxy ` /api/v1/files/{key}?token=` (JWT) |
| B2 default | S3 presigned GET URL (`STORAGE_USE_PRESIGNED_PRIVATE_URLS` defaults true for b2) |
| Override | `STORAGE_USE_PRESIGNED_PRIVATE_URLS=true|false` |

`optionalAuth` now validates FILE_VIEW JWT from query string, fixing broken `<img>` previews when using proxy mode.

---

## Startup validation

On API boot (`storage.bootstrap.ts`):

1. Validates provider-specific required fields
2. B2: requires `STORAGE_PUBLIC_URL` / `MINIO_PUBLIC_URL` and valid endpoint host
3. `HeadBucket` connectivity check (skipped with `STORAGE_SKIP_STARTUP_CHECK=true`)
4. **Production:** throws on validation failure
5. **Development:** warns and continues (MinIO may not be running yet)

---

## Testing

```bash
npm test -- --testPathPattern=storage.config.test   # 6 tests passed
npm run storage:test-upload                          # manual smoke (needs running storage)
npm run storage:init                                 # MinIO bucket init only
```

---

## Deployment checklist

1. Set `STORAGE_PROVIDER=b2` and `S3_*` in production env
2. Set `STORAGE_PUBLIC_URL` to CDN or B2 download-friendly base
3. Create B2 bucket + public access + CORS in Backblaze console
4. Sync objects from MinIO → B2 (`rclone` / `aws s3 sync`)
5. Deploy API; verify `[Storage] provider=b2` in logs
6. Run `node scripts/repair-media-urls.mjs`
7. Run `node scripts/audit-media-urls.mjs`
8. Update Flutter `MEDIA_BASE_URL` to match `STORAGE_PUBLIC_URL`

---

## Known limitations / follow-ups

1. **Organization legal documents** still use local disk (`uploads/org-docs/`) — not migrated to B2 in this change.
2. **EMR / lab `fileUrl`** fields remain client-supplied strings — no storage integration.
3. **Formal `StorageProvider` interface** is documented in types; runtime uses duck-typed class (CommonJS compatible).
4. **B2 bucket init** is manual — `storage:init` intentionally skips for `b2`.
5. Rotate any B2 keys that were previously committed in `.env.example` before production.

---

## File tree (storage layer)

```
src/infrastructure/storage/
  storage.types.ts
  storage.config.ts
  storage.config.test.ts
  s3Compatible.provider.ts
  storage.factory.ts
  storage.bootstrap.ts
  s3Client.ts          # backward compat
  s3Upload.ts

src/shared/storage/
  publicMediaUrl.ts
  fileAccessUrl.ts
```

---

*Implementation complete. No Prisma migrations required.*
