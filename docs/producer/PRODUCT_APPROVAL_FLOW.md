# Producer Product Approval Flow (BPA Standard)

## Expected flow

| Step | Who | Action | Product status |
|------|-----|--------|----------------|
| 1 | Staff | Create product, submit for approval | DRAFT → **SUBMITTED** |
| 2 | Owner | Internal review: approve | **UNDER_REVIEW** (product locked for owner) |
| 2 | Owner | Reject | **REJECTED** |
| 3 | Platform Admin | Final approve (Admin Panel) | **ACTIVE** |
| 3 | Platform Admin | Reject | **REJECTED** |

- **Batch create / Code generate** are allowed only when product status is **ACTIVE** (after platform admin approval).
- Owner cannot set product to ACTIVE; only platform admin can.

## Backend implementation

- **producerApproval.service**: When owner approves a product, `AuthProduct.status` is set to **UNDER_REVIEW** (not APPROVED/ACTIVE).
- **producer.service**: `createBatch` requires `product.status === "ACTIVE"`.
- **Admin API** (Main platform):  
  - `GET /api/v1/admin/verifications/producer-products?status=UNDER_REVIEW` — list queue  
  - `GET /api/v1/admin/verifications/producer-products/:id` — get one  
  - `POST /api/v1/admin/verifications/producer-products/:id/approve` — set ACTIVE (body: `{ note? }`)  
  - `POST /api/v1/admin/verifications/producer-products/:id/reject` — set REJECTED (body: `{ reason, note? }`)

## Admin UI

- In Main Admin Panel, add a **Producer Products** (or **Product Authenticity Queue**) section that:
  - Lists products with `status=UNDER_REVIEW`.
  - Allows viewing product details and proofs, then Approve (→ ACTIVE) or Reject (→ REJECTED with reason).
