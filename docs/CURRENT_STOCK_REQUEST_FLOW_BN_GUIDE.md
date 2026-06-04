# Current Stock Request Flow — Operational Guide (Bangla–English, Internal)

**Updated path:** `D:/BPA_Data/backend-api/docs/CURRENT_STOCK_REQUEST_FLOW_BN_GUIDE.md`
**Reference UI (Owner, port 3104):** `http://localhost:3104/owner/inventory/stock-requests/19` → file: `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx`

এই doc টা **codebase থেকে verify করা current implementation** describe করে — assumption না, যেখানে dual path (legacy vs enterprise) আছে সেটা clearly আলাদা করা হয়েছে।

---

## 1) Product আর stock entry — short overview

**Actor truth:** Owner org-এ **Product → ProductVariant** master থাকে। Branch শুধু variant pick করে qty চায়।

**Stock bookkeeping (high level):**

- **Location:** `InventoryLocation` (branch store, central warehouse, hub, ইত্যাদি) — type priority owner UI-তে default “from” sort এ use হয় (`OwnerStockRequestDetailPage`: `SOURCE_LOCATION_TYPE_PRIORITY`).
- **Aggregate qty:** `StockBalance` (per `locationId + variantId`) — `onHandQty`, `reservedQty`।
- **Lot-level:** `StockLot` + `StockLotBalance` (FEFO allocation এ primary)।
- **Movement:** `ledger` entries (`TRANSFER_OUT`, `TRANSFER_IN`, `DAMAGE`, ইত্যাদি) — `transfers.service.ts` / `dispatches.service.ts`।

**Arrow flow:**

```
Product → Variant → (StockLot optional) → Balance at Location → Ledger on send/receive
```

---

## 2) Branch — request create flow

### UI paths (verified)

| Step | Page / route | Notes |
|------|----------------|-------|
| List | `/staff/branch/{branchId}/inventory/stock-requests` | `staff/.../stock-requests/page.jsx` |
| Create | `/staff/branch/{branchId}/inventory/stock-request-create` | `stock-request-create/page.jsx` — nested `/stock-requests/new` redirect করে এখানে |
| Detail | `/staff/branch/{branchId}/inventory/stock-request-detail/{requestId}` | physical: `stock-request-detail-page/[requestId]/page.tsx` + `StaffStockRequestDetailClient.jsx` |

### APIs

- **Create draft:** `POST /api/v1/stock-requests` — body: `branchId`, `items[{ productId, variantId, requestedQty, note? }]`, optional `requestIntent`, `procurementNote`, … (`stock_requests.controller.ts` `create`).
- **Edit lines (draft):** `PATCH /api/v1/stock-requests/:id` — draft only.
- **Submit:** `POST /api/v1/stock-requests/:id/submit` → status **`SUBMITTED`**, `submittedAt` set (`submitRequest` in `stock_requests.service.ts`).
- **Cancel:** `POST /api/v1/stock-requests/:id/cancel` (branch/owner scope).

### `requestIntent` (auto)

`createRequest` → `resolveRequestIntent` / `branchTypeResolver` — warehouse-type branch হলে **`PROCUREMENT`**, নইলে **`INTERNAL_TRANSFER`** (`stock_requests.service.ts`).

### After submit — notification

Submit করলে owner-কে notification: `createNotification` type `INVENTORY_STOCK_REQUEST`, `actionUrl` → `/owner/inventory/stock-requests/{id}` (`stock_requests.controller.ts` `submit`).

**Status arrow:**

```
DRAFT → (submit) → SUBMITTED
```

---

## 3) Owner — request review & handling

### Owner UI (main reference)

- **List:** `/owner/inventory/stock-requests` → `GET /api/v1/stock-requests?orgId=...`
- **Detail (your link):** `/owner/inventory/stock-requests/[id]` → `OwnerStockRequestDetailPage`
  - `GET /api/v1/stock-requests/:id` — optional `?fromLocationId=` দিলে **available lots / max dispatchable** attach হয়
  - `GET /api/v1/inventory/locations?orgId=` — “From location” dropdown
  - **Enterprise panel:** `GET /api/v1/fulfillment/stock-requests/:id/status?orgId=`
  - **Start plan:** `POST /api/v1/fulfillment/stock-requests/:id/start` body: `{ fromLocationId, orgId }` (`fulfillment.routes.ts` — permissions: `warehouse.allocation.manage` or `warehouse.manage`)

### Decline

- `POST /api/v1/stock-requests/:id/decline` → status **`CANCELLED`** (`declineRequest`).

### Optional “approve” API (partial qty metadata)

- `POST /api/v1/stock-requests/:id/approve` — `approvedItems`, optional `extraItems`
- **DB behavior:** status **`OWNER_REVIEW`** + JSON `approvedItems` / `extraItems` (`approveRequest` — comment in code: “Status → OWNER_REVIEW”).
- **Owner detail page (verified):** এই approve flow এর জন্য dedicated button **এই page এ grep দিয়ে পাওয়া যায়নি** — operational reality: owner mostly **fulfill PATCH** বা **enterprise allocation** use করে।

---

## 4) দুইটা parallel fulfillment path (খুব important)

### Path A — Legacy owner fulfill → `StockTransfer` (still active in code)

**When:** কোনো **`AllocationPlan` নেই** (or cancelled) **এবং** `legacyFulfillmentGuard` pass করে।

**Owner action:** `PATCH /api/v1/stock-requests/:id/fulfill`
Body: `fromLocationId`, `toLocationId`, `manualMode?`, `items?` (each line **must have `stockRequestItemId`**), `extraItems?` (`stock_requests.controller.ts` `fulfill`).

**Backend core:** `fulfillStockRequestFlexible` (`stock_requests.service.ts`):

- Per-line **clamp:** available কম হলে `FULFILL_QTY_CLAMPED` warning; 0 হলে `INSUFFICIENT_STOCK` line error।
- **Extra item:** `extraItems` এ নতুন variant → `StockRequestItem` row **`lineKind: EXTRA`**, `requestedQty: 0` create হয়, তারপর fulfill হয়।
- **Over-fulfill:** requested এর বেশি পাঠালে `OVER_FULFILLMENT` warning (allowed path)।
- Creates **`StockTransfer`** (`dispatchRequest`) → **`transfersService.sendTransfer`** → transfer **`IN_TRANSIT`**, ledger **`TRANSFER_OUT`**।
- **`StockRequestItem.fulfilledQty`** increment।
- **`StockRequest.status`:**
  - সব requested line-এর মোট fulfill < মোট requested → **`FULFILLED_PARTIAL`**
  - else → **`DISPATCHED`**

**অন্য endpoint:** `POST /api/v1/stock-requests/:id/dispatch` — `fulfillAndDispatch` (variant/lot line legacy shape) — owner UI **এখন PATCH /fulfill** prefer করে।

### Path B — Enterprise: Allocation plan → pick → `StockDispatch`

**Start:** `POST /api/v1/fulfillment/stock-requests/:id/start` (`fulfillment.service.ts` `startStockRequestFulfillment`):

- আগে থেকে plan থাকলে **existing plan return** (`meta.existingPlan`).
- নতুন হলে `allocationPlan.service.ts` `createFromStockRequest` — default **AUTO_FEFO** single-source, optional **`MULTI_SOURCE`** (feature gate: `isMultiSourceEnabled()`).

**Confirm plan:** `allocationPlan.service.ts` `confirmPlan`:

- Reservations (যদি `isFulfillmentReservationEnabled()`).
- Plan status **`CONFIRMED`**.
- Shortage থাকলে **`procurement_demand_lines`** create (`procurementDemand.service.ts`).
- Shortage lines থাকলে **`Backorder`** records (`createBackordersFromPlanShortage`).
- Linked stock request → status **`APPROVED`** (transition guarded by `canTransitionTo`).

**Warehouse:** pick list handoff → `StockDispatch` → `sendDispatch` → branch receive session।

**Receive:** `dispatches.service.ts` `receiveDispatch` / `receiveDispatchLedgerInTx`:

- **`StockDispatchItem`** এ received/damaged/short।
- **`GRN`** record create (dispatch-linked)।
- Ledger **`TRANSFER_IN`** / **`DAMAGE`**।
- **`markStockRequestStatusFromDispatchReceive`** → `StockRequest` **`RECEIVED_FULL`** বা **`PARTIALLY_RECEIVED`** (সব DO delivered + lines accounted হিসেবে)।

---

## 5) Guard rules — legacy vs enterprise conflict

**File:** `legacyFulfillmentGuard.service.ts` + `stockRequestStatus.service.ts` `shouldBlockLegacyOwnerFulfillment`

**Block legacy fulfill / preview / dispatch যখন:**

- `DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true`, অথবা
- **`AllocationPlan` আছে এবং status `CANCELLED` নয়** (default) — **any draft plan blocks legacy** unless env `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT=true` (then only CONFIRMED+ blocks), অথবা
- **Active `Backorder`** exists।

**Owner UI message:** `allocationPlanBlocksLegacyFulfill` true হলে alert দেখায় — enterprise path use করতে হবে (`OwnerStockRequestDetailPage`।

---

## 6) Warehouse execution flow (enterprise)

**Conceptual arrow:**

```
StockRequest (SUBMITTED/…)
  → POST /fulfillment/stock-requests/:id/start
  → AllocationPlan (DRAFT → ALLOCATED/…)
  → confirmPlan → CONFIRMED + StockRequest APPROVED
  → Pick list
  → StockDispatch CREATED/PACKED → send → IN_TRANSIT
```

**Permissions:** fulfillment start এ `warehouse.allocation.manage` / `warehouse.manage` (`fulfillment.routes.ts`).

**Multi-warehouse:** `allocationScope: MULTI_SOURCE` — `multiSourceAllocator.service.ts`; UI hint: `getStockRequestFulfillmentStatus` returns `multiSourceHint` (`fulfillment.service.ts`).

---

## 7) Branch receive flow

### Enterprise (canonical for new work)

**UI:** `/staff/branch/{branchId}/inventory/incoming/{dispatchId}` — `incoming/[dispatchId]/page.jsx`

**APIs (from `bpa_web/lib/api.ts`):**

- `GET /api/v1/inventory/dispatches/:id`
- `GET/PUT /api/v1/inventory/dispatches/:id/receive-session`
- `POST .../receive-session/submit`, `.../confirm`, `.../cancel`
- Permissions: `inventory.receive`, confirm এ `dispatch.receive.confirm.branch_manager`

**Posting:** confirm এ `receiveDispatch` → **GRN** + ledger + `StockDispatch` status update + **stock request status** sync (`markStockRequestStatusFromDispatchReceive`).

### Legacy transfer receive (deprecated but still in codebase)

`transfers.service.ts` `receiveTransfer` → **`markRequestReceivedIfLinked`** → `RECEIVED_PARTIAL` / `RECEIVED_FULL` on linked `StockRequest`।

**Note:** Module header says prefer **`receiveDispatch`** for controlled session — operational team should **enterprise DO path** follow করবে যেখানে সম্ভব।

---

## 8) Documents / prints created (dispatch & receive)

| Artifact | Where | Purpose |
|----------|--------|---------|
| **StockTransfer** | Legacy fulfill | Shipment record + items; IN_TRANSIT |
| **StockDispatch** + **StockDispatchItem** | Enterprise | DO lines, qty dispatched |
| **DispatchReceiveSession** (+ lines) | Branch UI flow | Draft verify → submit → manager confirm |
| **GRN** | `receiveDispatchLedgerInTx` | Posted receive; lines tie to dispatch |
| **StockDispatchDiscrepancy** | Short/damage | Reason codes SHORT / DAMAGE etc. |
| **Print URLs** | `dispatches.routes.ts` | `print/challan`, `branch-confirmation`, `discrepancy`, `branch-worksheet` — `dispatchPrintUrl` in `bpa_web/lib/api.ts` |

---

## 9) Status changes — step-by-step (summary table)

| Stage | StockRequest.status (DB) | Also shown |
|-------|---------------------------|------------|
| Branch draft | `DRAFT` | — |
| Branch submit | `SUBMITTED` | Owner notified |
| Owner decline | `CANCELLED` | — |
| Owner legacy partial dispatch | `FULFILLED_PARTIAL` | — |
| Owner legacy full dispatch wave | `DISPATCHED` | — |
| Plan confirm (enterprise) | often **`APPROVED`** | `deriveRequestStatus` may show derived badge |
| After enterprise receive (all OK) | **`RECEIVED_FULL`** or enterprise path **`RECEIVED`** / mix | `markStockRequestStatusFromDispatchReceive` |
| Partial receive enterprise | **`PARTIALLY_RECEIVED`** | — |
| Legacy transfer receive | `RECEIVED_PARTIAL` / `RECEIVED_FULL` | `markRequestReceivedIfLinked` |

**UI badge:** Owner page `derivedStatus` / `derivedStatusDisplay` — `getRequestById` attaches `deriveRequestStatus` from plan + dispatches (`stock_requests.service.ts`).

---

## 10) Edge cases & shortage — scenario table

| Scenario | What code actually does |
|----------|-------------------------|
| **Product enough (e.g. avail 60, request 60)** | Legacy: full fulfill → status **`DISPATCHED`** (if single wave covers all requested lines)। Enterprise: allocation covers → confirm → dispatch। |
| **Available 40, requested 60** | Legacy PATCH: `FULFILL_QTY_CLAMPED` — **40** dispatch (if user asked 60)। Status likely **`FULFILLED_PARTIAL`** until remaining covered। **Second wave risk:** see §11 gaps। Enterprise: plan shows **shortageQty**; confirm এ procurement demand / backorder। |
| **Selected warehouse 0, another warehouse has stock** | Single-source plan: shortage at chosen `fromLocationId`। **MULTI_SOURCE** (if enabled): allocator অন্য location থেকে allocate করতে পারে। Otherwise owner **অন্য `fromLocationId` দিয়ে** `start` করবে বা multi-source flags। |
| **No warehouse has stock** | Allocation: `shortageQty` / `PARTIALLY_ALLOCATED` / FAILED states; UI hint: `partialDispatchHint` in `getStockRequestFulfillmentStatus`। Procurement demand / PO path (`procurementDemand`, owner UI procurement-demand pages)। |
| **Owner sends extra qty** | `OVER_FULFILLMENT` warning; `fulfilledQty` can exceed `requestedQty` on that line। |
| **Owner partially fulfills** | Status **`FULFILLED_PARTIAL`** after wave। |
| **Extra item added** | `lineKind: EXTRA`, new `StockRequestItem` row; fulfill qty tracked on that line। |
| **Branch receives short/damaged** | `quantityReceived` + `quantityDamaged` + `quantityShort` on dispatch item; **GRN** lines; discrepancies; partial deliver until sums match dispatched per line validation। |

---

## 11) Current implementation vs planned / doc “ideal”

| Topic | Implemented (verified) | Planned / commented in code |
|-------|------------------------|-----------------------------|
| Canonical shipment | **Both** `StockTransfer` (legacy) and **`StockDispatch`** (enterprise) active | `transfers.service.ts` header: StockDispatch is canonical long-term |
| Owner fulfill UI | **`PATCH /fulfill`** primary | Older doc mentioned `POST /dispatch` — still exists |
| Multi-wave partial legacy | **Intent** in `fulfillStockRequestFlexible` allows `FULFILLED_PARTIAL` | **`dispatchRequest` still only allows `SUBMITTED` / `OWNER_REVIEW`** — second wave likely **throws** → gap |
| Enterprise ownership | Plan exists → legacy blocked | `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT` escape |
| Backorder | Blocks legacy | “Use backorder workflow” message |

---

## 12) Conflicts / gaps (team should know)

1. **`dispatchRequest` vs multi-wave:** `fulfillStockRequestFlexible` accepts status **`FULFILLED_PARTIAL`**, but **`dispatchRequest`** checks only **`SUBMITTED` / `OWNER_REVIEW`** — **follow-up dispatch wave after partial fulfillment may fail** until status handling aligns।
2. **`markRequestDispatched`:** exported; **flexible fulfill** uses direct `prisma.stockRequest.update` instead — not necessarily wrong, but two patterns coexist।
3. **Dual receive models:** Transfer receive vs Dispatch receive — training এ clear করতে হবে কোন shipment type।
4. **`approve` API** sets **`OWNER_REVIEW`** — naming confusing; UI may not expose।
5. **Environment flags:** `DISABLE_LEGACY_STOCK_REQUEST_FULFILL`, `DISABLE_LEGACY_STOCK_TRANSFER`, `MULTI_SOURCE` gate — staging/production এ value দেখে QA করতে হবে।

---

## 13) Owner panel — operational checklist (practical)

1. Notification বা **Stock Requests** list খুলুন → **`/owner/inventory/stock-requests`**।
2. Request খুলুন → **`/owner/inventory/stock-requests/{id}`**।
3. **Intent** দেখুন: Procurement card (warehouse) vs internal transfer badge।
4. **Availability:** `From location` বেছে **`fromLocationId`** দিয়ে page reload — table এ lots / max।
5. **Choose path:**
   - **Enterprise:** “Start allocation plan” → **`/owner/inventory/allocation/{planId}`** (link button) → confirm → warehouse queue।
   - **Legacy:** fulfill qty + **Fulfill & dispatch** → `PATCH /fulfill`।
6. **Shortage:** Enterprise panel এ `partialDispatchHint` / procurement demand table (INTERNAL_TRANSFER এ demand lines)।
7. **Decline** if needed → decline form → `POST /decline`।

---

## 14) Branch / warehouse staff — quick roles

- **Branch:** create → submit → (optional) track status on detail page → **incoming dispatch** এ receive + confirm permissions।
- **Warehouse:** allocation confirm পর pick/dispatch (warehouse UIs / APIs — org setup অনুযায়ী)।
- **Manager confirm:** `dispatch.receive.confirm.branch_manager` permission।

---

## 15) Browser QA checklist (smoke)

**Owner (3104)**

- [ ] List load: `GET /api/v1/stock-requests?orgId=`
- [ ] Detail load: `GET /api/v1/stock-requests/{id}?fromLocationId=`
- [ ] Locations: `GET /api/v1/inventory/locations?orgId=`
- [ ] Enterprise status: `GET /api/v1/fulfillment/stock-requests/{id}/status?orgId=`
- [ ] Start plan: `POST /api/v1/fulfillment/stock-requests/{id}/start` → 201/200 + plan id
- [ ] Legacy fulfill (no plan): `PATCH /api/v1/stock-requests/{id}/fulfill` → 200, transfer created
- [ ] Plan exists: legacy PATCH returns **409** `ALLOCATION_PLAN_BLOCKS_LEGACY` (expected)

**Branch staff**

- [ ] Create page: `/staff/branch/{bid}/inventory/stock-request-create` — products load
- [ ] Submit: `POST /stock-requests/{id}/submit` → SUBMITTED
- [ ] Incoming: `/staff/branch/{bid}/inventory/incoming/{dispatchId}` — session + confirm
- [ ] Permission deny: without `inventory.receive` receive blocked

**Edge**

- [ ] Partial qty: clamp warning `FULFILL_QTY_CLAMPED` appears when ask > available
- [ ] Second partial wave (legacy): watch for **400** from `dispatchRequest` if status already `FULFILLED_PARTIAL` (known gap)

---

## 16) Key backend files (reference)

| Area | File |
|------|------|
| Stock request CRUD / fulfill | `src/api/v1/modules/stock_requests/stock_requests.service.ts`, `stock_requests.controller.ts`, `stock_requests.routes.ts` |
| Legacy guard | `src/api/v1/services/legacyFulfillmentGuard.service.ts` |
| Status derivation | `src/api/v1/services/stockRequestStatus.service.ts` |
| Enterprise start | `src/api/v1/modules/fulfillment/fulfillment.service.ts`, `fulfillment.controller.ts` |
| Allocation | `src/api/v1/modules/allocation_plans/allocationPlan.service.ts` |
| Dispatch receive | `src/api/v1/modules/dispatches/dispatches.service.ts` |
| Legacy transfer | `src/api/v1/modules/transfers/transfers.service.ts` |

---

*এই document টা implementation snapshot — production behavior বদলালে আগে code verify করে update করুন।*
