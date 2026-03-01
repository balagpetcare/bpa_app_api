# Admin Governance Products

Admin product-centric list, detail, and actions for producer products (Governance Products). Uses the same permission as the approvals queue (`admin.approvals.manage`).

## API Endpoints

Base path: `/api/v1/admin/governance`. All require auth + admin + `admin.approvals.manage`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/governance/products` | List products with filters, pagination, facets |
| GET | `/admin/governance/products/:id` | Full product detail for admin review |
| POST | `/admin/governance/products/:id/actions` | Perform action (APPROVE, DECLINE, REJECT, RESET_TO_UNAPPROVED, PUBLISH, UNPUBLISH) |

### GET `/admin/governance/products`

**Query params:**

- `status` — `ALL` \| `UNAPPROVED` \| `SUBMITTED` \| `APPROVED` \| `DECLINED` \| `REJECTED` (default: `ALL`)
- `producerOrgId` — optional; filter by producer org ID
- `q` — search by product name, SKU, or producer name
- `page`, `limit` — pagination (default limit 20, max 100)
- `sortBy` — `createdAt` \| `updatedAt` \| `name` (default: `createdAt`)
- `sortDir` — `asc` \| `desc` (default: `desc`)

**Response:** `{ items, page, limit, total, facets: { statusCounts } }`. Each item includes `productId`, `name`, `sku`, `producerOrgId`, `producerOrgName`, `currentStatus`, `submittedAt`, `reviewedAt`, `reviewedBy`, `isActive`, `createdAt`, `updatedAt`.

### GET `/admin/governance/products/:id`

**Response:** Full product payload including producer org, proofs/media, approval id/status/note, timestamps.

### POST `/admin/governance/products/:id/actions`

**Body:** `{ action: "APPROVE" | "DECLINE" | "REJECT" | "RESET_TO_UNAPPROVED" | "PUBLISH" | "UNPUBLISH", note?: string }`.

- For `REJECT`, `note` is required (min 5 characters).
- Audit: `admin.governance.product.action` with metadata `action`, `oldStatus`, `newStatus`, `note`.

## UI Routes (Admin panel)

- **List:** `/admin/producer-governance/products` — tabs by status, search, producer filter, table with row actions (View, Approve, Decline, Reject, Publish, Unpublish, Reset).
- **Detail:** `/admin/producer-governance/products/[id]` — product info, media, producer link, action panel.

Admin sidebar: **Admin → Producer Governance → Products** (same section as Approvals, Batch Control, etc.).

## Status mapping rules

Governance “current status” is derived from `AuthProduct.status` and the latest `ProducerApproval` (entityType PRODUCT, entityId = product id):

- **UNAPPROVED** — No approval row for this product (never submitted or draft).
- **SUBMITTED** — Approval row exists with status `SUBMITTED`.
- **APPROVED** — Approval row status `APPROVED` (product may be `UNDER_REVIEW` or `ACTIVE`).
- **DECLINED** — Product status `CHANGES_REQUESTED` (admin requested changes).
- **REJECTED** — Approval status `REJECTED` or product status `REJECTED`.

`statusCounts` in list response reflects counts per derived status (UNAPPROVED, SUBMITTED, APPROVED, DECLINED, REJECTED).

## Route probe

To confirm the governance products routes are mounted:

- **GET** `/api/v1/__route_probe/admin-governance-products` — returns `200` and `{ ok: true }`.

## Permissions UX

- 403 responses: frontend shows a human-friendly message (e.g. “You do not have permission to view governance products. You need admin.approvals.manage.”) and does not show raw JSON.

## Manual test checklist

1. **Mount:** `GET /api/v1/__route_probe/admin-governance-products` → 200, `{ ok: true }`.
2. **List (no auth):** `GET /api/v1/admin/governance/products` without cookie → 401.
3. **List (with admin + permission):** 200, `items`, `facets.statusCounts`, `total`.
4. **List filters:** `?status=SUBMITTED`, `?producerOrgId=1`, `?q=foo`, `?page=1&limit=10`, `?sortBy=name&sortDir=asc` — all applied correctly.
5. **Detail:** `GET /api/v1/admin/governance/products/:id` — 200 with full product and producer; 404 for invalid id.
6. **Actions:** `POST /api/v1/admin/governance/products/:id/actions` with `{ action: "APPROVE" }` (or REJECT with `note` ≥ 5 chars) — 200 and product/approval state updated; audit event created.
7. **UI:** Open `/admin/producer-governance/products` — list loads; status tabs and search work; View opens detail; actions from list or detail complete without 404.
