# Central Warehouse / Delivery Hub — implementation progress

Audit date: 2026-03-27 (against `docs/warehouse/central-warehouse-module-b63764.md`).

## Completed (verified in repo)

### Schema (`prisma/schema.prisma`)

- `Warehouse`, `WarehouseStaffAssignment`, `DeliveryAssignment` models with relations to `Organization`, `User`, `InventoryLocation`, `StockDispatch`.
- `InventoryLocation.warehouseId` optional FK to `Warehouse`.
- `MemberRole`: `WAREHOUSE_MANAGER`, `RECEIVING_STAFF`, `DISPATCH_STAFF`.
- `WarehouseStaffRole` enum (includes `INVENTORY_CONTROLLER`).
- `WarehouseType`, `DeliveryAssignmentStatus`.
- `InventoryLocationType`: `QUARANTINE`, `STAGING` (plus existing hub/warehouse types).
- `StockDispatchStatus`: `CANCELLED`, `FAILED`.

### Backend module (`src/api/v1/modules/warehouse/`)

- `warehouse.routes.ts` — CRUD, dashboard, staff, link/unlink location, delivery assignment lifecycle routes.
- `warehouse.controller.ts` / `warehouse.service.ts` — create/list/get/update, dashboard KPIs, staff assign/list/remove, link location (with org match on link), unlink scoped to `warehouseId` + `locationId`.
- `delivery.controller.ts` / `delivery.service.ts` — assign, list mine, get, start, arrive, complete, fail.
- **Phase 1**: `GET /warehouse/accessible`, `POST /warehouse/ensure-default`, `GET /warehouse/:id/dispatches`, `GET /warehouse/:id/delivery-assignments`, `GET /warehouse/:id/reports/summary` (`warehouseReports.*`).
- **Phase 2 (operations)**: `GET /warehouse/:id/operations/summary`, `/operations/inbound`, `/operations/requisitions`, `/operations/outbound`, `/operations/discrepancies`, `/operations/visibility?kind=…` (`warehouseOperations.*`). Uses existing `Grn`, `StockRequest`, `StockDispatch`, `StockReturn`, `BatchRecall`, `StockLotBalance`, `StockBalance`, `ExpiryWriteOffLog` only.
- **GRN list**: `GET /api/v1/grn?warehouseId=` resolves linked `InventoryLocation` rows for that org and filters `locationId IN (…)`.
- **Security**: `requireDispatchAccess` scopes warehouse staff assignments to warehouses in the dispatch’s org (no cross-org assignment by global staff row).

### Routes

- `src/api/v1/routes.ts` mounts `/api/v1/warehouse` with `countryScopeGuard`.

### Branch role matrix (`src/api/v1/constants/branchRoles.ts`)

- `WAREHOUSE_MANAGER`, `RECEIVING_STAFF`, `DISPATCH_STAFF` in `BRANCH_ROLE_PRIORITY` and `BRANCH_ROLE_PERMISSIONS` with `warehouse.*`, `dispatch.*`, `delivery.*` style keys.

### Frontend (bpa_web)

- Owner: `/owner/warehouse`, `/owner/warehouse/new`, `/owner/warehouse/[id]`, `/owner/warehouse/[id]/staff`, `[id]/dispatches`, `[id]/delivery`, `[id]/operations` (**operational hub**), list page **“Link central locations”** (`ensure-default`).
- Owner **Receipts** (`/owner/inventory/receipts`) honors `?warehouseId=` and calls GRN list with warehouse scope.
- `lib/api.ts` — warehouse operations helpers + existing warehouse/delivery helpers.
- Staff `/staff/branch/[branchId]/warehouse` — warehouse selector, KPIs, deliveries tab, receive/inventory links, **Operations hub** button.
- Staff `/staff/branch/[branchId]/warehouse/operations` — `?wh=` warehouse selector, inbound/requisition/outbound snapshots, branch receive link.
- `permissionMenu.ts` — Owner “Warehouse” group.
- `branchSidebarConfig.ts` — Warehouse group: dashboard, deliveries, receive stock, **operations hub**.

### Staff

- `/staff/branch/[branchId]/warehouse/delivery/[id]` — delivery detail / actions.
- **Branch receive**: `/staff/branch/[branchId]/inventory/receive` with `DispatchReceiveDrawer` — **already** posts `quantityReceived` / `quantityDamaged` / `quantityShort` + **notes** to `POST /api/v1/inventory/dispatches/:id/receive` (ledger + GRN + audit `DISCREPANCY_RECORDED` when damaged/short).

## Partial

- **Database**: Apply migration `20260428150000_central_warehouse_foundation` on every environment that does not yet have `warehouses` / `warehouse_staff_assignments` / `delivery_assignments` / `inventory_locations.warehouseId`. If objects already exist from `db push`, reconcile drift before migrating.
- **Staff requisitions**: read-only queue (no fulfill UI on staff; owner fulfills via existing stock-request pages).
- **Dedicated DB “discrepancy” row** for dispatch receive: not added; **audit log + `StockDispatchItem` / `GrnLine` quantities** are the source of truth.

## Missing / future (post Phase 3)

- Formal QC gates, zone picking, pick path optimization, purchase requisition approvals beyond PO submit/approve.
- Pagination UI on owner operations hub (API supports `page`/`limit`; UI shows first page).
- Remove inventory `requirePermission` MVP bypass (cross-cutting; not changed here).
- **Medicine requisition → dispatch handoff** via pick list: allocation + pick supported; `handoffToDispatch` requires `stockRequestId` (use existing medicine dispatch flow until extended).

## Blockers

- Apply migrations through `20260429120000_warehouse_enterprise_po_allocation_pick_pod` (after foundation migration) for Phase 3 tables and `grns.purchaseOrderId`.

## Recommended execution order

1. Run migration on dev DB.
2. `npx prisma generate`
3. Seed permissions (`prisma db seed` or deploy seed step).
4. Owner: **Ensure default warehouse**, link locations, open **Operations** on a warehouse card.
5. Staff: assign warehouse roles; open **Operations hub** from sidebar; use **Branch receive** for `IN_TRANSIT` dispatches.
6. Owner: use **Receipts** with `warehouseId` query from operations link.

## QA checklist

- [ ] Migration applies on clean shadow DB.
- [ ] `GET /warehouse/:id/operations/summary` (owner + warehouse staff).
- [ ] `GET /warehouse/:id/operations/inbound|requisitions|outbound|discrepancies`.
- [ ] `GET /warehouse/:id/operations/visibility?kind=returns|recalls|near_expiry|expired|quarantine|writeoffs`.
- [ ] `GET /api/v1/grn?orgId=&warehouseId=` returns only GRNs at linked locations.
- [ ] Owner `/owner/warehouse/[id]/operations` loads tables without silent error (empty states OK).
- [ ] Staff `/staff/branch/.../warehouse/operations?wh=` loads after warehouse assignment.
- [ ] Branch receive still updates dispatch + GRN + audit on discrepancy lines.

---

## Phase 2 operational completion

### Already complete (before this pass)

- **Dispatch receive API** (`dispatches.service.receiveDispatch`): partial/full receive, `quantityReceived` / `quantityDamaged` / `quantityShort`, GRN creation, `StockDispatchItem` roll-ups, `StockRequest` status updates, ledger `TRANSFER_IN` / `DAMAGE`.
- **Audit**: `auditDiscrepancy` on receive when damaged or short lines exist.
- **Staff UI**: incoming dispatches list + `DispatchReceiveDrawer` with line-level recv/dmg/short + notes.
- **Owner**: stock request detail + challan pages for create/send dispatch.
- **GRN** CRUD/list/receive (vendor) at `locationId` granularity.

### Partial (improved in this pass)

- **Warehouse-filtered GRN / receipts**: was location-only; now **`warehouseId` query** on `GET /api/v1/grn` and owner receipts page `?warehouseId=`.
- **Operational queues**: were implicit (generic inventory pages); now **warehouse-scoped API + owner/staff operations surfaces**.

### Missing (deferred)

- Full **pagination** and **CSV export** on operations tables.
- **Automated priority** on stock requests (no `priority` column on `StockRequest`).
- **One-click fulfill** from staff operations (by design stays owner-side for enterprise control).

### Implementation order (executed)

1. Backend `warehouseOperations.service` + routes + strict `requireWarehouseAccess`.
2. GRN `warehouseId` list filter (org-safe).
3. Owner operations hub + receipts deep link.
4. Staff operations hub + sidebar + warehouse dashboard link.
5. UX polish: discrepancy label on receive notes; progress doc update.

---

## Phase 3 enterprise control completion

### Audit findings

| Area | Before | After |
|------|--------|--------|
| **Purchase orders** | None (vendor + GRN only) | `PurchaseOrder` / `PurchaseOrderLine`, lifecycle APIs, owner UI list/detail/new |
| **GRN ↔ PO** | Unlinked | Optional `Grn.purchaseOrderId`; create GRN with PO validates variants; **receive** rolls up `receivedQty` + PO status |
| **Allocation** | Implicit (owner picked lots on stock request UI) | `AllocationPlan` / `AllocationPlanLine` from **stock request** or **medicine requisition**; **FEFO** fills lines from `StockLotBalance` ordered by lot `expDate` |
| **Pick list** | None | `PickList` / `PickListLine` from confirmed plan; start/complete; **handoff** calls `createDispatch` with `pickListId` validation |
| **POD** | `DeliveryAssignment` had basic `receivedByName` / `podNote` / GPS | **`ProofOfDelivery`** row on successful complete; **recipient name required**; optional phone, file keys, GPS; visible on dispatch + delivery UI |
| **Dispatch** | Direct create from challan | Unchanged path + **optional `pickListId`** on create body for enterprise validation |
| **Ledger** | Source of truth | **Unchanged** — FEFO/pick/dispatch do not write stock until existing `sendDispatch` / receive flows |

### Reusable existing flows

- `ledger.service` / `StockLotBalance` for FEFO reads only.
- `createDispatch` / `sendDispatch` / branch receive unchanged for non-pick flows.
- `Vendor`, `VendorLedgerEntry` (`PURCHASE_ORDER` enum already existed).
- Owner stock request + challan pages for dispatch after handoff.

### Schema added (migration `20260429120000_warehouse_enterprise_po_allocation_pick_pod`)

- Enums: `PurchaseOrderStatus`, `AllocationPlanStatus`, `PickListStatus`.
- Models: `PurchaseOrder`, `PurchaseOrderLine`, `AllocationPlan`, `AllocationPlanLine`, `PickList`, `PickListLine`, `ProofOfDelivery`.
- `Grn.purchaseOrderId` optional FK.

### API surface (all under `/api/v1/` + `countryScopeGuard`)

- `purchase-orders`: POST `/`, GET `/`, GET `/:id`, POST `/:id/submit|approve|reject|cancel`
- `allocation-plans`: POST `/from-stock-request`, POST `/from-medicine-requisition`, GET `/`, GET `/:id`, POST `/:id/run-fefo`, POST `/:id/confirm`, POST `/:id/cancel`
- `pick-lists`: GET `/`, GET `/:id`, POST `/from-plan/:planId`, POST `/:id/assign-picker`, POST `/:id/start`, PATCH `/:id/lines/:lineId`, POST `/:id/complete`, POST `/:id/handoff-dispatch`
- `warehouse/delivery/:id/complete` — extended body; creates `ProofOfDelivery`
- `inventory/dispatches` create body — optional `pickListId`
- `grn` create — optional `purchaseOrderId` (vendor optional when PO set)

### Permissions seeded / registry

- `procurement.po.view`, `procurement.po.manage`, `warehouse.allocation.manage`, `warehouse.pick.execute`, `delivery.pod.submit` (OWNER gets all via full permission map; ORG_ADMIN + warehouse branch templates extended).

### Frontend

- Owner: `/owner/inventory/purchase-orders`, `/new`, `/[id]`; `/owner/inventory/allocation`, `/allocation/[id]`; menu entries; staff **Pick lists** + delivery POD fields.
- Staff: `/staff/branch/.../warehouse/pick-lists`, `/pick-lists/[id]`; sidebar **Pick lists**.

### Phase 3 QA checklist

- [ ] Migration `20260429120000_warehouse_enterprise_po_allocation_pick_pod` applies.
- [ ] PO create → submit → approve → GRN with `purchaseOrderId` → receive → PO `receivedQty` / status.
- [ ] Allocation from stock request → run FEFO → confirm → pick list → complete → handoff → dispatch created → challan/send/receive still work.
- [ ] Delivery complete **without** recipient name → 400.
- [ ] Delivery complete **with** name → `proof_of_deliveries` row + dispatch `DELIVERED`.
- [ ] `GET` dispatch includes `proofOfDelivery` + `pickList` where present.
- [ ] Direct dispatch create (no `pickListId`) still works for legacy UI.

### Future work

- Owner receipts UI field for `purchaseOrderId`; staff PATCH pick lines for partial picks; medicine requisition dispatch from pick handoff; attach `Media` IDs to POD instead of raw file keys if unified upload is required.

---

## Phase 4 advanced warehouse controls

### Audit findings

| Area | Before | After |
|------|--------|--------|
| **Warehouse zones / bins** | Only `InventoryLocation` + optional `warehouseId` | `WarehouseZone` (purpose, code) + optional `InventoryLocation.zoneId` for putaway/pick context |
| **QC inspection** | None | `QcInspection` per GRN line when `Warehouse.qcInboundEnabled`; **PENDING** blocks FEFO/sale FEFO via `expectedQty` hold |
| **Quarantine workflow** | Recall quarantine to DAMAGE_AREA only | QC path: `QC_REJECT` + `QUARANTINE_IN`; **release** `QUARANTINE_OUT` + `TRANSFER_IN`; **dispose** `LOSS` with recall-safe `refType` |
| **Recall freeze / release** | All outbound blocked on ACTIVE recall | `BatchRecall.allocationReleasedAt` — FEFO + ledger outbound allowed after authorized **release**; `POST /inventory/recalls/:id/release-allocation` |
| **Ledger types** | No QC/quarantine-specific types | `QC_REJECT`, `QUARANTINE_IN`, `QUARANTINE_OUT` (additive enum) |
| **Audit / export** | Scattered | `WarehouseAuditEvent` + `GET /warehouse/:id/audit/export.csv` (QC, quarantine, recall, zone, escalation) |
| **Threshold escalation** | N/A | `qcEscalationFailedQtyThreshold` → `escalationFlag` + audit `ESCALATION`; optional `poReceiveEscalationMinTotal` on GRN receive vs PO `grandTotal` |

### Reusable existing flows

- `ledger.service.recordLedgerEntryInTx` for all stock mutations.
- `allocateVariantFifo` + `getAvailableLotsFEFO` share **pending QC** and **recall freeze** rules via `stockAvailability.service.ts`.
- Existing `BatchRecall` / `quarantineLot` / resolve flows unchanged; new **allocation release** is additive.
- `InventoryLocationType.QUARANTINE` / `DAMAGE_AREA` for QC quarantine targets.

### Missing schema (now added)

- Migration `20260430140000_warehouse_phase4_qc_zones_audit`: enums + `warehouse_zones`, `qc_inspections`, `warehouse_audit_events`; `warehouses` QC columns; `batch_recalls.allocationReleasedAt`; `inventory_locations.zoneId`; `StockLedgerType` + `WarehouseStaffRole` values.

### Implementation order (executed)

1. Schema + migration + `prisma generate`.
2. `stockAvailability.service` + FEFO + ledger FEFO + recall gate + `QUARANTINE_IN` balance create + recall outbound bypass refTypes for QC release/dispose.
3. `grn.service` receive: create `QcInspection` when QC enabled; PO value escalation audit.
4. `qc_inspections` module (queue, submit, quarantine release/dispose, escalations list).
5. `warehouse_zones` + warehouse routes (zones CRUD, location zone, CSV export).
6. `batchRecall` `releaseRecallAllocation` + route.
7. Permissions: seed + `branchRoles` + `permissionsRegistry`.
8. Owner/staff UI: zones, QC queue/detail, quarantine, audit/recall; sidebar QC link.

### Phase 4 QA checklist

- [ ] Apply migration `20260430140000_warehouse_phase4_qc_zones_audit`; `npx prisma generate`; re-seed or sync permissions for new keys.
- [ ] Enable **Inbound QC** on a warehouse; receive GRN at linked location → `qc_inspections` rows **PENDING**; FEFO / allocation shortfall until inspection submitted.
- [ ] Submit QC: all pass → no extra ledger; partial fail + **QUARANTINE** → `QC_REJECT` + `QUARANTINE_IN`; release → `QUARANTINE_OUT` + `TRANSFER_IN`; dispose → `LOSS`.
- [ ] Active **recall**: FEFO excludes lot; `sendDispatch` TRANSFER_OUT blocked; **release allocation** → FEFO includes lot; outbound allowed.
- [ ] `GET /warehouse/:id/zones` CRUD; assign `zoneId` on a linked location.
- [ ] `GET /warehouse/:id/audit/export.csv` returns rows after QC/recall actions.
- [ ] Owner pages: `/owner/warehouse/[id]/zones|qc|quarantine|audit`; staff `/staff/branch/.../warehouse/qc`.
- [ ] Assign **QC_OFFICER** / **AUDIT_OFFICER** on warehouse staff; legacy flows (PO, pick, dispatch, POD) still work with QC off.

### Deferred (later analytics / reporting)

- Full pagination on QC/quarantine tables; richer recall UI than audit page; automated PO anomaly rules beyond grand-total threshold; zone pick-path optimization; branch permission UI for every new key (seed + branch matrix updated, UI may lag).

---

## Phase 5 stabilization and deferred completion

Audit / execution: 2026-03-27.

### Current risks

- **Enum migration**: `WarehouseAuditCategory.OPERATIONS` requires migration `20260431120000_warehouse_audit_operations_category` on every DB before `prisma generate` matches runtime.
- **Partial pick behavior change**: Pick completion no longer auto-fills zero lines to full quantity; staff must enter picked amounts (or save per line). Handoff ships **only lines with `quantityPicked > 0`**.
- **Medicine requisition + pick**: `createDispatch` now supports `medicineRequisitionId` with `stockRequestId: null`; existing owner “FEFO dispatch” on requisitions remains separate and still sets `stockDispatchId` directly.
- **Receive + MR status**: Branch receive against a medicine-requisition dispatch updates `MedicineRequisition` to `PARTIALLY_RECEIVED` / `RECEIVED` and sets `completedAt` when fully received.

### Compile / runtime issues addressed

- **`inventory.service.ts`**: `locationVariantConfig` map typing fixed so `cfg.minStock` / `cfg.reorderPoint` are valid (`CfgSlice` + `Map<string, CfgSlice>`).
- **`dispatches.service.ts`**: `stockRequestId` nullable dispatch path; guarded `findUnique` on null `stockRequestId` in `sendDispatch` / `receiveDispatch`; medicine linkage on send/receive.
- **TypeScript**: `npx tsc --noEmit` clean after Phase 5 changes (post-migration + `prisma generate`).

### Deferred items (closed in this phase)

1. Owner **bulk receive** optional `purchaseOrderId` (API + UI); receipts list/detail show linked PO.
2. **Medicine requisition → pick handoff** via `handoffToDispatch` + `createDispatch` medicine branch.
3. **Partial pick** backend rules + staff pick UI (per-line qty + zone grouping + review strip).
4. **Zone context** on pick lines (`location.zone`) for hints / grouping.
5. **Owner recall workspace**: allocation frozen vs released column + detail + **Release allocation** action.

### Still deferred (later analytics / optimization only)

- Pick path / route optimization beyond zone grouping.
- Full owner “recall command center” with charts and multi-warehouse drilldowns.
- Automated PO fraud / anomaly detection beyond existing escalation threshold.
- Pagination + export on all warehouse operational tables.

### Implementation order (executed)

1. TS stabilization (`inventory.service.ts`) + `tsc` verification.
2. Prisma enum `OPERATIONS` + `logWarehouseAudit` helper + audit hooks (PO, allocation, pick, POD, QC settings, zones).
3. Dispatch/pick: medicine handoff, partial pick, pick-list zone includes.
4. GRN list/detail `purchaseOrder` + bulk receive `purchaseOrderId`.
5. Owner/staff UI updates + `pickListUpdateLine` client helper.
6. Progress doc + QA checklist below.

### QA checklist (manual)

- [ ] Apply migration `20260431120000_warehouse_audit_operations_category`; `npx prisma generate`.
- [ ] **QC off**: inbound receive → no `QcInspection` block; pick/dispatch unchanged.
- [ ] **QC on**: receive → pending QC blocks FEFO until inspection submitted.
- [ ] **PO-linked GRN**: bulk receive with PO → GRN has `purchaseOrderId`; PO `receivedQty` / status update on receive.
- [ ] **Non-PO GRN**: bulk receive without PO still works; vendor optional on warehouse location.
- [ ] **Stock request**: allocation → pick (partial lines) → complete → handoff → `createDispatch` with `pickListId` validates picked subset only.
- [ ] **Medicine requisition**: allocation from MR → pick → handoff → dispatch created with `stockRequestId` null; MR `stockDispatchId` set; send → MR `DISPATCHED`; receive → MR `PARTIALLY_RECEIVED` / `RECEIVED`.
- [ ] **Partial pick**: leave some lines at 0 picked; complete succeeds; handoff only includes lines &gt; 0.
- [ ] **Zone-aware pick**: lines show zone grouping when `InventoryLocation.zoneId` set.
- [ ] **POD**: delivery complete without recipient name → 400; with name → success + `OPERATIONS` / `POD_COMPLETE` audit where applicable.
- [ ] **Recall**: active recall without release → FEFO excludes lot; after **release allocation** → FEFO includes lot; quarantine flows unchanged.
- [ ] **Quarantine**: QC reject → quarantine; release/dispose still affect availability per Phase 4 rules.
- [ ] **Owner vs staff**: owner PO/receipts; staff pick lists; permissions unchanged except new audit rows (export may include `OPERATIONS` + `ZONE` actions).
- [ ] **Warehouse assignment**: delivery POD audit uses `fromLocation.warehouseId` when present.

### Drift diagnosis: `purchase_orders` / P2021 / P2022

**Facts (repo):**

- `PurchaseOrder` is defined in `prisma/schema.prisma` with `@@map("purchase_orders")` — physical table name **`purchase_orders`** (snake_case), not `PurchaseOrder`.
- Tables **`purchase_orders`**, **`purchase_order_lines`**, **`allocation_plans`**, **`allocation_plan_lines`**, **`pick_lists`**, **`pick_list_lines`**, **`proof_of_deliveries`**, and GRN column **`grns.purchaseOrderId`** are created in migration **`20260429120000_warehouse_enterprise_po_allocation_pick_pod`** (after **`20260428150000_central_warehouse_foundation`**, which adds `inventory_locations.warehouseId` and warehouse core tables).
- If Prisma reports **the table does not exist**, the usual root cause is **(2) migration not applied** on the database behind the running `DATABASE_URL`, or **(4) wrong database** (e.g. API points at empty/old DB while `migrate status` was run against another).

**Verify the DB your API uses:**

```bash
cd backend-api
npx prisma migrate status
npm run verify:warehouse-enterprise-db
```

**Repair the full chain (local/staging/prod):**

```bash
npx prisma migrate deploy
npx prisma generate
```

If `migrate deploy` reports failed migrations, resolve per Prisma docs (`migrate resolve`) after fixing SQL or DB state; do not “fix” by removing `PurchaseOrder` from code.

**API hardening:** Purchase order routes map Prisma **P2021** (missing table) and **P2022** (missing column) to **HTTP 503** with `code: DATABASE_SCHEMA_DRIFT` and a migration hint (`src/api/v1/utils/prismaSchemaDriftResponse.ts`).
