# MinIO endpoint hostname note (Windows/Docker)

If you see errors like:

- `InvalidRequest: Invalid Request (invalid hostname)`

while uploading to MinIO via the AWS S3 SDK, the most common cause is **an underscore in the MinIO hostname** (for example `bpa_storage`).

The S3/MinIO request validator may reject host headers that contain underscores.

## Fix

Use a DNS-safe hostname (letters, numbers, hyphens), e.g. `bpa-storage`.

Example `docker-compose.yml` change:

```yaml
services:
  bpa-storage:
    image: minio/minio:latest
    container_name: bpa-storage
    ...
```

And set:

```env
AWS_ENDPOINT=http://bpa-storage:9000
```

The API already uses `forcePathStyle: true` in `src/infrastructure/storage/s3Client.js`.
