# Payment Transaction Log Table Fix

**Date:** 2026-06-03  
**Error:** Prisma `P2021` — table `public.payment_transaction_logs` does not exist  
**Status:** Resolved

---

## Root Cause

The Prisma model `PaymentTransactionLog` and its migration were already present in the repository, but **the migration had never been deployed** to the local PostgreSQL database (`bpa_pet_db`).

`prisma migrate status` reported two pending migrations:

| Migration | Purpose |
|-----------|---------|
| `20260603120000_campaign_checkout_session` | Campaign checkout sessions + related booking columns |
| `20260603140000_payment_transaction_log` | Creates `payment_transaction_logs` table |

The backend failed at startup when the in-process **payment recovery job** called `prisma.paymentTransactionLog.findMany()` / `.create()` via `paymentRecovery.service.ts` and `paymentTransaction.service.ts`.

This was **not** a missing migration file or a failed migration — it was **migration never deployed** after the code was added.

---

## Investigation Summary

### Prisma model (`prisma/schema.prisma`)

```prisma
model PaymentTransactionLog {
  id             Int      @id @default(autoincrement())
  orderId        Int?
  provider       String   @db.VarChar(32)
  referenceId    String   @db.VarChar(128)
  providerTxId   String?  @db.VarChar(128)
  eventId        String?  @db.VarChar(256)
  phase          String   @db.VarChar(24)
  status         String   @db.VarChar(24)
  amount         Decimal? @db.Decimal(12, 2)
  requestJson    Json?
  responseJson   Json?
  errorMessage   String?
  idempotencyKey String?  @db.VarChar(128)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  order          Order?   @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([referenceId])
  @@index([providerTxId])
  @@index([orderId])
  @@index([status, phase, createdAt])
  @@map("payment_transaction_logs")
}
```

### Migration found

**Path:** `prisma/migrations/20260603140000_payment_transaction_log/migration.sql`

The migration SQL matches the Prisma model exactly (columns, types, indexes, FK).

### Schema vs database (before fix)

| Item | Prisma schema | PostgreSQL (before) |
|------|---------------|---------------------|
| Table `payment_transaction_logs` | Expected | **Missing** |
| Indexes (4) | Expected | **Missing** |
| FK `orderId` → `orders.id` ON DELETE SET NULL | Expected | **Missing** |
| Migration record in `_prisma_migrations` | Expected | **Not applied** |

**Difference:** Entire table absent; no partial drift within the table itself.

### Related services

- `src/api/v1/payments/paymentTransaction.service.ts` — CRUD for audit logs
- `src/api/v1/payments/paymentRecovery.service.ts` — recovery job queries/writes logs
- `src/index.ts` — schedules `runPaymentRecoveryJob()` on startup and every 10 minutes

---

## Fix Applied

No new migration was required. The existing migration was deployed using the project's standard workflow:

```bash
npm run prisma:migrate:deploy
# equivalent: node scripts/run-local-prisma.cjs migrate deploy
```

**Applied migrations:**

1. `20260603120000_campaign_checkout_session`
2. `20260603140000_payment_transaction_log`

**Strategy:** `migrate deploy` (not `db push`) — consistent with `package.json` scripts (`prisma:migrate`, `bootstrap:deploy`, `db:deploy`).

---

## Verification

### Migration status

```
Database schema is up to date!
258 migrations found in prisma/migrations
```

### SQL query

```sql
SELECT * FROM payment_transaction_logs LIMIT 1;
```

**Result:** Success (0 rows — empty table, as expected for a new audit log).

### Indexes created

- `payment_transaction_logs_pkey`
- `payment_transaction_logs_referenceId_idx`
- `payment_transaction_logs_providerTxId_idx`
- `payment_transaction_logs_orderId_idx`
- `payment_transaction_logs_status_phase_createdAt_idx`

### Foreign key

- `payment_transaction_logs_orderId_fkey` → `orders(id)` ON UPDATE CASCADE ON DELETE SET NULL

### Payment recovery job

```text
paymentRecovery OK: {"verified":0,"expired":0,"errors":0}
```

### Backend restart

Server started cleanly on a test port with no `P2021` errors. Payment recovery runs on startup without Prisma table errors.

---

## Prevention

After pulling migrations that add new tables:

```bash
cd backend-api
npm run prisma:migrate:deploy
npm run prisma:generate   # if client is stale
```

For local bootstrap:

```bash
npm run bootstrap:deploy
```

---

## Files Reference

| File | Role |
|------|------|
| `prisma/schema.prisma` | `PaymentTransactionLog` model |
| `prisma/migrations/20260603140000_payment_transaction_log/migration.sql` | DDL for table |
| `src/api/v1/payments/paymentTransaction.service.ts` | Log create/update/query |
| `src/api/v1/payments/paymentRecovery.service.ts` | Recovery job consumer |
