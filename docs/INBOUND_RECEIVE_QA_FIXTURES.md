# QA fixtures — Receive Center (unified inbound)

The main `prisma/seed.ts` pipeline does **not** create `StockTransfer` / `StockDispatch` rows (master data only). Use one of the flows below to populate **incoming-unified** for manual or automated checks.

## Preferred: owner stock-request fulfill (transfer path)

1. As **branch staff**, create and submit a stock request for a branch that has a destination inventory location.
2. As **org owner**, open **Owner → Inventory → Stock requests → [id]**.
3. Choose **from** central warehouse location and **to** the branch’s receiving location; set fulfill quantities; **Fulfill / dispatch**.
4. Backend creates a **StockTransfer**, sends it → status **IN_TRANSIT** (or **SENT**).
5. As **branch staff** with `inventory.receive`, open **Receive Center** (`/staff/branch/[branchId]/inventory/receive`). The row should appear as **Transfer**.

## Dispatch path (challan)

1. **Direct dispatch** (`POST /api/v1/inventory/direct-dispatch`) or **pick handoff** → creates `StockDispatch` in **CREATED**.
2. Call **send dispatch** (`POST /api/v1/inventory/dispatches/:id/send`) so status becomes **IN_TRANSIT**.
3. Receive Center shows **Dispatch**; receive uses dispatch API (GRN + ledger).

## Optional seed diagnostics

With `SEED_INBOUND_RECEIVE_QA=true`, `prisma/seed.ts` runs `seedInboundReceiveQaFixtures`, which logs counts of orgs and in-transit rows (no writes). Use it to confirm a DB already has data before UI testing.

```bash
set SEED_INBOUND_RECEIVE_QA=true
npm run db:seed
```

## API smoke

```http
GET /api/v1/inventory/receipts/incoming-unified?branchId=<branchId>
Authorization: Bearer <token>
```

Expect `success: true` and `data: [{ kind, id, status, receivable, items, ... }]`.
