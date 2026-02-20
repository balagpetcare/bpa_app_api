# Product Authenticity MVP – Apply Steps

**Scope (MVP):** ProductVersion + Batch + Serial + ScanEvent (per blueprint Section 15).
This is the *starter* implementation (not full contract/shipments).

## 1) Prisma migration

```bash
cd backend-api
npx prisma migrate dev --name product_authenticity_mvp
# or for prod:
npx prisma migrate deploy
```

## 2) Prisma generate

```bash
npx prisma generate
```

## 3) Env

Add to `.env` (example in `.env.example`):

```
AUTH_SERIAL_SIGNING_SECRET=change_me_serial_secret
```

## 4) API endpoints (MVP)

### Product version
- `POST /api/v1/products/:id/versions`
- `POST /api/v1/products/versions/:id/approve`
- `GET /api/v1/products/:id/public` *(public)*

### Batch / Serial
- `POST /api/v1/batches`
- `POST /api/v1/batches/:id/approve`
- `POST /api/v1/batches/:id/issue-serials`
- `GET /api/v1/serials/:sid/verify` *(public)*
- `POST /api/v1/serials/:sid/scan-event`

## 5) Checkpoint

1. Create version → approve → `GET /products/:id/public` returns latest approved version.
2. Create batch → approve → issue serials → verify serial by code.
3. Scan event updates `firstScanAt` on first scan.

## 6) Next steps (Phase-2)

- Contract + quota enforcement
- Shipment tracking
- Fingerprint similarity engine
- HSM/KMS signing

