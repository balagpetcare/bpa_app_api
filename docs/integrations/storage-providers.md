# Storage Providers — MinIO & Backblaze B2

**Last updated:** 2026-06-05

The BPA API uses a pluggable **S3-compatible storage provider** for media uploads (avatars, posts, KYC, products, clinical items, etc.).

## Provider selection

```env
STORAGE_PROVIDER=minio   # local development (Docker MinIO)
STORAGE_PROVIDER=b2        # production (Backblaze B2 S3-compatible API)
```

## Architecture

```
appConfig.storage
  → storage.config (env resolution)
  → storage.factory.getStorageProvider()
  → s3Compatible.provider (Put/Get/Delete/Head + presigned URLs)
```

**Entry points (unchanged APIs):**

| Flow | Module |
|------|--------|
| Upload / delete | `media.service.ts` |
| Public URLs | `publicMediaUrl.ts` |
| Private KYC stream | `GET /api/v1/files/*` → `files.controller.ts` |
| Private preview URLs | `fileAccessUrl.ts` (presigned or JWT proxy) |

## MinIO (development)

```env
STORAGE_PROVIDER=minio
AWS_REGION=us-east-1
AWS_BUCKET_NAME=bpa-pets
AWS_ENDPOINT=http://bpa-storage:9000
STORAGE_PUBLIC_URL=http://192.168.x.x:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_FORCE_PATH_STYLE=true
```

**Initialize bucket (public read for feed images):**

```bash
npm run storage:init
```

Docker Compose runs `storage:init` automatically before `npm run dev`.

## Backblaze B2 (production)

```env
STORAGE_PROVIDER=b2
S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
S3_REGION=us-east-005
S3_BUCKET=bpa-production-media
S3_ACCESS_KEY=YOUR_KEY_ID
S3_SECRET_KEY=YOUR_APPLICATION_KEY
S3_FORCE_PATH_STYLE=true
STORAGE_PUBLIC_URL=https://f000.backblazeb2.com/file
```

Production template: `.env.production.example`

**Notes:**

- Create the bucket and public access rules in the **Backblaze console** — `storage:init` skips when `STORAGE_PROVIDER=b2`.
- `STORAGE_PUBLIC_URL` must be a **client-reachable** download URL or CDN — not the S3 API endpoint.
- Private KYC documents default to **presigned URLs** on B2 (`STORAGE_USE_PRESIGNED_PRIVATE_URLS` defaults to true for b2).

## Environment variable reference

| Variable | MinIO | B2 | Description |
|----------|-------|-----|-------------|
| `STORAGE_PROVIDER` | `minio` | `b2` | Provider selector |
| `AWS_*` | Primary | Fallback | MinIO credentials / endpoint |
| `S3_*` | Fallback | Primary | B2 credentials / endpoint |
| `STORAGE_PUBLIC_URL` | Yes | **Required** | Public media base URL |
| `MINIO_PUBLIC_URL` | Yes | Alias | Legacy alias for public URL |
| `STORAGE_USE_COUNTRY_PREFIX` | Both | Both | Key prefix `BD/`, etc. |
| `STORAGE_SKIP_STARTUP_CHECK` | Optional | Optional | Skip HeadBucket on boot |
| `STORAGE_USE_PRESIGNED_PRIVATE_URLS` | `false` default | `true` default | KYC preview URL mode |

## Startup validation

On API boot, `storage.bootstrap.ts`:

1. Validates required config per provider
2. Runs `HeadBucket` (unless `STORAGE_SKIP_STARTUP_CHECK=true`)
3. Logs warnings for missing public URL (MinIO dev)
4. **Fails in production** if B2 config is invalid

## Operations scripts

```bash
npm run storage:init          # MinIO bucket + public policy
npm run storage:test-upload   # PutObject + public GET smoke test
node scripts/audit-media-urls.mjs
node scripts/repair-media-urls.mjs
node scripts/list-minio-objects.mjs
```

## Client configuration

- **Flutter:** `--dart-define=MEDIA_BASE_URL=<STORAGE_PUBLIC_URL>` (no bucket in host; path includes bucket)
- **Web panels:** Public media from API responses; KYC may use presigned URLs on B2

## Migration from MinIO to B2

See `docs/plans/backblaze-b2-migration-plan.md` and `docs/reports/backblaze-b2-implementation-report.md`.
