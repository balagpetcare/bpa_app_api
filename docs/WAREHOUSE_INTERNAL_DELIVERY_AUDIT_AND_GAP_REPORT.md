# Warehouse & Internal Branch Delivery — Implementation Audit & Gap Report

**Related docs:** Consolidates and extends analysis in `ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md` and `WAREHOUSE_PROCUREMENT_AND_RECEIVING_ENTERPRISE_PLAN.md` (see also `warehouse-*` under `/docs`).

**Scope:** Internal distribution only (central warehouse / DC → internal dispatch → company-managed delivery → destination branch receive / GRN). **Not** customer home delivery.

**Method:** Evidence from Prisma schema, API modules, permission seeds, `bpa_web/lib/api.ts`, and existing `/docs` plans. Items not verified in code are marked **uncertain / needs verification**.

**Date:** 2026-04-04

---

## SECTION A — System summary

**Architecture (as implemented):** Inventory truth is **ledger + lot balances** at `InventoryLocation` (branch-scoped; optional `warehouseId`, `zoneId`, `binId`). Branch demand is modeled as **`StockRequest`** → optional **`AllocationPlan`** (FEFO/manual) → **`PickList`** → **`StockDispatch`** (challan) with **`StockDispatchItem`** lines → **`sendDispatch`** writes **`TRANSFER_OUT`** → branch **`receiveDispatch`** creates **`Grn`** (vendorId null, `stockDispatchId` set) and **`TRANSFER_IN`**. Parallel paths exist: **`StockTransfer`** (legacy multi-wave), **`WarehouseTransferOrder`** (inventory routes), and **medicine requisition** dispatch linkage.

**Internal logistics only:** Yes — `StockDispatch` ties **fromLocation → toLocation** (org internal); no e-commerce last-mile model in this chain (POD/`DeliveryAssignment` are internal proof/handoff fields).

---

## SECTION B — Implementation status by module

| # | Module | Status | ~% | What exists | Gaps / risks | Key files |
|---|--------|--------|-----|-------------|--------------|-----------|
| 1 | Warehouse foundation | **MOSTLY DONE** | 78% | `Warehouse`, `WarehouseStaffAssignment`, staff roles enum, owner/staff warehouse pages, `warehouse.routes` (dispatches list, assign delivery) | Controller comment suggests **branch-backed convergence** vs standalone `Warehouse` rows — **operational model needs verification** for new orgs | [prisma/schema.prisma](prisma/schema.prisma) (~12750+), [src/api/v1/modules/warehouse/](src/api/v1/modules/warehouse/), [bpa_web/app/owner/(larkon)/warehouse/](bpa_web/app/owner/(larkon)/warehouse/), [bpa_web/app/staff/(larkon)/branch/[branchId]/warehouse/](bpa_web/app/staff/(larkon)/branch/[branchId]/warehouse/) |
| 2 | Inventory / locations / visibility | **MOSTLY DONE** | 80% | `InventoryLocation`, lot balances, ledger, dashboards, alerts endpoints | Multi-location org **UX consistency** across owner vs staff **uncertain** | [inventory.service.ts](src/api/v1/modules/inventory/inventory.service.ts), [inventory.routes.ts](src/api/v1/modules/inventory/inventory.routes.ts) |
| 3 | Stock requests | **MOSTLY DONE** | 75% | Full lifecycle enum (`StockRequestStatus`), approval JSON, `StockRequestIntent` (INTERNAL_TRANSFER / PROCUREMENT), linkage to `PurchaseOrder`, fulfillment status API | **Procurement vs transfer** UX still evolving (see enterprise plan); many **status values** (RECEIVED vs RECEIVED_FULL vs PARTIALLY_RECEIVED) can confuse UI/reporting | [stock_requests.service.ts](src/api/v1/modules/stock_requests/stock_requests.service.ts), schema `StockRequest` |
| 4 | Internal transfers | **PARTIAL** | 60% | `StockTransfer` + legacy owner dispatch; `WarehouseTransferOrder` APIs under inventory | **Two parallel transfer architectures** — training and product behavior risk | [inventory.routes.ts](src/api/v1/modules/inventory/inventory.routes.ts) (warehouse-transfer-orders), schema `StockTransfer`, `WarehouseTransferOrder` |
| 5 | Procurement / vendor receipts | **MOSTLY DONE** | 72% | `PurchaseOrder`, `PurchaseRequisition`, PO receive, pending PO queue API, owner PO/receipt UIs | Auto link **warehouse procurement intent → PO** not fully closed-loop in UI **per existing plan** | [purchase_order.service.ts](src/api/v1/modules/purchase_orders/purchaseOrder.service.ts), [WAREHOUSE_PROCUREMENT_AND_RECEIVING_ENTERPRISE_PLAN.md](docs/WAREHOUSE_PROCUREMENT_AND_RECEIVING_ENTERPRISE_PLAN.md) |
| 6 | Receive stock / GRN | **MOSTLY DONE** | 78% | `Grn`/`GrnLine`, PO receive, dispatch receive creates GRN, idempotency keys, void | Edge cases (partial multi-tap receive, damaged/short) depend on caller discipline — **needs QA** | [grn.service.ts](src/api/v1/modules/grn/grn.service.ts), [dispatches.service.ts](src/api/v1/modules/dispatches/dispatches.service.ts) `receiveDispatch` |
| 7 | Putaway | **PARTIAL** | 55% | `PutawayTask` model, staff putaway pages | End-to-end **coverage vs all GRN paths** not fully audited here — **uncertain** | schema `PutawayTask`, staff `putaway` pages under `bpa_web` |
| 8 | Pick lists | **MOSTLY DONE** | 82% | Plan → pick → lines; handoff to dispatch; RBAC on routes | Wave/multi-warehouse deferred per enterprise plan | [pickList.service.ts](src/api/v1/modules/pick_lists/pickList.service.ts), [pickList.routes.ts](src/api/v1/modules/pick_lists/pickList.routes.ts) |
| 9 | QC | **PARTIAL** | 60% | `QcInspection`, warehouse `qcInboundEnabled`, QC routes module | Queue depth vs all inbound paths — **needs verification** | [qc_inspections/](src/api/v1/modules/qc_inspections/), schema `QcInspection` |
|10 | Dispatch queue | **MOSTLY DONE** | 75% | `StockDispatch`, list/incoming, status machine, `sendDispatch` ledger | `updateDispatchStatus` vs `sendDispatch` — two ways to advance state; **must ensure clients use supported path** | [dispatches.service.ts](src/api/v1/modules/dispatches/dispatches.service.ts), [dispatches.routes.ts](src/api/v1/modules/dispatches/dispatches.routes.ts) |
|11 | Internal delivery to branch | **MOSTLY DONE** | 70% | `DeliveryAssignment`, POD model, `assign-delivery` API | Field-level POD vs operational habit on mobile/web — **uncertain** | schema `DeliveryAssignment`, `ProofOfDelivery`, [warehouse.routes.ts](src/api/v1/modules/warehouse/warehouse.routes.ts) |
|12 | Branch receiving confirmation | **MOSTLY DONE** | 78% | `receiveDispatch` updates dispatch items, ledger, GRN; `markStockRequestStatusFromDispatchReceive` | Incoming list filters **IN_TRANSIT** — PACKED-only dispatches invisible until sent (**by design**; train users) | [dispatches.service.ts](src/api/v1/modules/dispatches/dispatches.service.ts), [stock_requests.service.ts](src/api/v1/modules/stock_requests/stock_requests.service.ts) |
|13 | Alerts / replenishment | **PARTIAL** | 50% | AI replenishment models, suggestions, inventory alerts | Enterprise replenishment **not same as branch SLO** — partial | schema `AiReplenishmentSuggestion`, inventory alerts routes |
|14 | RBAC / warehouse roles | **MOSTLY DONE** | 73% | Rich permission keys; `WAREHOUSE_MANAGER`, `RECEIVING_STAFF`, etc. in seeds | **Frontend route guards** must match API `requirePermission` — periodic drift risk | [seedRolesPermissions.ts](prisma/seeders/seedRolesPermissions.ts), [requirePermission.ts](src/middlewares/requirePermission.ts) |
|15 | Audit / traceability | **MOSTLY DONE** | 70% | `StockLedger` refType/refId, `AllocationPlanEvent`, `WarehouseAuditEvent`, GRN audit logs | Org-wide **single export narrative** — partial | [warehouseAudit.service.ts](src/api/v1/modules/warehouse/warehouseAudit.service.ts), ledger service |

---

## SECTION C — End-to-end flow check

### 1. Branch request → approve → pick → dispatch → branch receives

| Aspect | State |
|--------|--------|
| **Current** | Documented and implemented: allocation plan + pick + handoff + `sendDispatch` + `receiveDispatch` + SR status update ([ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md](docs/ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md), `markStockRequestStatusFromDispatchReceive`). |
| **Blocking gaps** | Legacy **`StockTransfer`** path still present alongside dispatch path — process ambiguity. |
| **Broken transitions** | None proven broken in static review; **pick-handoff SR status allow-list** was a known past issue — addressed in code comments (`SR_DISPATCH_WITH_PICK_HANDOFF`). |
| **Risk** | **Medium** (dual paths + status enum multiplicity). |

### 2. Vendor receive → GRN → putaway → available

| Aspect | State |
|--------|--------|
| **Current** | PO → GRN receive → ledger; QC may gate allocatable stock if `qcInboundEnabled`. Putaway tasks exist. |
| **Blocking gaps** | Putaway completion vs QC release — **needs field verification**. |
| **Risk** | **Medium** (QC + putaway interaction). |

### 3. Transfer between branches / locations

| Aspect | State |
|--------|--------|
| **Current** | `StockDispatch` internal; `WarehouseTransferOrder` separate workflow; `StockTransfer` legacy. |
| **Blocking gaps** | **No single unified “internal transfer” story** in one module. |
| **Risk** | **High** (conceptual fragmentation). |

### 4. Dispatch status lifecycle

| Aspect | State |
|--------|--------|
| **Current** | `StockDispatchStatus`: CREATED → PACKED → IN_TRANSIT → DELIVERED; **`sendDispatch`** moves CREATED|PACKED → IN_TRANSIT with ledger; **`receiveDispatch`** sets DELIVERED when all lines accounted. |
| **Blocking gaps** | Clients using only **`updateDispatchStatus`** without **`sendDispatch`** could desync ledger vs status — **uncertain usage**. |
| **Risk** | **Medium**. |

### 5. Pick list quantity lifecycle

| Aspect | State |
|--------|--------|
| **Current** | Pick lines `quantityToPick` / `quantityPicked`; handoff validates picked vs dispatch body. |
| **Blocking gaps** | Partial pick + multiple dispatches per SR supported in principle; **UI complexity**. |
| **Risk** | **Low–Medium**. |

---

## SECTION D — Current blockers / known risks

1. **Dual fulfillment architectures** (`StockTransfer` legacy vs `AllocationPlan`/`PickList`/`StockDispatch` enterprise vs `WarehouseTransferOrder`).
2. **StockRequest status surface area** — many enum values; reporting and filters may disagree.
3. **Procurement intent** exists in schema (`StockRequestIntent`); **end-to-end PO creation story** may still be incomplete for warehouse-only demand ([WAREHOUSE_PROCUREMENT_AND_RECEIVING_ENTERPRISE_PLAN.md](docs/WAREHOUSE_PROCUREMENT_AND_RECEIVING_ENTERPRISE_PLAN.md)).
4. **Warehouse vs branch record model** — comments in [warehouse.controller.ts](src/api/v1/modules/warehouse/warehouse.controller.ts) vs rich `Warehouse` schema — **convergence needs explicit product decision**.
5. **RBAC drift** between seeded keys and every route — ongoing maintenance risk.
6. **Incoming dispatch UX** — only **IN_TRANSIT** in `getIncomingDispatchesForBranch`; training required for PACKED vs sent.

---

## SECTION E — Completion estimate

| Area | ~% |
|------|-----|
| Warehouse core (master data, locations, zones, staff) | **78%** |
| Internal delivery (dispatch, send, receive, GRN link) | **74%** |
| Overall internal branch supply chain | **72%** |

**Classification:** **Usable with supervision** — core paths exist and are sophisticated; enterprise completeness and single-path clarity not yet at “hands-off production” level.

---

## SECTION F — Done / Partial / Missing / Broken

**Done (high confidence)**

- Lot-backed inventory ledger and balances; internal dispatch receive producing GRN + TRANSFER_IN.
- Enterprise allocation + pick + dispatch handoff (per [ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md](docs/ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md)).
- PO/GRN vendor receive with tolerance/QC hooks in schema.
- Permission model with warehouse/dispatch/grn/qc/delivery keys in [seedRolesPermissions.ts](prisma/seeders/seedRolesPermissions.ts).
- Staff/owner UI routes for warehouse ops, picks, QC, delivery, receipts (see `bpa_web` warehouse + inventory trees).

**Partial**

- Putaway across all inbound types; QC queue coverage; AI replenishment vs operational replenishment.
- Warehouse procurement vs branch transfer (intent field present; product closure partial).
- `WarehouseTransferOrder` vs other transfer mechanisms.

**Missing / unclear**

- Single documented **golden path** deprecating legacy transfer for new implementations.
- **Uncertain:** full mobile/offline POD; full branch training materials in-repo.

**Broken / risky**

- Not proven “broken” by static audit — **risk** from **parallel architectures** and **status API multiplicity**, not a specific known runtime bug in this review.

---

## SECTION G — Next implementation roadmap

**Phase 1 — Critical fixes (priority: Critical / High)**

| Task | Why | Backend | Frontend | DB | Priority |
|------|-----|---------|----------|-----|----------|
| Define **single primary fulfillment path** for branch restock | Reduces bugs and training cost | Document + fence legacy APIs or UI entry points | Owner/staff entry points | None if policy-only | Critical |
| RBAC audit pass on warehouse APIs | Prevent 403/escape in prod | `requirePermission` sweep | Route guards | None | High |
| Procurement intent → PO workflow closure | Warehouse demand vs branch demand | stock_requests + purchase_orders | Owner queue + PO create | Optional fields already exist | High |

**Phase 2 — Missing core workflows (High / Medium)**

- Consolidate internal transfer story OR clearly label `WarehouseTransferOrder` vs `StockDispatch` use cases.
- Putaway: ensure every GRN exit path creates/completes tasks as per policy.
- QC: validate `qcInboundEnabled` behavior on all receive entry points.

**Phase 3 — Enterprise hardening**

- Monitoring/alerts for stuck CREATED dispatches, partial receives, open discrepancies.
- Stronger idempotency and replay testing on `receiveDispatch`.

**Phase 4 — Optimization / automation**

- Wave picking, multi-warehouse allocation (deferred per enterprise plan).
- Deeper AI replenishment integration.

---

## SECTION H — Enterprise gap check

| Dimension | Assessment |
|-----------|------------|
| Stock accuracy | **Strong** ledger + lot model; risk = human/process on dual paths. |
| Branch replenishment | **Strong** request → fulfill model; procurement linkage partial. |
| Receiving control | **Good** GRN + QC hooks; putaway **partial**. |
| Pick/dispatch integrity | **Good** handoff validation + reservations (per docs). |
| Handoff confirmation | **Good** GRN + POD fields; **verify** field usage in apps. |
| Traceability | **Good** ledger refType/refId + warehouse audit events; not a full data warehouse. |
| RBAC | **Good** breadth; **maintenance** of alignment. |
| Operational usability | **Medium** — power features exist; clarity of one path needed. |

---

## SECTION I — Executive summary

**Achieved:** Solid **internal logistics data model** and **execution services** (allocation, pick, dispatch, receive, GRN, ledger), with **documented enterprise allocation work** and **extensive RBAC vocabulary**.

**Fix first:** **Product/process alignment** — one golden path for branch replenishment; resolve **legacy vs enterprise** ambiguity; close **procurement intent** loop where still open.

**Build next:** Hardening **putaway + QC** coverage; **transfer module** clarity; operational **dashboards** for exceptions.

**Defer:** Wave automation, multi-warehouse allocation, deep AI-driven auto-procurement.

---

## Appendix — Key evidence pointers

- `StockDispatch` / `receiveDispatch` + GRN: [dispatches.service.ts](src/api/v1/modules/dispatches/dispatches.service.ts)
- SR status after receive: `markStockRequestStatusFromDispatchReceive` in [stock_requests.service.ts](src/api/v1/modules/stock_requests/stock_requests.service.ts)
- Fulfillment aggregate: [fulfillment.service.ts](src/api/v1/modules/fulfillment/fulfillment.service.ts)
- Inventory mounts dispatches: [inventory.routes.ts](src/api/v1/modules/inventory/inventory.routes.ts) `router.use("/dispatches", ...)`
- Frontend API: [bpa_web/lib/api.ts](bpa_web/lib/api.ts) (stock requests, dispatches, allocation, pick lists, GRN, putaway)
