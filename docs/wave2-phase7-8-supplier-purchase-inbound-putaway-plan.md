# Wave-2 — Phases 7–8: Supplier & Purchase Operations, Inbound Logistics, Putaway Optimization

**Document path:** `docs/wave2-phase7-8-supplier-purchase-inbound-putaway-plan.md`

**Governance:** Follow [`WINDSURF_GLOBAL_RULE.md`](./WINDSURF_GLOBAL_RULE.md) (plan-first, docs in `/docs` only, single source of truth). Schema changes must follow [`PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`](./PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md).

**Related (must stay compatible):**

| Phase / doc | Role |
|-------------|------|
| [`wave1-phase4-6-demand-replenishment-procurement-plan.md`](./wave1-phase4-6-demand-replenishment-procurement-plan.md) | Forecasting, replenishment suggestions, procurement intelligence, optional draft PO from AI |
| [`warehouse-phase1-foundation.md`](./warehouse-phase1-foundation.md), Phase-2/3 warehouse docs | Ledger-first inventory, locations, fulfillment |
| Existing `PurchaseOrder`, `Grn`, `Vendor`, `QcInspection`, `WarehouseZone` | Current transactional baseline |

**Repositories:**

| Role | Path |
|------|------|
| Backend API | `D:\BPA_Data\backend-api` |
| Web (Next.js) | `D:\BPA_Data\bpa_web` |

---

## 1. Executive summary

**Objective:** Evolve the existing **vendor + PO + GRN + ledger** stack into a **production-grade supplier and purchase operations** layer (Wave-2 Phase 7) and **inbound logistics + intelligent putaway** (Wave-2 Phase 8), **without** breaking ledger integrity, org/branch isolation, or Wave-1 planning hooks (forecasts, replenishment, procurement intel).

**What already works:** `Vendor` master with contacts, attachments, listings, ledger; `PurchaseOrder` with lifecycle `DRAFT → SUBMITTED → APPROVED → PARTIALLY_RECEIVED/RECEIVED` and cancel/reject; `Grn` with optional `purchaseOrderId`, `GrnLine` with good/damaged/short quantities; `receiveGrn` posts `GRN_IN` ledger lines, optional `QcInspection` rows when `Warehouse.qcInboundEnabled`; PO line `receivedQty` rollup via `applyGrnReceiveToPurchaseOrder` in `purchaseOrder.service.ts`; warehouse inbound queue API; permissions for procurement, inbound, GRN, QC, quarantine.

**What Wave-2 adds:** A clear **purchase request** channel (distinct from branch **stock requests** where needed), richer **supplier operational profile** (lead time, incoterms, ASN preference), **inbound shipment / ASN-like** documents for expected receipts, structured **discrepancy** workflows tied to PO/GRN/shipment, and **putaway recommendations** (ranked bin/zone targets with explainability) using `WarehouseZone` / `WarehouseBin` / `InventoryLocation` hierarchy—implemented as **recommendations + tasks**, with human confirmation before any secondary move if product policy requires it.

**Architectural stance:** **Append-only ledger remains canonical stock truth.** Putaway is either (a) receive-to-staging location then confirm move, or (b) receive direct to recommended bin if policy allows—both via controlled ledger/ref types already in family with transfers/adjustments. No silent cross-tenant reads; QC and procurement features remain **permission-gated**.

---

## 2. Current-state audit

### 2.1 Data model (Prisma — representative)

| Area | Models / enums | Notes |
|------|----------------|-------|
| Supplier master | `Vendor`, `VendorContact`, `VendorAttachment`, `VendorType`, `VendorStatus` | No first-class “supplier site” or ASN table today |
| Commercial | `VendorProductListing`, `VendorLedgerEntry`, `PayoutAccount` | Listings feed Wave-1 procurement ranking |
| Purchase | `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseOrderStatus` | `warehouseId` optional; totals on header |
| Inbound receipt | `Grn`, `GrnLine`, `GrnStatus` | Links: `vendorId`, `purchaseOrderId`, `stockDispatchId`, `locationId`; idempotency on dispatch receive |
| QC | `QcInspection`, `QcInspectionStatus`, `QcDisposition` | Created on receive when warehouse QC enabled; quarantine location support |
| Warehouse layout | `Warehouse`, `WarehouseZone` (`WarehouseZonePurpose`), `WarehouseRack`, `WarehouseBin`, `InventoryLocation` | Locations can reference zone/bin; **no putaway suggestion table** |
| Discrepancy (dispatch) | `StockDispatchDiscrepancy` | Pattern for mismatch lifecycle exists for outbound dispatch receive |
| Branch demand | `StockRequest`, `StockRequestItem`, `LocationVariantConfig` | Replenishment “accept” creates draft stock request (Wave-1) |
| Planning | `AiReplenishmentSuggestion`, `AiProcurementRecommendation`, … | Must reference PO/GRN data as today |

### 2.2 Backend modules (actual paths)

| Concern | Path |
|---------|------|
| Purchase orders | `src/api/v1/modules/purchase_orders/` (`purchaseOrder.service.ts`, `purchaseOrder.controller.ts`, `purchaseOrder.routes.ts`) |
| GRN | `src/api/v1/modules/grn/` (`grn.service.ts` — `receiveGrn`, `bulkReceive`, `updateGrn`) |
| Vendors | `src/api/v1/modules/vendors/` |
| Vendor payments | `src/api/v1/modules/vendor_payments/` |
| Warehouse CRUD + ops | `src/api/v1/modules/warehouse/` (`warehouseOperations.service.ts` — `listInboundQueue`, dashboard) |
| Warehouse zones | `src/api/v1/modules/warehouse_zones/` |
| QC | `src/api/v1/modules/qc_inspections/` (`qcInspection.routes.ts` — list, submit, quarantine release/dispose) |
| AI / planning | `src/api/v1/modules/ai_intelligence/` |
| Stock requests | `src/api/v1/modules/stock_requests/` |
| Permissions | `src/api/v1/services/permissionsRegistry.service.ts` |

### 2.3 API mounting (`src/api/v1/routes.ts`)

- `/api/v1/purchase-orders` — PO CRUD lifecycle
- `/api/v1/grn` — GRN create/update/receive
- `/api/v1/vendors`, `/api/v1/vendor-payments`
- `/api/v1/warehouses` — includes `/:id/operations/inbound`
- `/api/v1/qc-inspections`
- `/api/v1/ai/*` — forecast, replenishment, procurement (Wave-1)

### 2.4 Frontend (`bpa_web`) — existing touchpoints

| Area | Example paths |
|------|----------------|
| Owner POs | `app/owner/(larkon)/inventory/purchase-orders/` (list, `[id]`, `new`, `_components/PurchaseOrderCreateForm.tsx`) |
| Receipts | `app/owner/(larkon)/inventory/receipts/`, `receipts/bulk/` (BulkReceivePage, etc.) |
| Planning / procurement intel | `app/owner/(larkon)/inventory/planning/`, `procurement-intelligence/`, `control-tower/` |
| Staff receive dispatch | `app/staff/(larkon)/branch/[branchId]/inventory/receive-dispatch/[dispatchId]/page.tsx` |
| Admin warehouse | `app/admin/(larkon)/inventory/warehouse/` |

**Gap:** No dedicated **inbound shipment** UI, no **putaway task** queue, **purchase request** UX is not unified (manager permission `manager.inventory.purchase_request` exists separately from PO modules).

### 2.5 Behavioral notes (from code)

- **GRN receive** creates lots if needed, validates expiry/mfg flags on variants, writes `GRN_IN` ledger, creates vendor ledger stub, updates PO received quantities when `purchaseOrderId` set.
- **QC** is triggered per line when `qcInboundEnabled` on the warehouse tied to receive location—not a separate pre-receive gate.
- **Permissions** already separate `procurement.po.view/manage`, `inbound.*`, `inbound.grn`, `qc.*`, `quarantine.*`.

---

## 3. Assumptions

| # | Assumption |
|---|------------|
| A1 | **Org isolation** remains mandatory: every new query filters by `orgId` from branch/session; warehouse-scoped views resolve `warehouseId` via `Branch` / assignment. |
| A2 | **No auto-posting** of GRN from ASN without user confirmation**,** unless an explicit org-level automation flag is introduced later (default off). |
| A3 | **Purchase Request** (PR) is an **internal** document; **PO** is the **external** commitment to supplier. Multiple PR lines may roll into one PO after consolidation. |
| A4 | **ASN** may be **supplier-uploaded CSV/API** or **manual entry** by procurement—full EDI is out of scope for MVP. |
| A5 | **Putaway** recommendations are **heuristic** (FIFO/FEFO awareness, zone purpose, capacity hints)—not an optimization solver requirement for v1. |
| A6 | **Cold chain / regulated SKU** flags can reuse or extend `Product` / `ProductVariant` attributes if present; if missing, store in `metaJson` on putaway task. |
| A7 | Wave-1 **“create draft PO from procurement”** (when implemented) links to the same PO service—Wave-2 must not fork PO creation. |

---

## 4. Gap analysis

| Gap | Impact | Wave-2 direction |
|-----|--------|------------------|
| No `InboundShipment` / **ASN** entity | Cannot match “expected” vs “received” at shipment granularity | Add shipment + lines + status; optional link `purchaseOrderId` |
| **Purchase request** not a first-class persisted workflow | PR → PO traceability weak | Add `PurchaseRequisition` (or reuse name carefully vs “stock request”) with approval path |
| QC runs **after** ledger GRN_IN when enabled | Inventory may already show on-hand before QC pass | Phase 8 option: **staging/quarantine-first receive** policy per warehouse (config flag) |
| **Putaway** not modeled | Operators rely on tribal knowledge | `PutawayTask` + recommendation engine reading zones/bins/balances |
| **Discrepancy** for vendor PO not unified | `GrnLine` has damaged/short but limited workflow | Extend with statuses, links to `VendorReturn` / credit note story |
| **Supplier performance** partially in AI + GRN | No formal scorecard table | Optional `SupplierKpiSnapshot` or reuse analytics endpoints |
| Frontend **warehouse operator** flows | Inbound list exists API-side; putaway UX missing | Staff/owner pages per §14 |

---

## 5. Supplier master and operational model

### 5.1 Master data (extends `Vendor`)

- **Identity:** existing `code`, `name`, `status` (incl. `BLACKLISTED`), contacts, attachments.
- **Commercial:** `defaultPaymentTermsDays`, `creditLimit`, `openingBalance`, listings.
- **Wave-2 additions (proposal):**
  - `defaultLeadTimeDays`, `minOrderValue`, `currencyPreference`
  - `asnSupported` (boolean), `deliveryWindowsJson` (optional)
  - `preferredWarehouseId` (optional) for default ship-to
  - **Sites:** optional `VendorSite` (ship-from addresses) if multi-site suppliers matter.

### 5.2 Operational relationships

- **One vendor → many POs** (existing).
- **One PO → optional inbound shipments** (new).
- **One GRN → one receive event** at a `locationId`; may reference PO and optionally **shipment line** for three-way match.
- **Vendor ledger** continues to anchor payables; **returns** use `VendorReturn` / `VendorReturnLine` where applicable.

### 5.3 Governance

- **Blacklist** blocks new PO submission (validation).
- **Attachment types** already include trade license; extend policy for **GMP/certificate** expiry alerts if product requires.

---

## 6. Purchase request / PO / approval lifecycle

### 6.1 Recommended states

**Purchase requisition (internal)**

| State | Meaning |
|-------|---------|
| `DRAFT` | Editable |
| `SUBMITTED` | Awaiting approver |
| `APPROVED` | Ready to convert to PO(s) |
| `REJECTED` | Terminal |
| `CONVERTED` | Linked PO(s) created |

**Purchase order (existing + clarifications)**

| State | Meaning |
|-------|---------|
| `DRAFT` | Editable |
| `SUBMITTED` | Awaiting financial/owner approval |
| `APPROVED` | Can be sent to vendor; receipts allowed per policy |
| `PARTIALLY_RECEIVED` / `RECEIVED` | Driven by GRN rollups |
| `CANCELLED` / `REJECTED` | Terminal |

### 6.2 Flow

1. **Create PR** — from manual entry, replenishment suggestion accept (Wave-1 bridge), or branch need.
2. **Approve PR** — role keyed similarly to `procurement.po.manage` or a narrower `procurement.pr.approve`.
3. **Convert to PO** — lines map to `PurchaseOrder` + `PurchaseOrderLine`; partial conversion allowed (remaining PR lines stay open).
4. **PO submit/approve** — existing endpoints (`submit`, `approve`, `reject`, `cancel`).
5. **ASN / shipment** — optional, pre-notifies warehouse (§7).
6. **GRN receive** — existing `receiveGrn`; ties to PO.

### 6.3 Separation from `StockRequest`

- **StockRequest** = branch **internal** restock from central warehouse / fulfillment.
- **PurchaseRequisition** = **procurement** intent to buy from external vendor.
- Naming in UI: “Stock request” vs “Purchase requisition” to avoid confusion.

---

## 7. Shipment and ASN-like inbound design (practical MVP)

### 7.1 Entity sketch

**`InboundShipment`** (new)

- `orgId`, `vendorId`, optional `purchaseOrderId`
- `reference` (ASN / supplier invoice ref), `expectedArrivalAt`, `status` (`ANNOUNCED`, `IN_TRANSIT`, `ARRIVED`, `CLOSED`, `CANCELLED`)
- `shipFromJson` / `shipToWarehouseId`
- `metaJson` (carrier, tracking, container)

**`InboundShipmentLine`**

- `variantId`, `expectedQty`, optional `lotCode` / `batchHint`, link to `purchaseOrderLineId` when matched

### 7.2 Matching logic

- On GRN create/receive: suggest link to shipment line by `(variantId, PO line)` and quantity tolerances.
- **Three-way match:** PO line ordered → shipment expected → GRN received (with variance thresholds).
- **Idempotency:** ASN duplicate reference + vendor → reject or merge policy (config).

### 7.3 API surface (proposal)

- `POST/GET/PATCH /api/v1/inbound-shipments` (names TBD; mount in `routes.ts` next to `grn`).
- Webhook or **manual import** of CSV for ASN lines (MVP).

---

## 8. GRN and quality-check workflow

### 8.1 Today (as implemented)

- `receiveGrn` → `GRN_IN` at `locationId`.
- If `Warehouse.qcInboundEnabled`, **`QcInspection` PENDING** per line with `expectedQty`.
- QC API: `/api/v1/qc-inspections` list/submit/quarantine actions.

### 8.2 Target enhancements

| Topic | Enhancement |
|-------|-------------|
| **Receive-to-staging** | Config: `receiveLocationType` = `RECEIVING` zone staging bin vs final storage |
| **QC hold** | Optional block on **allocation/dispatch** for lots with open failed QC (recall-style flag or existing recall hooks) |
| **Sampling** | `QcInspection` supports partial inspection quantities (status `PARTIAL` already exists) |
| **Escalation** | Existing `poReceiveEscalationMinTotal` audit; extend to failed-QC volume vs `qcEscalationFailedQtyThreshold` |

### 8.3 Permissions

- Align UI with `qc.view`, `qc.inspect`, `qc.release`, `quarantine.manage`.

---

## 9. Inbound discrepancy handling

### 9.1 Quantity variance (vs PO / ASN)

- **Short:** `GrnLine.quantityShort` (audit-only today) → attach **reason code**, optional **auto PR** for remainder.
- **Over:** cap received to PO line max **or** split excess to **non-PO GRN** line with approval.
- **Damage:** `quantityDamaged` → `DAMAGE` ledger path if already implemented; else document in service layer.

### 9.2 Quality failure

- QC `FAILED` / `QUARANTINE` disposition → quarantine location; **no** pick from quarantine until release (align with `qc_inspections` release flow).

### 9.3 Financial discrepancy

- Price mismatch vs PO: adjustment via **vendor ledger adjustment** or credit note workflow (`VendorLedgerSourceType.ADJUSTMENT`).
- Link discrepancy record: optional **`InboundDiscrepancy`** table or reuse pattern from `StockDispatchDiscrepancy` with `sourceType` discriminator.

---

## 10. Putaway recommendation logic

### 10.1 Inputs

- `variantId`, `lotId` (expiry), `quantity`, **source** location (receiving dock / GRN location)
- `Warehouse` id, full **zone/bin** graph, `WarehouseZonePurpose`
- Current `StockLotBalance` / `StockBalance` by bin
- Product attributes: weight, temperature class, hazard flags (as available)

### 10.2 Heuristic ranking (v1)

1. **Eligibility filter:** zones with purpose `STORAGE` or `PICKING` (policy); exclude `QUARANTINE`/`DAMAGE` unless QC dictates.
2. **Same SKU affinity:** bins already holding variant (space permitting).
3. **FEFO:** prefer bins with **later-expiring** stock at front—put new lot adjacent or in deeper storage per SOP.
4. **Capacity:** soft limits from `maxUnits` on bin metadata (new field) or inferred from `LocationVariantConfig`-style max if added at bin level.
5. **Distance proxy:** rack `sortOrder` + zone `sortOrder` as pick-walk minimization proxy.

### 10.3 Output

- Ranked list: `{ toLocationId, score, reasons[] }` stored in `PutawayTask.recommendationJson`.

---

## 11. Capacity / location compatibility rules

| Rule | Mechanism |
|------|-----------|
| **Temperature** | Bin/zone tag `storageClass` enum (new) vs variant requirement |
| **Hazard / segregated** | Zone purpose `DAMAGE` / custom flag |
| **Weight / cube** | Optional `maxWeightKg`, `maxVolume` on `WarehouseBin` |
| **Mixed SKU** | Policy boolean `allowMixedSku` per bin |
| **Recall / QA hold** | Block putaway into non-quarantine if lot under inspection |

---

## 12. Data-model proposal (additive)

| Entity | Purpose |
|--------|---------|
| `PurchaseRequisition`, `PurchaseRequisitionLine` | Internal PR workflow + approval |
| `InboundShipment`, `InboundShipmentLine` | ASN-like expected receipts |
| `PutawayTask` | Open/complete putaway work; links `grnLineId` or `stockLotId`, `fromLocationId`, `toLocationId`, `status` |
| Optional `InboundDiscrepancy` | Structured variance cases |
| **Extend** `WarehouseBin` | `maxUnits`, `storageClass`, `allowMixedSku` (nullable = inherit) |
| **Extend** `Vendor` | operational fields per §5 |

**Compatibility:** Foreign keys to existing `PurchaseOrder`, `Grn`, `GrnLine`, `InventoryLocation`, `Warehouse`.

---

## 13. Backend module/file plan

| Module | Suggested location |
|--------|---------------------|
| Purchase requisitions | `src/api/v1/modules/purchase_requisitions/` (`*.routes.ts`, `*.controller.ts`, `*.service.ts`) |
| Inbound shipments | `src/api/v1/modules/inbound_shipments/` |
| Putaway | `src/api/v1/modules/putaway/` (`recommendation.service.ts`, `putawayTask.service.ts`) |
| Extend PO | `purchase_orders/purchaseOrder.service.ts` — convert from PR |
| Extend GRN | `grn/grn.service.ts` — shipment link, discrepancy hooks |
| QC | `qc_inspections/` — optional staging-first policy |
| Warehouse ops | `warehouse/warehouseOperations.service.ts` — enqueue putaway in dashboard summary |

**Jobs (optional):** `src/common/jobs/putawaySuggest.job.ts` for batch recompute; **not** required for interactive receive.

---

## 14. Frontend route/page/component plan (`bpa_web`)

| Area | Route / component |
|------|-------------------|
| Purchase requisitions | `app/owner/(larkon)/inventory/purchase-requisitions/` (list, `[id]`, `new`) |
| Inbound shipments | `app/owner/(larkon)/inventory/inbound-shipments/` + staff variant under `app/staff/(larkon)/branch/[branchId]/inventory/inbound/` |
| Putaway queue | `app/owner/(larkon)/inventory/putaway/` + staff `.../inventory/putaway/` |
| PO detail | extend `purchase-orders/[id]/page.tsx` with PR provenance + shipment links |
| Receipts | extend `receipts/` and bulk receive to show **recommended putaway** post-receive |
| Planning | link from `inventory/planning/procurement/` → “Raise PR” |

Reuse: `PageHeader`, `ownerApi` / `lib/api.ts`, existing table patterns from `purchase-orders`.

---

## 15. API contract (representative)

**Purchase requisitions**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/purchase-requisitions` | Create draft |
| `GET` | `/api/v1/purchase-requisitions` | List/filter |
| `GET` | `/api/v1/purchase-requisitions/:id` | Detail |
| `POST` | `/api/v1/purchase-requisitions/:id/submit` | Submit |
| `POST` | `/api/v1/purchase-requisitions/:id/approve` | Approve |
| `POST` | `/api/v1/purchase-requisitions/:id/reject` | Reject |
| `POST` | `/api/v1/purchase-requisitions/:id/convert-to-po` | Creates `PurchaseOrder` |

**Inbound shipments**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/inbound-shipments` | Create ASN |
| `GET` | `/api/v1/inbound-shipments` | List |
| `PATCH` | `/api/v1/inbound-shipments/:id` | Update status, tracking |
| `POST` | `/api/v1/inbound-shipments/:id/match-grn` | Link GRN lines (optional helper) |

**Putaway**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/putaway-tasks` | Queue |
| `POST` | `/api/v1/putaway-tasks/:id/confirm` | Confirm move to bin (ledger transfer) |
| `GET` | `/api/v1/putaway/recommendations?grnLineId=` | Preview ranking |

**Existing (unchanged contracts):** `/api/v1/purchase-orders/*`, `/api/v1/grn/*`, `/api/v1/qc-inspections/*`, `/api/v1/warehouses/:id/operations/inbound`.

**Response envelope:** follow existing `{ success, data, message }` patterns used in inventory modules.

---

## 16. UX flows (purchase, receiving, putaway)

### 16.1 Purchase

1. User opens **Procurement intelligence** or **Replenishment** → **Create PR**.
2. PR lines added → **Submit** → approver **Approves**.
3. **Convert to PO** → existing PO **Submit/Approve** → optional **Send** (email/pdf out of scope unless already present).
4. Optional: register **ASN** when supplier notifies.

### 16.2 Receiving

1. Warehouse opens **Inbound** queue (`/warehouses/:id/operations/inbound`).
2. Operator creates/links **GRN** (bulk or line-by-line).
3. **Receive** → ledger + PO rollup + QC tickets if enabled.
4. If variance → **Discrepancy** wizard (short/over/damage) with reason codes.

### 16.3 Putaway

1. **Putaway** queue lists tasks from receive.
2. User sees **top recommendation** + alternatives.
3. **Confirm** executes **location-to-location transfer** (or adjustment) per ledger rules.
4. Task closes; audit event logged.

---

## 17. Audit and compliance considerations

- **WarehouseAuditEvent** / `logWarehouseAudit` — extend actions: `PR_APPROVE`, `ASN_CREATE`, `PUTAWAY_CONFIRM`, `INBOUND_VARIANCE`.
- **Vendor ledger** — all payable-impacting events traceable.
- **PII** — supplier contacts; restrict export to `audit.export` and admin roles.
- **Regulated products** — QC evidence files already on `QcInspection`; retain retention policy in ops docs.

---

## 18. Migration strategy

1. **Additive migrations only** — new tables/columns; no destructive changes.
2. **Backfill:** optional script to create `PutawayTask` **completed** stubs from historical GRNs — **not default**; only if business needs audit parity.
3. **Feature flags:** `WAVE2_PR_ENABLED`, `WAVE2_ASN_ENABLED`, `WAVE2_PUTAWAY_ENABLED` (env or org settings table).
4. **Deploy order:** migrate → `migrate deploy` → integrity check script → API → frontend → enable flags per tenant.
5. **Reference:** [`PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`](./PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md).

---

## 19. Implementation sequence

1. **Schema** — `PurchaseRequisition`, `InboundShipment`, `PutawayTask`, vendor/bin extensions.
2. **Services** — PR lifecycle + convert to PO; shipment CRUD + match hooks.
3. **GRN** — optional `inboundShipmentId` / line links; discrepancy persistence.
4. **Putaway** — recommendation service + confirm transfer integration with `ledger.service` / transfer pattern.
5. **APIs** — routes + permissions in `permissionsRegistry.service.ts`.
6. **Frontend** — owner workflows first; staff warehouse second.
7. **Wave-1 bridge** — procurement “draft PO” points to same PO; add “draft PR” if product wants PR-first mandate.
8. **Docs** — update this file’s changelog when phases complete.

---

## 20. Risks, edge cases, validation checklist

| Risk | Mitigation |
|------|------------|
| Double receive | Keep GRN idempotency rules; PO line `receivedQty` caps |
| QC after ledger | Offer staging-first policy; document for auditors |
| Wrong bin putaway | Human confirm; optional scan validation phase |
| Cross-org leakage | Integration tests on `orgId` for all new routes |
| ASN drift | Allow **partial ASN close** with variance notes |

**Validation checklist**

- [ ] PR → PO conversion preserves variant/qty/cost integrity
- [ ] GRN receive updates PO status exactly as today when Wave-2 links absent
- [ ] Putaway confirm does not double-add stock
- [ ] QC quarantine blocks pick (per policy)
- [ ] Permissions: PR/ASN/putaway denied without correct keys
- [ ] Wave-1 replenishment accept still creates stock request; optional PR link does not break flow

---

## 21. Testing strategy

| Layer | Scope |
|-------|--------|
| **Unit** | Putaway scoring pure functions; three-way match tolerance math |
| **Integration** | Prisma transactions: PR → PO → GRN → PO status; putaway transfer balances |
| **API** | Jest/Supertest on new routes with auth fixtures (mirror `grn.bulkReceiveValidation.test.ts`) |
| **Regression** | Existing `purchaseOrder` + `grn` receive paths |

---

## 22. Rollback / safety strategy

- **Feature flags** off → new routes return 404 or forbidden; UI hidden.
- **Code rollback** — new tables unused; no impact on ledger.
- **Data** — soft-delete or `CANCELLED` statuses only; no hard delete of financial links.
- **Jobs** — if any batch jobs added, gate with `WAVE2_JOBS_ENABLED`.

---

## 23. Definition of done

Wave-2 Phases 7–8 are **done** when:

1. **Supplier operations:** Extended vendor profile supports procurement and ASN behavior without breaking existing vendor APIs.
2. **Purchase requisitions:** Full internal lifecycle with conversion to **existing** PO model.
3. **Inbound:** Shipment/ASN MVP supports expected vs received reconciliation.
4. **GRN + QC:** Documented and testable paths for receive, discrepancy, and QC/quarantine.
5. **Putaway:** Task queue + ranked recommendations + confirmed moves with **ledger-safe** transfers.
6. **Compatibility:** Wave-1 planning, stock requests, allocation/dispatch unchanged in default config.
7. **Frontend:** Owner (and where required staff) can run purchase → receive → putaway end-to-end.
8. **Operations:** Permissions, audit events, and rollback strategy validated.

---

**Updated:** `D:\BPA_Data\backend-api\docs\wave2-phase7-8-supplier-purchase-inbound-putaway-plan.md`
