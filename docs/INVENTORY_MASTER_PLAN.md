# BPA/WPA Inventory System – Central Warehouse + Branch Requests + Distribution

**Phase 0: Planning (no code changes until approved)**  
**Baseline:** `docs/OWNER_PRODUCT_INPUT_REPORT.md`  
**Goal:** Scalable Central Warehouse + Branch Requests + Distribution with Online/Offline stock separation and Batch/Expiry monitoring, aligned with StockLedger as single source of truth.

---

## 1. Current State Audit

### 1.1 Existing routes / controllers / services (products, inventory, requests, transfers, orders)

| Area | Routes file | Controller | Service | Key functions |
|------|-------------|------------|---------|----------------|
| **Products** | `src/api/v1/modules/products/products.routes.ts` | `products.controller.ts` | (inline / products.service) | `getOrgIdForUser`, list, getById, create, update, delete, variants CRUD, media, submit-for-approval, approve, reject, publish |
| **Master catalog** | Same (nested under products) | `master-catalog.controller.ts` | `master-catalog.service` | `getMasterCatalog`, `getMasterProduct`, clone, import CSV, csv-template, bd-sample |
| **Inventory** | `src/api/v1/modules/inventory/inventory.routes.ts` | `inventory.controller.ts` | `inventory.service.ts`, `ledger.service.ts` | `getInventory` (ledger v2), `getInventoryLocations`, `getInventorySummary`, `getFefoLots`, `getExpiringItems`, `getLowStockAlerts`, `createOpeningStock`, `createAdjustmentRequest`; ledger: `recordLedgerEntry`, `recordLedgerEntryInTx`, `getAvailableLotsFEFO`, `reserveFEFO`, `saleFEFO` |
| **Stock requests** | `src/api/v1/modules/stock_requests/stock_requests.routes.ts` | `stock_requests.controller.ts` | `stock_requests.service.ts` | `create`, `list`, `getById`, `updateItems`, `submit`, `cancel`, `decline`, `dispatch` (fulfillAndDispatch); list uses `orderBy: { createdAt: 'desc' }` |
| **Transfers** | `src/api/v1/modules/transfers/transfers.routes.ts` | `transfers.controller.ts` | `transfers.service.ts` | `createTransfer`, `sendTransfer` (TRANSFER_OUT ledger), `receiveTransfer` (TRANSFER_IN), `resolveDispute`; `markRequestDispatched`, `markRequestReceivedIfLinked` called from stock_requests |
| **Owner** | `src/api/v1/modules/owner/owner.routes.ts` | `owner.controller.ts` | (inline) | `getOwnerRequestsInbox`, `getOwnerRequestsPendingCounts`, `getOwnerRequestsInboxItems` (ProductChangeRequest, StockRequest, StockAdjustmentRequest, StockTransfer merged, sorted by createdAt desc); `listOwnerProductRequests`, `approveOwnerProductRequest`, `rejectOwnerProductRequest`, `createOwnerProductRequestTransfer`; `addProductToBranches`, `getBranchProductsWithInventory`, `upsertBranchProductInventory` (legacy Inventory) |
| **Orders** | Mounted in `src/api/v1/routes.ts` | `orders.controller.ts` | `orders.service.ts` | Order CRUD, status |
| **Returns** | `modules/returns/returns.routes.ts` | returns.controller | (inline) | List, approve, receive, reject |
| **Reports** | `src/api/v1/modules/reports/reports.routes.ts` | `reports.controller.ts` | (inline) | `getSalesReport`, `getStockReport`, `getRevenueAnalytics`, `getTopSellingProducts`, `getZeroSalesProducts` |
| **Vendors** | `modules/vendors/vendors.routes.ts` | vendors.controller | (inline) | Vendor CRUD (org-scoped) |
| **Pricing** | `modules/pricing/pricing.routes.ts` | pricing.controller | (inline) | LocationPrice, enable location variant |

**Mount point:** `src/api/v1/routes.ts` — `countryScopeGuard` on `/owner`, `/products`, `/inventory`, `/stock-requests`, `/transfers`, `/orders`, `/returns`, `/vendors`, `/pricing`, `/reports`.

### 1.2 Prisma models (Product, Variant, StockLedger, StockLot, Location, Branch)

| Model | Schema location (approx) | Key fields |
|-------|---------------------------|------------|
| **Product** | `prisma/schema.prisma` ~2956 | id, orgId, name, slug, status, categoryId, brandId, approvalStatus, masterCatalogId; @@unique([orgId, slug]) |
| **ProductVariant** | ~3010 | id, productId, sku @unique, title, barcode @unique, flavorId, unitId |
| **Inventory** (legacy) | ~3394 | id, branchId, productId, variantId, quantity, minStock, expiryDate — **not** locationId; deprecated for new flows |
| **InventoryLocation** | ~4047 | id, branchId, type (InventoryLocationType), name, code, isActive |
| **InventoryLocationType** | ~2846 | CLINIC, SHOP, ONLINE_HUB — **no CENTRAL_WAREHOUSE** |
| **LocationVariantConfig** | ~4075 | locationId, variantId, channel (LocationChannel), isEnabled |
| **LocationChannel** | ~2852 | POS_ONLY, ONLINE_ONLY, BOTH |
| **LocationPrice** | ~4091 | locationId, variantId, price, effectiveFrom/To |
| **StockBalance** | ~4109 | locationId, variantId, onHandQty, reservedQty (derived from ledger) |
| **StockLedger** | ~4124 | id, locationId, variantId, lotId?, type (StockLedgerType), quantityDelta, refType, refId |
| **StockLedgerType** | ~2858 | OPENING, SALE_POS, SALE_CLINIC, RESERVE_ONLINE, RELEASE_RESERVE, SALE_ONLINE, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, DAMAGE, EXPIRED, LOSS, RETURN_IN, RETURN_OUT — **no GRN_IN** |
| **StockLot** | ~4247 | id, orgId, variantId, lotCode, mfgDate, expDate; @@unique([orgId, variantId, lotCode]) |
| **StockLotBalance** | ~4275 | locationId, lotId, onHandQty, reservedQty |
| **StockTransfer** | ~4147 | id, fromLocationId, toLocationId, status, stockRequestId?, sentAt, receivedAt |
| **StockTransferItem** | ~4173 | transferId, variantId, lotId?, quantitySent, quantityReceived, quantityDamaged, quantityExpired |
| **StockRequest** | ~4197 | id, orgId, branchId, requesterUserId, status (StockRequestStatus), submittedAt, declinedAt, declineReason, declineSource, declinedByUserId |
| **StockRequestStatus** | ~2915 | DRAFT, SUBMITTED, OWNER_REVIEW, FULFILLED_PARTIAL, FULFILLED_FULL, DISPATCHED, RECEIVED_PARTIAL, RECEIVED_FULL, CLOSED, CANCELLED |
| **StockRequestItem** | ~4226 | stockRequestId, productId, variantId, requestedQty, note |
| **Branch** | ~2547 | id, orgId, name, status, types (BranchToType), inventoryLocations[], stockRequests[] |
| **BranchType** / **BranchTypeCode** | ~2640, ~2354 | WAREHOUSE_DC exists as branch type code |
| **ProductChangeRequest** | ~3149 | id, orgId, type (CREATE_PRODUCT, CREATE_VARIANT, EDIT_PRODUCT), status, requestedFromBranchId, payload |
| **Vendor** | ~4386 | id, orgId, name, contactJson, status |
| **StockAdjustmentRequest** | ~4320 | orgId, locationId, variantId, lotId?, quantityDelta, status PENDING/APPROVED/REJECTED |

**Missing today:** GRN / PurchaseOrder models; Central Warehouse location type or org-level warehouse branch flag; Catalog Enable Request (branch “enable product for sale here” without stock movement).

### 1.3 Existing UI pages / components (Owner inventory & requests)

| Route | File | Purpose |
|-------|------|--------|
| `/owner/requests` | `bpa_web/app/owner/(larkon)/requests/page.tsx` | Unified inbox: GET `/api/v1/owner/requests`; filters by kind (STOCK_REQUEST, TRANSFER, etc.) and status; links to `/owner/inventory/stock-requests/:id`, `/owner/product-requests/:id`, etc. |
| `/owner/inventory` | `app/owner/(larkon)/inventory/page.tsx` | Ledger-based list; adjustment request modal; GET `/api/v1/inventory`, `/api/v1/inventory/alerts` |
| `/owner/inventory/receipts` | `app/owner/(larkon)/inventory/receipts/page.tsx` | Opening stock form; POST `/api/v1/inventory/opening` |
| `/owner/inventory/warehouse` | `app/owner/(larkon)/inventory/warehouse/page.tsx` | Warehouse view; link to Receipts |
| `/owner/inventory/transfers` | `app/owner/(larkon)/transfers/page.tsx` | List transfers; send/receive/resolve-dispute via ownerPost |
| `/owner/inventory/transfers/[id]` | `app/owner/(larkon)/transfers/[id]/page.tsx` | Transfer detail; send/receive |
| `/owner/inventory/transfers/new` | `app/owner/(larkon)/transfers/new/page.tsx` | Create transfer; GET locations + products; POST `/api/v1/transfers` |
| `/owner/inventory/stock-requests` | `app/owner/(larkon)/inventory/stock-requests/page.tsx` | List stock requests (GET `/api/v1/stock-requests` with orgId); **sort order not explicitly newest-first in UI** (API uses createdAt desc) |
| `/owner/inventory/stock-requests/[id]` | `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | Detail: GET `/api/v1/stock-requests/:id?fromLocationId=`, locations; dispatch (POST decline or dispatch with fromLocationId, toLocationId, items); **no explicit “approve with partial” or “add extra items” step** — dispatch sends quantities per lot |
| `/owner/inventory/adjustments` | `app/owner/(larkon)/inventory/adjustments/page.tsx` | Adjustment requests list |
| `/owner/inventory/adjustments/[id]` | `app/owner/(larkon)/inventory/adjustments/[id]/page.tsx` | Adjustment detail (approve/reject) |
| `/owner/product-requests/:id` | (owner routes; detail page exists per getOwnerRequestsInbox href) | Product change request approve/decline |
| **Menu** | `bpa_web/src/lib/permissionMenu.ts` | owner.inventory.* (products, Stock, Vendors, Warehouse, Stock Requests, Transfers, Receipts, Adjustments, Batches); owner.requests.* (Inbox, Product Requests, Transfers, Adjustments, Returns, Notifications) |

**Gaps:** No dedicated “Catalog Request” (enable product for branch); no GRN/Receipts list or create; no explicit “approve with partial qty + add extra items” before dispatch; no Expiry Monitor page; Inventory not a top-level sidebar with dropdown as specified; Admin master-catalog UX (filters, search, CSV, CRUD) not found under `app/admin` (menu points to `/admin/products/master-catalog`).

---

## 2. Architecture Decision Doc

### 2.1 Domain models (target state)

| Concept | Model / entity | Description |
|---------|----------------|-------------|
| **Location** | `InventoryLocation` (existing) | Branch-scoped; type extended with CENTRAL_WAREHOUSE. One org-level “Central Warehouse” = a branch of type WAREHOUSE_DC (or dedicated flag) with at least one location of type CENTRAL_WAREHOUSE where Online stock lives. |
| **StockLot** | `StockLot` (existing) | orgId, variantId, lotCode, mfgDate, expDate. No change. |
| **StockLedger** | `StockLedger` (existing) | Single source of truth for all stock movements. Add type GRN_IN for GRN receipts. refType/refId link to Grn.id. |
| **GRN** | **New:** `Grn`, `GrnLine` | Goods Received Note: vendor, locationId (Central Warehouse), status, lines (variantId, lotId or new lot fields, quantity). Creates StockLedger GRN_IN + StockLot when needed. |
| **StockRequest** | `StockRequest` (existing) | Inventory stock request: branch requests quantities. Status flow: REQUESTED → APPROVED (new) → DISPATCHED → RECEIVED → CLOSED (or DECLINED). Add optional “approved items” (partial qty + extra items) before dispatch. |
| **TransferOrder** | `StockTransfer` (existing) | One transfer per stock request (stockRequestId). fromLocation = Central Warehouse (or specified warehouse), toLocation = branch store location. FEFO allocation on dispatch. |
| **CatalogRequest** | **New:** `CatalogEnableRequest` or extend ProductChangeRequest | Branch asks to enable a product/variant for selling at that branch (no stock). Approve → create/update LocationVariantConfig (+ optional LocationPrice) for that branch/location. |
| **BranchAssortment** | **Derived** | Set of variantIds enabled per branch/location (LocationVariantConfig + LocationPrice). No new table; “catalog enable” creates/updates these. |

### 2.2 Invariants

1. **Single source of truth:** All quantity changes go through **StockLedger**. No writes to legacy `Inventory` for new flows. StockBalance / StockLotBalance are derived and updated only by ledger.service.
2. **Online vs Offline by location:**  
   - **Online** channel: availability and reservations only from locations that are “Online” (e.g. type ONLINE_HUB or CENTRAL_WAREHOUSE; or LocationVariantConfig.channel ONLINE_ONLY/BOTH). In target design, **Online stock lives only in Central Warehouse**.  
   - **Offline (POS):** sales and stock only from branch store locations (e.g. SHOP or POS-only locations). **POS stock lives only in branch store locations.**  
3. **Central Warehouse:** At most one “Central Warehouse” location (or one warehouse branch) per org for Online fulfilment. Dispatch to branches is FROM this warehouse (FEFO).  
4. **Org/branch isolation:** All queries and mutations scoped by orgId (and branchId where applicable). RBAC: owner can approve/decline/dispatch/receive; branch staff can create requests and receive transfers for their branch.

---

## 3. API Spec

### 3.1 New or extended endpoints

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| **GRN** | | | |
| POST | `/api/v1/grn` | Create GRN (vendorId, locationId, lines[{ variantId, quantity, lotCode?, mfgDate?, expDate? }]) | inventory.update / org.write |
| GET | `/api/v1/grn` | List GRNs (org; locationId, vendorId, status, dateFrom, dateTo; newest first) | inventory.read |
| GET | `/api/v1/grn/:id` | GRN detail with lines | inventory.read |
| PATCH | `/api/v1/grn/:id` | Update GRN (draft only) | inventory.update |
| POST | `/api/v1/grn/:id/receive` | Confirm GRN → create StockLedger GRN_IN + StockLot as needed | inventory.update |
| **Stock Request (extend)** | | | |
| POST | `/api/v1/stock-requests/:id/approve` | Owner approve; body: approvedItems[{ variantId, approvedQty }], extraItems[{ variantId, quantity }] (optional). Status → OWNER_REVIEW or APPROVED. Optional: create draft transfer. | Owner (org) |
| GET | `/api/v1/stock-requests` | **Ensure** query orderBy createdAt desc (already in service). Add sort=newest-first explicitly if needed. | auth |
| **Catalog Enable Request** | | | |
| POST | `/api/v1/catalog-requests` | Branch: create request to enable product/variant at branch (productId, variantId, branchId, locationId?) | branch/org |
| GET | `/api/v1/catalog-requests` | List (org/branch); newest first | org.read |
| GET | `/api/v1/catalog-requests/:id` | Detail | org.read |
| POST | `/api/v1/catalog-requests/:id/approve` | Owner: approve → create LocationVariantConfig (+ price if provided) | org.write |
| POST | `/api/v1/catalog-requests/:id/decline` | Owner: decline with reason | org.write |
| **Expiry / monitoring** | | | |
| GET | `/api/v1/inventory/expiry-monitor` | Counts: expiring 30/60/90 days, expired, low stock, dead stock; optional list per bucket | inventory.read |
| GET | `/api/v1/inventory/expiring` | (existing) extend with daysAhead=30|60|90 | inventory.read |
| **Analytics** | | | |
| GET | `/api/v1/owner/analytics/sales` | Sales by brand, branch, channel (Online vs Offline), SKU; Online = from Central Warehouse only, Offline = from branch locations only | owner |
| **Central Warehouse** | | | |
| GET | `/api/v1/owner/central-warehouse` | Resolve org’s central warehouse location(s) or branch | owner |
| POST | `/api/v1/owner/central-warehouse` | Designate branch or location as central warehouse (if not auto-created) | owner |

### 3.2 Payloads (key new)

**POST /api/v1/grn**
- Request: `{ vendorId, locationId, notes?, lines: [{ variantId, quantity, lotCode?, mfgDate?, expDate? }] }`
- Response: `{ success, data: Grn }`

**POST /api/v1/grn/:id/receive**
- Request: `{}` or `{ lotId per line if pre-created }`
- Response: `{ success, data: { grn, ledgerEntries } }`

**POST /api/v1/stock-requests/:id/approve**
- Request: `{ approvedItems: [{ variantId, approvedQty }], extraItems?: [{ variantId, quantity }] }`
- Response: `{ success, data: StockRequest }` (status OWNER_REVIEW or APPROVED; optional draft transfer)

**POST /api/v1/catalog-requests**
- Request: `{ branchId, productId, variantId, locationId?, requestedPrice? }`
- Response: `{ success, data: CatalogEnableRequest }`

### 3.3 Permissions and RBAC

- **Owner:** approve/decline stock requests, catalog requests; dispatch transfer; receive transfer; create/receive GRN; view analytics; designate central warehouse.
- **Branch manager / staff:** create stock request, create catalog request; receive transfer at their branch.
- **Scoping:** Stock requests and catalog requests filtered by orgId (owner) or branchId (branch). GRN and transfers scoped by org and location’s branch.orgId.

---

## 4. UI Spec

### 4.1 Owner Panel (3104) – page routes

| Route | Purpose |
|-------|--------|
| `/owner/requests` | Summary list, newest first; type filters (Stock Request, Catalog Request, Transfer, etc.); link to detail pages. |
| `/owner/inventory` | **Main sidebar item** with dropdown (see below). Default: Overview. |
| `/owner/inventory/overview` | Dashboard: stock summary, low stock, recent movements. |
| `/owner/inventory/warehouse` | Central Warehouse: stock at warehouse location(s), link to GRN. |
| `/owner/inventory/branch-inventory` | Branch-wise inventory (ledger-derived per branch/location). |
| `/owner/inventory/requests` | **Inventory stock requests** list, newest first; filters status, branch. |
| `/owner/inventory/requests/:id` | Approve (partial + extra items), Decline, Dispatch (with FEFO lot selection). |
| `/owner/product-requests/:id` | **Catalog enable requests** approve/decline (existing product-requests flow). |
| `/owner/inventory/receipts` | **Receipts (GRN):** list GRNs; create new GRN; receive GRN. |
| `/owner/inventory/transfers` | Transfers list; send/receive. |
| `/owner/inventory/expiry-monitor` | Expiry dashboard: 30/60/90 days, expired, low stock, dead stock; lists. |
| `/owner/inventory/adjustments` | Adjustment requests list and detail. |

### 4.2 Sidebar (Owner)

- **Inventory** (main item) with dropdown:
  - Overview
  - Warehouse (Central)
  - Branch Inventory
  - Requests (Catalog Requests + Stock Requests — or separate sub-items)
  - Receipts (GRN)
  - Transfers
  - Expiry Monitor
  - Adjustments

**Menu source:** `bpa_web/src/lib/permissionMenu.ts` — add/restructure under `owner.inventory` so one parent “Inventory” expands to these children.

### 4.3 Tables and detail pages

- **Requests list (`/owner/requests`):** Columns: type, ref, title/summary, branch, status, requested by, date. Sort newest first. Link to `/owner/inventory/requests/:id` or `/owner/product-requests/:id`.  
- **Inventory stock requests list (`/owner/inventory/requests`):** Columns: id, branch, status, items count, created, actions. Newest first. Link to `/owner/inventory/requests/:id`.  
- **Stock request detail (`/owner/inventory/requests/:id`):** Show items (requested qty); **Approve** with partial quantities and optional extra lines; **Decline** with reason; **Dispatch** (from warehouse, to branch location, FEFO lot allocation).  
- **Catalog request detail (`/owner/product-requests/:id`):** Approve (enable variant at branch/location + optional price) or Decline.  
- **GRN list:** Columns: GRN ref, vendor, location, status, date, total lines. **Create** → form (vendor, location, lines with variant/lot/qty). **Receive** → confirm and post ledger.  
- **Expiry Monitor:** Cards or table for buckets (expiring 30/60/90, expired, low stock, dead stock) with counts and links to lists.

### 4.4 States and actions

- **Stock request:** DRAFT → SUBMITTED → [Owner: APPROVED / partial] → DISPATCHED → RECEIVED_PARTIAL / RECEIVED_FULL → CLOSED; or DECLINED/CANCELLED.  
- **Transfer:** DRAFT → (send) → IN_TRANSIT → (receive) → COMPLETED or PARTIAL_RECEIVED.  
- **GRN:** DRAFT → RECEIVED (on confirm).  
- **Catalog request:** PENDING → APPROVED (LocationVariantConfig created) or REJECTED.

---

## 5. Migration Plan (legacy Inventory and add-to-branches)

### 5.1 Legacy Inventory table

- **Current use:** `POST /api/v1/owner/products/:id/add-to-branches` writes to `Inventory` (branchId, productId, variantId, quantity, minStock). Some reads may still use legacy inventory for backward compat.
- **Decision:** Do **not** use legacy Inventory for any new flow. New stock-in: GRN → StockLedger GRN_IN; opening only for one-time setup.
- **Deprecation steps:**  
  1. Add deprecation notice to `add-to-branches` response and docs; add feature flag or env to disable write.  
  2. Provide **migration script:** for each `Inventory` row (branchId, productId, variantId, quantity), resolve branch’s default or first InventoryLocation; create StockLot if needed (no mfg/exp → use placeholder or org default); create StockLedger OPENING with refType LEGACY_MIGRATION, refId = inventoryId.  
  3. After migration, keep `Inventory` table read-only for reporting/audit; or remove writes and eventually drop after verification.  
- **File touch points:** `owner.controller.ts` (addProductToBranches), `inventory.service.ts` (any legacy getInventory that reads Inventory table), migration script in `scripts/` or `prisma/migrations/`.

### 5.2 add-to-branches endpoint

- **Option A (recommended):** Deprecate. New flow: Owner adds product to branch via **Catalog Enable** (LocationVariantConfig) and then either GRN into Central Warehouse and transfer to branch, or opening stock at branch location.  
- **Option B:** Change implementation to create StockLedger OPENING entries per branch location (and create default lot if needed) instead of writing to Inventory.  
- **UI:** No current Owner UI calls add-to-branches; if we keep Option B, add “Add to branches” that calls it and document that it now writes ledger.

---

## 6. Implementation Plan (milestones, file-by-file, tests, verification)

### Phase 1: Schema + minimal APIs (GRN, StockRequest approve, TransferOrder, CatalogRequest)

**Deliverables:**  
- Prisma: Add `Grn`, `GrnLine`; add `GRN_IN` to StockLedgerType; add `InventoryLocationType.CENTRAL_WAREHOUSE` (or use existing WAREHOUSE branch type + location type). Add `CatalogEnableRequest` (or extend ProductChangeRequest with ENABLE_FOR_BRANCH).  
- API: POST/GET GRN, POST GRN/:id/receive; POST stock-requests/:id/approve (partial + extra); GET/POST catalog-requests, approve/decline.  
- Central warehouse: GET (and optionally POST) owner central-warehouse; ensure FEFO used in dispatch.

**Files:**  
- `prisma/schema.prisma` (Grn, GrnLine, enum GRN_IN, CatalogEnableRequest or ProductChangeRequest type, CENTRAL_WAREHOUSE if desired).  
- `src/api/v1/modules/grn/` (new): grn.routes.ts, grn.controller.ts, grn.service.ts.  
- `src/api/v1/modules/stock_requests/stock_requests.controller.ts` (approve handler), `stock_requests.service.ts` (approve with partial/extra).  
- `src/api/v1/modules/catalog_requests/` (new) or under owner: catalog-requests routes, controller, service.  
- `src/api/v1/routes.ts` (mount /grn, /catalog-requests if separate).  
- `src/api/v1/modules/inventory/ledger.service.ts` (export recordLedgerEntry for GRN_IN; add type GRN_IN).  
- Tests: ledger correctness (GRN_IN creates balance); org/branch scoping for GRN and catalog-requests; approve partial and extra items; FEFO in dispatch (unit/integration).

**Verification:**  
- Postman/Insomnia or curl examples in `docs/` for GRN create/receive, stock-request approve, catalog-request approve.  
- Newest-first for all list endpoints.  
- RBAC: only owner can approve/decline/dispatch; branch can create requests.

**Phase 1 – Implementation verification (done):**  
- Prisma: `Grn`, `GrnLine`, `StockLedgerType.GRN_IN`, `InventoryLocationType.CENTRAL_WAREHOUSE`, `CatalogEnableRequest`; migration `20260218140000_phase1_grn_catalog_ledger_grn_in`.  
- APIs: `/api/v1/grn` (POST, GET list, GET/:id, PATCH/:id, POST/:id/receive); `/api/v1/stock-requests/:id/approve` (partial + extra); `/api/v1/catalog-requests` (POST, GET, GET/:id, POST/:id/approve, POST/:id/decline); `/api/v1/owner/central-warehouse` (GET, POST).  
- Ledger: GRN receive uses `recordLedgerEntryInTx` with type `GRN_IN`; FEFO dispatch unchanged in ledger.service.  
- Tests: `src/api/v1/modules/stock_requests/stock_requests.approve.test.ts` (approve validation + update payload).  
- Curl examples: `docs/INVENTORY_PHASE1_CURL.md`.  
- List endpoints: GRN and catalog-requests use `orderBy: { createdAt: 'desc' }`.

---

### Phase 2: Owner UI (requests, transfers, receipts)

**Deliverables:**  
- Sidebar: Inventory as main item with dropdown (Overview, Warehouse, Branch Inventory, Requests, Receipts, Transfers, Expiry Monitor, Adjustments).  
- `/owner/requests` — summary list newest first.  
- `/owner/inventory/requests` — stock requests list newest first.  
- `/owner/inventory/requests/:id` — approve (partial + extra), decline, dispatch.  
- `/owner/product-requests/:id` — catalog approve/decline (existing or new page).  
- `/owner/inventory/receipts` — GRN list + create + receive.  
- Transfers list/detail (existing) — ensure newest first.

**Files:**  
- `bpa_web/src/lib/permissionMenu.ts` (Inventory dropdown).  
- `bpa_web/app/owner/(larkon)/requests/page.tsx` (ensure sort; link to inventory/requests).  
- `bpa_web/app/owner/(larkon)/inventory/requests/page.tsx` (new or rename stock-requests), `requests/[id]/page.tsx` (approve/partial/extra, decline, dispatch).  
- `bpa_web/app/owner/(larkon)/inventory/receipts/page.tsx` (extend for GRN list + create + receive).  
- `bpa_web/app/owner/(larkon)/product-requests/[id]/page.tsx` (catalog approve/decline if not existing).  
- API client: ownerApi or apiFetch for GRN, approve, catalog-requests.

**Verification:**  
- E2E or manual: create stock request → approve with partial → dispatch → receive.  
- Create GRN → receive → check ledger and balance.  
- Newest-first on all lists.

---

### Phase 3: Online/Offline enforcement + analytics + expiry monitor

**Deliverables:**  
- Online channel: reserve and sell only from Central Warehouse location(s).  
- POS: sell only from branch store locations.  
- GET `/api/v1/inventory/expiry-monitor` (counts + lists).  
- GET `/api/v1/owner/analytics/sales` (by brand, branch, channel, SKU).  
- Owner Expiry Monitor page: 30/60/90 days, expired, low stock, dead stock.

**Files:**  
- `src/api/v1/modules/inventory/` (expiry-monitor endpoint; ensure getInventoryLocations / balance respect location type for online vs offline).  
- `src/api/v1/modules/online-store/` or orders: ensure online reserve/sale uses only central warehouse location.  
- `src/api/v1/modules/pos/`: ensure POS sale uses only branch location.  
- `src/api/v1/modules/owner/owner.controller.ts` or reports: analytics/sales by channel.  
- `bpa_web/app/owner/(larkon)/inventory/expiry-monitor/page.tsx`.  
- Tests: FEFO allocation; channel filtering; expiry counts.

**Verification:**  
- FEFO test coverage; expiry-monitor returns correct buckets; analytics returns Online vs Offline correctly.

---

### Phase 4: Master catalog UX (Admin 3103) + CSV + image reuse

**Deliverables:**  
- Admin: `/admin/products/master-catalog` — ecommerce-like filters (category, brand, search), search, pagination.  
- CSV upload (existing import endpoint); refresh list; CRUD for master product (if allowed).  
- MasterProduct canonical images; shops/branches reference them (clone already links product to masterCatalogId; ensure media reuse in clone/display).

**Files:**  
- `bpa_web/app/admin/(larkon)/products/master-catalog/page.tsx` (new or move from owner pattern): filters, search, table, CSV upload button, link to import.  
- `backend-api/src/api/v1/modules/products/master-catalog.controller.ts` (extend query params if needed).  
- Master catalog service: ensure clone copies or references master media.  
- Docs: image reuse and master catalog usage.

**Verification:**  
- Admin can filter, search, upload CSV, and see master products; clone reuses images.

---

### Phase 5: Deprecate legacy Inventory; migration script; docs

**Deliverables:**  
- Migration script: Inventory → StockLedger OPENING (with StockLot placeholder where no mfg/exp).  
- add-to-branches: return 410 with message or feature-flag off; document alternative (GRN + transfer or catalog enable + opening).  
- Remove or guard all writes to Inventory table.  
- Update BPA_STANDARD / PRODUCT_INVENTORY_MAINTENANCE and this plan with final state.

**Files:**  
- `scripts/migrateLegacyInventoryToLedger.ts` (or similar): read Inventory, create StockLot if needed, create OPENING ledger per location.  
- `owner.controller.ts`: addProductToBranches deprecate or redirect.  
- `docs/INVENTORY_MASTER_PLAN.md` (this doc): mark Phase 5 done; add migration runbook.  
- `docs/OWNER_PRODUCT_INPUT_REPORT.md`: add note that legacy Inventory is deprecated.

**Verification:**  
- Migration script runnable and idempotent; no new writes to Inventory; ledger balances match expected after migration.

---

## 7. Verification checklist (each phase)

- [ ] Automated tests for ledger correctness (no negative balance; GRN_IN/OPENING/TRANSFER_OUT/TRANSFER_IN).  
- [ ] Tests for org/branch scoping (owner sees only own org; branch sees only own branch).  
- [ ] Postman/Insomnia or curl examples in docs for new endpoints.  
- [ ] Newest-first sorting for requests and GRN lists.  
- [ ] Approve supports partial quantities and adding extra items (stock request).  
- [ ] FEFO lot allocation on dispatch and covered by tests.  
- [ ] RBAC: approve, dispatch, receive only by owner or permitted role; create request by branch.

---

## 8. References (evidence)

- **Baseline report:** `D:\BPA_Data\backend-api\docs\OWNER_PRODUCT_INPUT_REPORT.md`  
- **Backend routes:** `backend-api/src/api/v1/routes.ts`  
- **Stock requests:** `backend-api/src/api/v1/modules/stock_requests/stock_requests.routes.ts`, `stock_requests.controller.ts`, `stock_requests.service.ts` (list orderBy createdAt desc at line 96).  
- **Transfers:** `backend-api/src/api/v1/modules/transfers/transfers.routes.ts`, `transfers.service.ts` (sendTransfer TRANSFER_OUT, receiveTransfer TRANSFER_IN).  
- **Ledger:** `backend-api/src/api/v1/modules/inventory/ledger.service.ts` (getAvailableLotsFEFO, recordLedgerEntryInTx, StockLedgerType).  
- **Inventory locations:** `backend-api/src/api/v1/modules/inventory/inventory.service.ts` (getInventoryLocations: owner gets all branches of org).  
- **Owner requests inbox:** `backend-api/src/api/v1/modules/owner/owner.controller.ts` (getOwnerRequestsInboxItems, getOwnerRequestsPendingCounts; sort at line 5124 createdAt desc).  
- **Schema:** `backend-api/prisma/schema.prisma` (InventoryLocationType 2846, StockRequest 4197, StockLedgerType 2858, ProductChangeRequest 3149).  
- **Owner UI:** `bpa_web/app/owner/(larkon)/inventory/stock-requests/page.tsx`, `stock-requests/[id]/page.tsx`, `requests/page.tsx`; menu `bpa_web/src/lib/permissionMenu.ts`.

---

*End of Phase 0 plan. No code changes until approved. Implementation to proceed in Phases 1–5 with clean commits and verification per section 7.*
