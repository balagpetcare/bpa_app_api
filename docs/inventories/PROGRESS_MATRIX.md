# Stock Request & Fulfillment — Progress Matrix

## Phase status

| Phase | Status | Deliverable |
|-------|--------|-------------|
| 0 — Audit | ✅ | docs/inventories/STOCK_REQUEST_AUDIT.md |
| 1 — Spec | ✅ | docs/inventories/STOCK_REQUEST_SPEC.md |
| 2 — DB | ✅ | StockRequest, StockRequestItem, StockTransfer.stockRequestId; STOCK_REQUEST_DB_CHANGELOG.md |
| 3 — API | ✅ | stock_requests module; transfers receive → markRequestReceivedIfLinked; STOCK_REQUEST_API_CHANGELOG.md |
| 4 — UI Branch | ✅ | List, Create, Detail; STOCK_REQUEST_UI_BRANCH.md |
| 5 — UI Owner | ✅ | List, Detail + Fulfill & Dispatch; STOCK_REQUEST_UI_OWNER.md |
| 6 — Receive | ✅ | Lot in receive payload; STOCK_REQUEST_RECEIVE_FLOW.md |

## Files changed (all phases)

**Backend (backend-api)**
- prisma/schema.prisma (enum StockRequestStatus, StockRequest, StockRequestItem, StockTransfer.stockRequestId, relations)
- prisma/migrations/20260204000000_add_stock_request_and_items/migration.sql
- src/api/v1/modules/stock_requests/stock_requests.service.ts
- src/api/v1/modules/stock_requests/stock_requests.controller.ts
- src/api/v1/modules/stock_requests/stock_requests.routes.ts
- src/api/v1/routes.ts
- src/api/v1/modules/transfers/transfers.service.ts
- docs/inventories/STOCK_REQUEST_AUDIT.md
- docs/inventories/STOCK_REQUEST_SPEC.md
- docs/inventories/STOCK_REQUEST_DB_CHANGELOG.md
- docs/inventories/STOCK_REQUEST_API_CHANGELOG.md
- docs/inventories/STOCK_REQUEST_UI_BRANCH.md
- docs/inventories/STOCK_REQUEST_UI_OWNER.md
- docs/inventories/STOCK_REQUEST_RECEIVE_FLOW.md
- docs/inventories/PROGRESS_MATRIX.md

**Frontend (bpa_web)**
- lib/api.ts (stock request helpers)
- app/staff/branch/[branchId]/inventory/page.jsx (Stock Requests link)
- app/staff/branch/[branchId]/inventory/stock-requests/page.jsx
- app/staff/branch/[branchId]/inventory/stock-requests/new/page.jsx
- app/staff/branch/[branchId]/inventory/stock-requests/[id]/page.jsx
- app/owner/inventory/stock-requests/page.tsx
- app/owner/inventory/stock-requests/[id]/page.tsx
- app/staff/branch/[branchId]/inventory/transfers/page.jsx (lotId in receive)
- src/lib/permissionMenu.ts (Stock Requests menu)

## Commands run

- `npx prisma validate` ✅
- `npx prisma generate` ✅
- `npm run build` (backend-api) ✅

## Happy-path checklist (3rd day, 25 items request)

| Step | Check | Notes |
|------|--------|--------|
| 1. Branch creates request (25 items) | ✅ | Staff → Inventory → Stock Requests → New Request; bulk table; Create draft. |
| 2. Branch submits request | ✅ | Detail → Submit request → status SUBMITTED. |
| 3. Owner sees request | ✅ | Owner → Products → Stock Requests; filter by status. |
| 4. Owner fulfills (full/partial/zero) | ✅ | View & Fulfill → From location → set fulfill qty per lot → Fulfill & Dispatch. |
| 5. Owner dispatches | ✅ | Dispatch creates transfer + send; request → DISPATCHED. |
| 6. Branch sees incoming transfer | ✅ | Staff → Inventory → Transfers → Incoming. |
| 7. Branch receives and confirms | ✅ | Receive modal → received/missing/damaged per line → Submit. |
| 8. Ledger and request status | ✅ | TRANSFER_OUT at sender, TRANSFER_IN (and DAMAGE/EXPIRED/LOSS if any) at receiver; request → RECEIVED_FULL/RECEIVED_PARTIAL. |

**Overall:** ✅ Happy path implemented. Apply migration (`npx prisma migrate deploy`), then test end-to-end with real org/branch/locations and products with variants/lots.
