# BPA API v8.1.1 Final

## Required env (.env)
- PORT=3000
- DATABASE_URL=...
- AWS_BUCKET_NAME=bpa-pets (or your bucket)
- AWS_ENDPOINT=http://bpa-storage:9000 (docker internal) OR http://localhost:9000
- MINIO_PUBLIC_URL=http://192.168.10.111:9000
- AWS_ACCESS_KEY_ID=admin
- AWS_SECRET_ACCESS_KEY=password123
- AWS_FORCE_PATH_STYLE=true

## Run (docker)
docker compose down
docker compose build
docker compose up -d

## MinIO Bucket Public
MinIO Console -> Buckets -> (your bucket) -> Access -> Anonymous -> Read Only
