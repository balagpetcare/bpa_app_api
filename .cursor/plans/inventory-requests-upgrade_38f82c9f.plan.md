---
name: inventory-requests-upgrade
overview: Implement scalable Owner-centric inventory flow (Warehouse main stock → Branch Stock Requests → Owner fulfill/dispatch with partial + extra items), plus a unified Requests Hub and an Inventory-first Owner sidebar—reusing existing ledger + StockRequest/Transfer models with minimal breaking changes.
todos:
  - id: scan-and-docs
    content: Write Step-1 factual reports into `bpa_web/docs/inventory/*` deliverable files with concrete code-path references.
    status: completed
  - id: sidebar-map
    content: "Restructure Owner sidebar: add Inventory main dropdown + keep Requests hub; update badge injection if needed."
    status: pending
  - id: owner-requests-ui
    content: Update `/owner/requests` UI to include STOCK_REQUEST kind and correct routing; keep WowDash patterns.
    status: completed
  - id: owner-product-requests-ui
    content: Switch `/owner/product-requests/*` UI to real `product-change-requests` APIs; add detail view improvements.
    status: completed
  - id: owner-stock-request-ui-enhance
    content: "Enhance `/owner/inventory/stock-requests/[id]`: decline action + add-extra-products fulfillment via FEFO lots."
    status: completed
  - id: owner-inventory-new-pages
    content: Add `/owner/inventory/warehouse`, `/owner/inventory/receipts`, `/owner/inventory/batches` pages with location selector and empty states.
    status: pending
  - id: backend-owner-inbox-real
    content: Replace mock `GET /api/v1/owner/requests` with real aggregated inbox + `summary=1` counts.
    status: completed
  - id: backend-owner-product-requests-real
    content: Replace mock `/api/v1/owner/product-requests*` by mapping to `ProductChangeRequest` + enforce org scoping.
    status: pending
  - id: backend-notifications
    content: Emit in-app notifications on StockRequest submit and ProductChangeRequest create (NotificationType.SYSTEM).
    status: completed
  - id: wire-adjustments
    content: Wire Owner adjustments list page to backend `StockAdjustmentRequest` endpoints and ensure filters/status badges work.
    status: completed
  - id: optional-ledger-endpoint
    content: If warehouse/receipt pages need audit trail, add `GET /api/v1/inventory/ledger` using existing ledgerService.getLedgerHistory.
    status: pending
isProject: false
---

# Inventory Requests Upgrade

## Current state (factual touchpoints)

### Frontend (Next.js `D:/BPA_Data/bpa_web`)

- **Owner sidebar registry**: `[D:/BPA_Data/bpa_web/src/lib/permissionMenu.ts](D:/BPA_Data/bpa_web/src/lib/permissionMenu.ts)` (Owner menu + fallback), rendered in `[D:/BPA_Data/bpa_web/src/masterLayout/MasterLayout.jsx](D:/BPA_Data/bpa_web/src/masterLayout/MasterLayout.jsx)`.
- **Owner Inventory**: `[D:/BPA_Data/bpa_web/app/owner/inventory/page.tsx](D:/BPA_Data/bpa_web/app/owner/inventory/page.tsx)` calls `GET /api/v1/inventory` + `GET /api/v1/inventory/alerts`, can create adjustment requests via `POST /api/v1/inventory/adjustment-requests`.
- **Owner Stock Requests**:
  - List: `[D:/BPA_Data/bpa_web/app/owner/inventory/stock-requests/page.tsx](D:/BPA_Data/bpa_web/app/owner/inventory/stock-requests/page.tsx)` calls `GET /api/v1/stock-requests?orgId=...`.
  - Detail/dispatch: `[D:/BPA_Data/bpa_web/app/owner/inventory/stock-requests/[id]/page.tsx](D:/BPA_Data/bpa_web/app/owner/inventory/stock-requests/[id]/page.tsx)` uses `GET /api/v1/inventory/locations`, `GET /api/v1/stock-requests/:id?fromLocationId=...`, dispatch via `POST /api/v1/stock-requests/:id/dispatch`.
  - Documented: `[D:/BPA_Data/bpa_web/docs/inventory/STOCK_REQUEST_UI_OWNER.md](D:/BPA_Data/bpa_web/docs/inventory/STOCK_REQUEST_UI_OWNER.md)`.
- **Branch (staff) Stock Requests UI already exists** under `[D:/BPA_Data/bpa_web/app/staff/branch/[branchId]/inventory/stock-requests](D:/BPA_Data/bpa_web/app/staff/branch/[branchId]/inventory/stock-requests)` (create draft → submit → cancel).
- **Owner Requests Hub UI**: `[D:/BPA_Data/bpa_web/app/owner/requests/page.tsx](D:/BPA_Data/bpa_web/app/owner/requests/page.tsx)` calls `GET /api/v1/owner/requests` but currently doesn’t include stock requests in the type filter.
- **Owner Product Requests UI**: `[D:/BPA_Data/bpa_web/app/owner/product-requests/page.jsx](D:/BPA_Data/bpa_web/app/owner/product-requests/page.jsx)` + `[D:/BPA_Data/bpa_web/app/owner/product-requests/[id]/page.jsx](D:/BPA_Data/bpa_web/app/owner/product-requests/[id]/page.jsx)` currently call **mock** endpoints `GET/POST /api/v1/owner/product-requests*`.
- **Real catalog change request UI exists elsewhere**: `[D:/BPA_Data/bpa_web/app/owner/product-approvals/page.jsx](D:/BPA_Data/bpa_web/app/owner/product-approvals/page.jsx)` uses `GET/PATCH /api/v1/owner/product-change-requests`.
- **Badge counts hook**: `[D:/BPA_Data/bpa_web/app/owner/_hooks/useEntityCounts.js](D:/BPA_Data/bpa_web/app/owner/_hooks/useEntityCounts.js)` calls `GET /api/v1/owner/requests?summary=1`.

### Backend (Express `D:/BPA_Data/backend-api`)

- **Route registration**: `[D:/BPA_Data/backend-api/src/api/v1/routes.ts](D:/BPA_Data/backend-api/src/api/v1/routes.ts)` mounts:
  - `/api/v1/inventory` → `[.../inventory.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/inventory/inventory.routes.ts)`
  - `/api/v1/stock-requests` → `[.../stock_requests.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/stock_requests/stock_requests.routes.ts)`
  - `/api/v1/transfers` → transfers module
  - `/api/v1/owner/*` → `[.../owner.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.routes.ts)`
- **Stock Requests API (already functional)**:
  - Controller/service: `[stock_requests.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/stock_requests/stock_requests.controller.ts)` + `[stock_requests.service.ts](D:/BPA_Data/backend-api/src/api/v1/modules/stock_requests/stock_requests.service.ts)`.
  - Supports draft → submit → dispatch (creates lot-backed transfer + ledger entries).
- **Transfers are lot-backed**: controller requires `lotId` per item: `[D:/BPA_Data/backend-api/src/api/v1/modules/transfers/transfers.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/transfers/transfers.controller.ts)`.
- **Ledger system exists**: `[D:/BPA_Data/backend-api/src/api/v1/modules/inventory/ledger.service.ts](D:/BPA_Data/backend-api/src/api/v1/modules/inventory/ledger.service.ts)` with `StockLedger`, `StockBalance`, `StockLotBalance`.
- **Owner Requests + Owner Product Requests APIs are currently MOCK** in `[D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.controller.ts)` (`getOwnerRequestsInbox`, `listOwnerProductRequests`, etc).
- **Catalog/Product change requests have real Prisma model + endpoints**:
  - Model: `ProductChangeRequest` in `[D:/BPA_Data/backend-api/prisma/schema.prisma](D:/BPA_Data/backend-api/prisma/schema.prisma)`.
  - Endpoints: `/api/v1/owner/product-change-requests` in `[owner.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.routes.ts)`.
  - Branch creates: `POST /api/v1/branches/:branchId/product-change-requests` in `[branches.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/branches/branches.controller.ts)`.
- **Notifications service exists**: `[D:/BPA_Data/backend-api/src/api/v1/services/notification.service.ts](D:/BPA_Data/backend-api/src/api/v1/services/notification.service.ts)`.

## Key gaps to close

- **Owner Requests Hub backend** (`GET /api/v1/owner/requests`) is mock → must become a real unified inbox.
- **Owner Product Requests backend** (`/api/v1/owner/product-requests`) is mock → must be wired to `ProductChangeRequest`.
- **Owner Product Change Requests endpoints lack org scoping checks** (currently filter only by status).
- **Owner Stock Request detail UI** lacks:
  - Decline action
  - Add-extra-products during fulfillment
- **Owner Inventory sidebar** needs restructuring to make Inventory the main group with children.
- **Owner Adjustments list UI** is placeholder sample data; backend has real `StockAdjustmentRequest` endpoints.
- **Transfer “New” UI** currently doesn’t collect `lotId` (backend requires lot allocations).
- **Notifications**: no notification is emitted on StockRequest submit (and optionally ProductChangeRequest create).

## Decisions (self-decide, minimal breakage)

- **Requests storage**: keep existing separate tables (`StockRequest`, `ProductChangeRequest`, `StockAdjustmentRequest`, `ReturnRequest`, etc.) and implement **aggregation** for `/api/v1/owner/requests`.
- **Inventory/ledger**: reuse existing immutable ledger (`StockLedger` + balances). Do not introduce a second movement system.
- **Warehouse concept**: treat “warehouse/main stock” as a **selected InventoryLocation** (often a central branch’s location). UI will include a location picker; no new DB type required.
- **Decline**: implement as `StockRequest.status = CANCELLED` (Owner-initiated cancel) with optional follow-up to add a note field later if needed.

## Implementation phases

### Phase 1 — UI routes + navigation (additive)

- Update Owner sidebar registry to:
  - Add **Inventory (main)** dropdown with children:
    - `/owner/inventory` (Overview)
    - `/owner/inventory/warehouse` (location-based warehouse view)
    - `/owner/inventory/stock-requests`
    - `/owner/inventory/transfers`
    - `/owner/inventory/receipts`
    - `/owner/inventory/adjustments`
    - `/owner/inventory/batches`
  - Keep `/owner/requests` as the unified inbox for approvals.
  - Touchpoints: `[permissionMenu.ts](D:/BPA_Data/bpa_web/src/lib/permissionMenu.ts)`, `[MasterLayout.jsx](D:/BPA_Data/bpa_web/src/masterLayout/MasterLayout.jsx)`.
- Add missing Owner inventory child pages (WowDash patterns, empty states, minimal wiring):
  - `/owner/inventory/warehouse` (select location + show stock summary)
  - `/owner/inventory/receipts` (use existing `POST /api/v1/inventory/opening` initially)
  - `/owner/inventory/batches` (use `GET /api/v1/inventory/lots` + `GET /api/v1/inventory/expiring`)
- Upgrade existing pages to use real data where backend already exists:
  - Wire `[app/owner/inventory/adjustments/page.tsx](D:/BPA_Data/bpa_web/app/owner/inventory/adjustments/page.tsx)` to `GET /api/v1/owner/adjustment-requests`.
  - Upgrade `/owner/product-requests/*` pages to call `/api/v1/owner/product-change-requests` instead of mock `/owner/product-requests`.
  - Update `/owner/requests` UI to include **STOCK_REQUEST** kind and route to `/owner/inventory/stock-requests/:id`.
- Enhance Owner Stock Request detail page:
  - Add **Decline** button (calls cancel endpoint).
  - Add **Extra item** fulfillment section:
    - select variant (from `GET /api/v1/products?search=` or `limit=`)
    - load available lots via `GET /api/v1/inventory/fefo?locationId=&variantId=`
    - append those lots into dispatch allocations.

### Phase 2 — Backend: real Owner inbox + product requests wiring

- Replace mock implementation in `[owner.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.controller.ts)`:
  - Implement `getOwnerRequestsInbox` to aggregate:
    - `ProductChangeRequest` (PENDING/APPROVED/REJECTED)
    - `StockRequest` (SUBMITTED/OWNER_REVIEW/DISPATCHED/etc)
    - `StockAdjustmentRequest` (PENDING)
    - `StockTransfer` (DISPUTED, etc) (optional)
    - `Notification` unread items (optional)
  - Return shape matching frontend `InboxItem` + `meta.pendingCounts`.
  - Support `?summary=1` to return just counts (used by `useEntityCounts`).
- Replace mock Owner Product Requests endpoints by mapping them to `ProductChangeRequest`:
  - `GET /api/v1/owner/product-requests` → list `ProductChangeRequest`
  - `POST /api/v1/owner/product-requests/:id/approve|reject` → call existing approve/reject logic
  - Keep `/api/v1/owner/product-change-requests` endpoints working.
- Add strict **org scoping** to product-change-requests approve/reject/list (owner-only for orgs they own).

### Phase 3 — Notifications + “warehouse/receipts” hardening

- Emit notification on:
  - **StockRequest submit** (`POST /api/v1/stock-requests/:id/submit`) → notify org owner with actionUrl `/owner/inventory/stock-requests/:id`.
  - **ProductChangeRequest create** (branch endpoint) → notify org owner with actionUrl `/owner/product-requests/:id`.
- If needed for audit UIs, add a small inventory endpoint:
  - `GET /api/v1/inventory/ledger` → proxy `ledgerService.getLedgerHistory()`.

## Verification

- Manual checklist:
  - Branch staff creates draft → submits stock request; owner receives notification.
  - Owner sees request in `/owner/requests` and `/owner/inventory/stock-requests`.
  - Owner can dispatch partial quantities; can add extra variants; can decline (cancel).
  - Transfer gets created and can be received; StockRequest status updates on receive.
  - Owner product requests pages show real `ProductChangeRequest` data and approvals work.
  - Sidebar Inventory dropdown renders and existing routes remain reachable.

## Run commands (no port changes)

- Backend: `npm run dev` (port 3000)
- Owner UI: `npm run dev:owner` (port 3104)
- Prisma (if migrations added): `npx prisma migrate dev` then `npx prisma generate`

