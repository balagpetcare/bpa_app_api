# Vendor Invoice Receive + Branch Manager Confirmation + Print Documents + Central Pricing/Discount Governance

**Project:** BPA/WPA warehouse and branch distribution
**Document type:** Full implementation plan (planning only — no code in this step)
**Date:** 2026-04-04
**Status:** Draft — ready for technical review
**Related:** `WINDSURF_GLOBAL_RULE.md` (plan-first, docs in `/docs`), `WAREHOUSE_INTERNAL_DELIVERY_AUDIT_AND_GAP_REPORT.md`, `WAREHOUSE_PROCUREMENT_AND_RECEIVING_ENTERPRISE_PLAN.md`, `ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md`
**Supersedes narrative draft:** Content from `vendor_receive_branch_confirmation_pricing_governance_plan.md` is consolidated here; keep a single source of truth under this filename.

---

## 1. Purpose and scope

This document is the **implementation plan** (phased, with touch points, schema/API notes, risks, and migrations) for:

1. **Vendor invoice–aligned procurement receiving** at the warehouse (with verification before stock becomes available).
2. **Branch manager confirmation** before branch inventory increases on internal dispatch receive.
3. **Printable operational documents** (PO, GRN, challan, worksheets, acknowledgments).
4. **Central pricing and discount governance** (MRP/base/floor, branch overrides within policy, auditable changes).

**Out of scope for this plan’s implementation phases:** customer home delivery, full GL/accounting automation, multi-currency pricing, AI auto-pricing.

---

## 2. Current state analysis (evidence-based)

### 2.1 Backend — procurement / vendor GRN

| Area | What exists | Evidence / files |
|------|-------------|------------------|
| GRN lifecycle | `GrnStatus`: `DRAFT` → `receiveGrn` → `RECEIVED` | `prisma/schema.prisma` (`Grn`, `GrnLine`); `grn.service.ts` |
| Draft create | `createGrn` always creates `status: DRAFT` | `grn.service.ts` `createGrn` |
| Ledger post | `receiveGrn` writes `StockLedger` `GRN_IN`, lots, updates PO lines | `grn.service.ts` `receiveGrn` |
| APIs | `POST /api/v1/grn`, `PATCH /api/v1/grn/:id`, `POST /api/v1/grn/:id/receive` | `grn.controller.ts`, `grn.routes` |
| Bulk / PO fast path | **`createAndReceiveGrn`** creates draft then immediately calls `receiveGrn` — **single atomic post** | `grn.service.ts`; invoked from `inventory.controller` `createBulkReceipt` — `POST /api/v1/inventory/receipts/bulk` |
| Invoice metadata | `invoiceNo`, `invoiceDate` on `Grn` | Schema |
| Line discrepancies | `quantityDamaged`, `quantityShort` on `GrnLine` | Schema; validated in bulk validator |
| Idempotency | `receiveIdempotencyKey` on org+GRN | Schema, `createGrn` / `createAndReceiveGrn` |

**Gap vs policy “no stock before manager confirmation”:** The **bulk receive** path posts inventory in one shot. Separating **who may create/edit DRAFT** vs **who may `receiveGrn` (post)** is partially expressible via RBAC (`grn.create` vs `grn.post`), but the **default product behavior** still encourages immediate posting via `createAndReceiveGrn`. There is **no first-class “receive session”** or **warehouse manager approval record** on `Grn` beyond `receivedByUserId` at post time.

### 2.2 Backend — branch receive (internal dispatch)

| Area | What exists | Evidence / files |
|------|-------------|------------------|
| Receive API | `POST /api/v1/inventory/dispatches/:id/receive` | `dispatches.routes.ts` |
| Behavior | **Single transaction:** updates `StockDispatchItem` received/damaged/short, **writes `TRANSFER_IN` / `DAMAGE` ledger immediately**, creates **`Grn` with `status: RECEIVED`**, may set dispatch `DELIVERED` | `dispatches.service.ts` `receiveDispatch` |
| Partial receive | Supported; running totals on dispatch lines | Same |
| SR linkage | `markStockRequestStatusFromDispatchReceive` | `dispatches.service.ts` |
| Discrepancy side model | `StockDispatchDiscrepancy` exists (reporting/resolution workflow) | Schema |

**Gap:** There is **no draft branch receive** and **no manager confirmation gate** before ledger posting. Posting is **immediate** on `receiveDispatch`.

### 2.3 Backend — ledger posting timing (summary)

| Flow | When ledger moves today | Target policy (this plan) |
|------|-------------------------|-----------------------------|
| Vendor GRN | On `receiveGrn` (after optional DRAFT) | **After** warehouse manager confirmation (may still use DRAFT for data entry) |
| Bulk receive | Same call chain as receive — **immediate** | **After** confirmation; split create vs post |
| Dispatch receive | **Immediate** `TRANSFER_IN` | **After** branch manager confirmation; optional staff “verification” step without ledger |

### 2.4 Backend / product — pricing & discounts

| Area | What exists | Notes |
|------|-------------|--------|
| Org catalog pricing | `ProductPricing` (`basePrice`, `markupPercent`, `minPrice`, `maxPrice`, effective dates) | Org-level; unique per org+variant |
| Branch override | `BranchPricing` (`overridePrice`, effective dates) | Optional branch-level selling override |
| Location price | `LocationPrice` | Per location/variant |
| Clinic discounts | `DiscountPolicy`, `DiscountApprovalRule`, `DiscountAuditLog` — **clinic case / service scope** | **Not** retail POS product-line discount engine; branch-scoped |
| Catalog enable | `CatalogEnableRequest.requestedPrice` | Branch asks; approval workflow |

**Gap:** “Central MRP” as a **dedicated governed field** may live in product/variant or pricing modules — confirm effective price resolution in checkout/POS code paths before enforcing “no unauthorized price change.” Retail **inventory selling** discounts may need **new or extended** rules beyond clinic `DiscountPolicy` (scope is service/package oriented in schema).

### 2.5 RBAC (permissions)

Relevant keys already in `seedRolesPermissions.ts` (non-exhaustive):

- **Receiving / GRN:** `purchase.receive`, `grn.create`, `grn.post`, `grn.view`, `grn.void`, `inbound.grn`, `inbound.receive`, `batch.manage`, `barcode.manage`
- **Dispatch / branch receive:** `dispatch.view`, `dispatch.create`, `dispatch.manage`, `inventory.receive`
- **Pricing (manager):** `manager.pricing.view`, `manager.discount.apply`
- **Clinic discount admin:** `clinic.discount.approve`, `clinic.discount.apply`, etc.

**Gap:** No distinct **`grn.confirm.manager`** or **`dispatch.receive.confirm.branch_manager`** style keys yet; branch “receive” may be overloaded between **staff entry** and **manager approval**.

### 2.6 Frontend (bpa_web) — touch points

| Area | Pages / components | Role |
|------|-------------------|------|
| Owner receipts / GRN | `app/owner/(larkon)/inventory/receipts/page.tsx`, `receipts/bulk/BulkReceivePage.tsx`, `SelectedReceiveGrid.tsx` | Bulk receive, PO context, template download |
| Purchase orders | `inventory/purchase-orders/[id]/page.tsx`, `PurchaseOrderCreateForm.tsx`, `POProductPicker.tsx` | PO create, link to receive |
| Staff branch receive | `app/staff/(larkon)/branch/[branchId]/inventory/receive/page.jsx`, `receive-po/` (new), dispatch receive flows | Incoming / receive UX |
| API client | `lib/api.ts` — `purchaseOrders*`, `grnGet`, `inventory dispatches receive`, `pending-po-receipts`, bulk receipt helpers | Contract surface |

**Gap:** UI does not yet implement a **two-step** “save verification → manager confirms → post” for warehouse bulk receive or for branch dispatch receive (aligned with backend gap).

---

## 3. Required changes by domain (1–7)

Cross-reference for implementation; details roll into phases below.

| # | Domain | Current behavior | Must change to |
|---|--------|------------------|----------------|
| **1** | Procurement receive | DRAFT + receive split exists for manual API; **bulk path posts immediately** | Default bulk flow: **draft/save** → **manager confirm** → `receiveGrn`; optional “emergency” path behind strong RBAC + audit |
| **2** | Branch receive confirmation | **None**; `receiveDispatch` posts ledger immediately | Introduce **verification state** (dispatch items / side table) and **confirm** action that performs current ledger+GRN logic |
| **3** | Ledger posting timing | GRN_IN on `receiveGrn`; TRANSFER_IN inside `receiveDispatch` | **Defer** both until respective manager confirmations; keep draft data in DRAFT GRN or pending receive entity |
| **4** | Print documents | Some list/print affordances on receipts page; no unified doc set | Server- or client-rendered **print templates** for PO, GRN, challan, branch acknowledgment; consistent branding fields |
| **5** | Pricing governance | `ProductPricing` / `BranchPricing` / `LocationPrice` exist | **Policy layer:** who can write; approval for overrides; effective-date audits; optional explicit **MRP** field if not centralized today |
| **6** | Discount rules | Clinic `DiscountPolicy` + approval rules | **Either** extend scope to **retail product** discount types **or** add parallel **RetailDiscountRule**; unify “floor price” enforcement at sale time |
| **7** | RBAC | Broad warehouse + GRN keys | Add **confirm**-scoped permissions; map staff vs branch manager vs owner; enforce on new endpoints |

---

## 4. Phased implementation plan

Each phase includes: **business goal**, **backend**, **frontend**, **schema**, **API**, **risks**, **migration notes**.

---

### Phase 1 — Warehouse receive: draft vs post + manager gate (foundation)

**Business goal**
Stop **accidental** stock posting from warehouse receiving before an authorized manager confirms quantities and discrepancies (especially for PO/bulk flows).

**Backend files / modules (reuse)**
- **Reuse:** `grn.service.ts` (`createGrn`, `receiveGrn`, `updateGrn`), `purchaseOrder.service.ts` (PO line rollup after receive), `inventory.controller.ts` bulk handler, `resolveWarehouse` / warehouse validation if PO lines are warehouse-scoped.
- **Change:** `createAndReceiveGrn` / `createBulkReceipt`: add modes or new endpoints — **create-only** vs **confirm-receive**; optionally `POST .../grn/:id/submit-for-approval` + `POST .../grn/:id/confirm` (naming TBD) where **confirm** = current `receiveGrn`.
- **New (lightweight):** Optional `Grn` fields or related `GrnApproval` row: `submittedAt`, `submittedByUserId`, `confirmedByUserId`, `confirmationNote` (avoid duplicating full “ReceiveSession” from scratch if `Grn` DRAFT suffices).

**Frontend pages / components (reuse)**
- **Reuse:** `BulkReceivePage.tsx`, `SelectedReceiveGrid.tsx`, `receipts/page.tsx`.
- **Change:** Multi-step UX: **Save draft** → **Submit for confirmation** (optional) → **Manager confirm** (calls post). Disable “instant post” for roles without `grn.post` + new confirm permission where required.

**Schema impact**
- **Minimal:** Add nullable confirmation/submission columns on `Grn` **or** small `GrnConfirmation` / approval table (prefer minimal columns on `Grn` to avoid join explosion).
- **No** duplicate `ReceiveSession` tables unless product needs multiple drafts per PO (defer to Phase 2 if needed).

**API changes**
- Split **`POST /inventory/receipts/bulk`** behavior: body flag `postImmediately: false` default vs legacy `true` for backward compatibility **or** new route `POST .../receipts/bulk-draft`.
- Ensure `POST /api/v1/grn/:id/receive` remains the **single ledger post** entry point for vendor GRN.

**Risks**
- **Training:** Users accustomed to one-click bulk receive.
- **Backward compatibility:** Integrations using bulk must be identified.
- **Performance:** Extra round trips acceptable for governance.

**Migration notes**
- Non-destructive: additive columns / new endpoints; follow `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`.
- Feature flag or org setting: `requireManagerConfirmForPoReceive` to roll out gradually.

---

### Phase 2 — Branch receive: verification draft + manager confirmation

**Business goal**
Branch inventory must not increase until **branch manager** confirms accepted quantities; staff can record counts and discrepancies first.

**Backend files / modules (reuse)**
- **Reuse:** `dispatches.service.ts` `receiveDispatch`, `stock_requests.service.ts` `markStockRequestStatusFromDispatchReceive`, `createDispatchDiscrepancy`.
- **Change:** Introduce **pending receive** state:
  - **Option A (preferred):** New tables `DispatchReceiveSession` + lines holding **proposed** quantities; **confirm** applies current `receiveDispatch` logic in one transaction.
  - **Option B:** Use `StockDispatchItem` extra columns for `quantityVerified` vs `quantityConfirmed` — more invasive on hot path.
- **Reuse:** `Grn` for transfer-in documentation — create **DRAFT** GRN on confirm only, or create GRN on confirm only (align with vendor pattern).

**Frontend pages / components (reuse)**
- **Reuse:** Staff `inventory/receive` pages, dispatch detail, `lib/api.ts` `inventoryReceiveDispatch`.
- **Change:** Two-step screens: **Verify** (staff) → **Confirm** (manager); manager role gate.

**Schema impact**
- New **DispatchReceiveSession** (or equivalent): `stockDispatchId`, `status` (DRAFT_VERIFIED | CONFIRMED), `verifiedByUserId`, `confirmedByUserId`, `confirmedAt`, `notes`.
- Lines: link to `StockDispatchItem`, proposed received/damaged/short.

**API changes**
- `POST /dispatches/:id/receive-verification` — saves draft, **no ledger**.
- `POST /dispatches/:id/receive-confirm` — performs ledger + GRN + status updates (refactor existing `receiveDispatch` body into shared core).
- Deprecate direct posting for non-manager clients or require `confirm: true` with permission.

**Risks**
- **Concurrency:** Two users editing verification — use versioning or last-write-wins + lock.
- **Partial receive:** Already supported; confirm must aggregate correctly.
- **Mobile offline:** Deferred; document as non-goal for v1.

**Migration notes**
- Existing flows: migration period where old `POST .../receive` redirects to **confirm** if session missing (feature flag).

---

### Phase 3 — Print documents

**Business goal**
Every controlled movement has a **printable** PO, worksheet, GRN, challan, and branch acknowledgment with signature blocks and discrepancy lines.

**Backend files / modules (reuse)**
- **Reuse:** Serializers from `purchaseOrder.service.ts`, `grn.service.ts` `getGrnById`, `dispatches.service.ts` dispatch detail, `pickList.service.ts` for pick docs.
- **New:** Thin **print DTO** builders + optional **PDF** (e.g. existing stack in repo — follow project conventions) or **HTML print routes** returning print-friendly layout.

**Frontend pages / components (reuse)**
- **Reuse:** Owner receipts, PO detail, pick list pages, staff receive — add **Print** / **Preview** using query param or modal.
- **Pattern:** WowDash-compliant; no redesign — add print CSS (`@media print`) where already listing tables.

**Schema impact**
- **None** required if documents are generated from existing entities; optional `documentNumber` cache on `Grn` / `StockDispatch` if legal numbering required.

**API changes**
- `GET /api/v1/grn/:id/print` (HTML or PDF), `GET /api/v1/inventory/dispatches/:id/print-challan`, `GET /api/v1/purchase-orders/:id/print` — **read-only**, `inventory.read` / `dispatch.view` / `grn.view` as appropriate.

**Risks**
- **Locale / RTL:** defer.
- **Performance:** Generate on demand vs cached PDF.

**Migration notes**
- No DB migration if print-only; deploy API + UI together.

---

### Phase 4 — Central pricing governance

**Business goal**
**MRP / base / floor** and branch overrides are **central-policy** driven; changes are **auditable** and **effective-dated**.

**Backend files / modules (reuse)**
- **Reuse:** `ProductPricing`, `BranchPricing`, `LocationPrice` — services touching these (search `productPricing`, `branchPricing` in `src/api/v1/modules`).
- **Change:** Centralize **write** paths behind a **pricing service** with validation: floor ≤ base ≤ MRP (domain rules), effective date overlap checks, org isolation.

**Frontend pages / components (reuse)**
- **Reuse:** Owner product / catalog pricing screens (locate existing owner inventory product edit).
- **Change:** Separate **view** vs **edit** by permission; show **pending approval** if workflow added.

**Schema impact**
- Optional: `mrp` on `ProductPricing` if MRP not stored today; **audit table** `ProductPricingAudit` (who/when/old/new) if history not in generic audit.

**API changes**
- Consolidate PATCH endpoints under `requirePermission` keys such as `pricing.central.write`, `pricing.branch.override.request`.

**Risks**
- **Checkout drift:** All sale price resolution must use one **effective price** function.
- **Historical orders:** Must snapshot prices on `OrderItem` (already may exist — verify).

**Migration notes**
- Backfill `ProductPricing` from variant defaults where missing.

---

### Phase 5 — Discount rules (retail / inventory selling)

**Business goal**
Branch discounts are **policy-bound**; manual discounts above threshold require **approval**; selling below **floor** blocked unless explicitly authorized.

**Backend files / modules (reuse)**
- **Reuse pattern from:** Clinic `DiscountPolicy`, `DiscountApprovalRule`, `DiscountAuditLog` (`clinic.routes.ts` discount routes) — **mirror concepts**, not necessarily same tables.
- **Option A:** Extend `DiscountPolicy` with `productId` / `variantId` scope and `DiscountScope` enum values for **RETAIL_PRODUCT**.
- **Option B:** New `RetailDiscountRule` table linked to `orgId` / `branchId` / `variantId`.

**Frontend pages / components**
- Owner: discount rule admin (parallel to clinic discount admin where applicable).
- Branch: POS / sale UI — enforce caps (may be outside `bpa_web` if POS separate; document integration point).

**Schema impact**
- Depends on Option A vs B; prefer **minimal extension** of existing tables if enum and JSON scopes can express product rules.

**API changes**
- CRUD for retail discount rules; `POST .../apply-discount` validation endpoint for basket line.

**Risks**
- **Clinic vs retail** collision if one table serves both — use `scope` discriminator clearly.

**Migration notes**
- Seed default policies per org; non-destructive.

---

### Phase 6 — RBAC hardening and audit reporting

**Business goal**
Permissions match the **separation of duties**: draft receive vs post vs branch verify vs branch confirm vs pricing write.

**Backend files / modules (reuse)**
- **Reuse:** `requirePermission.ts`, `seedRolesPermissions.ts`, `permissionsRegistry.service.ts`.
- **Change:** New keys, e.g. `grn.confirm.warehouse_manager`, `dispatch.receive.verify`, `dispatch.receive.confirm.branch_manager`, `pricing.central.write`, `pricing.branch.override`, `retail.discount.apply`, `retail.discount.approve`.
- Assign to `WAREHOUSE_MANAGER`, `BRANCH_MANAGER`, `RECEIVING_STAFF`, etc. per `branchRoles.ts`.

**Frontend**
- **Reuse:** `lib/auth.ts`, route guards, `staffInventoryRoutes.js`, `branchSidebarConfig.ts`.
- **Change:** Hide confirm buttons unless permission; align with API 403 handling.

**Schema impact**
- None for RBAC alone (permission strings in seed).

**API changes**
- Apply new middleware to Phase 1–5 routes.

**Risks**
- **Drift** between web and API — automated checklist or integration test for critical routes.

**Migration notes**
- Seed migration adds keys; run role sync in controlled environments; document **403** recovery for missing keys.

---

## 5. Consolidated risk register (cross-phase)

| Risk | Mitigation |
|------|------------|
| Dual transfer architectures (`StockTransfer` vs dispatch) | Keep this plan focused on **dispatch receive**; document golden path (see §7). |
| Bulk receive bypass | Phase 1 closes the default bypass. |
| Branch receive double-posting | Idempotency keys + session status machine. |
| Pricing enforcement bypass at POS | Single pricing service + integration contract for POS. |
| Clinic vs retail discount confusion | Clear naming and scope in schema and UI. |

---

## 6. Recommended golden flow (end-to-end)

1. **Owner** creates **PO** → vendor delivers → **warehouse staff** enters **draft GRN** (lines + invoice ref + discrepancies).
2. **Warehouse manager** confirms → **`receiveGrn`** → **GRN_IN** ledger → QC/putaway as today.
3. **Branch** requests stock → allocation → pick → **send dispatch** (TRANSFER_OUT as implemented).
4. Goods arrive → **branch staff** records **verification** (no ledger).
5. **Branch manager** confirms → **transfer-in ledger** + **GRN** + SR status update.
6. **Sale** uses **effective price** from central policy + allowed discounts; **floor** enforced.

---

## 7. Non-negotiable rules (policy)

### 7.1 No stock posting before manager confirmation

- **Warehouse:** `GRN_IN` / sellable stock **must not** be written until **warehouse manager** (or org-configured role) confirms the **vendor receive** (DRAFT → posted). Emergency override remains a **separate** audited path (`inventory.emergency.override` already exists for bulk — keep rare and logged).
- **Branch:** **`TRANSFER_IN`** (and related DAMAGE adjustments) **must not** run until **branch manager** confirms the **dispatch receive** (after Phase 2).

### 7.2 No unauthorized price change

- **MRP / base / floor** and **branch overrides** may only change via **authorized roles** and **audited** APIs; branch users apply **discounts within policy**, not arbitrary price edits.
- POS/checkout **must** reject line prices below **effective floor** unless an explicit **approval** record exists (aligned with Phase 4–5).

---

## 8. Documentation hygiene

- **Canonical plan:** `D:\BPA_Data\backend-api\docs\VENDOR_RECEIVE_BRANCH_CONFIRMATION_PRICING_GOVERNANCE_PLAN.md`
- **Related audits:** `WAREHOUSE_INTERNAL_DELIVERY_AUDIT_AND_GAP_REPORT.md`
- **Process:** ANALYZE → PLAN → IMPLEMENT per `WINDSURF_GLOBAL_RULE.md`

---

## 9. Summary table — reuse vs build

| Component | Reuse | Build / extend |
|-----------|--------|------------------|
| Vendor GRN | `createGrn`, `receiveGrn`, PO rollup | Manager gate on bulk; optional `Grn` confirmation fields |
| Branch receive | `receiveDispatch` internals | Session + confirm API; refactor ledger into confirm |
| Ledger | `ledgerService.recordLedgerEntryInTx` | Timing only — call sites move behind confirm |
| Print | List/detail UIs | Print routes + templates |
| Pricing | `ProductPricing`, `BranchPricing` | Audit + enforcement service |
| Discounts | Clinic discount **patterns** | Retail scope or new rules |
| RBAC | `seedRolesPermissions`, `requirePermission` | New confirm/pricing keys |

---

## 10. Phase 4 — Operational pricing governance (implemented)

**Purpose:** Server-side enforcement on the real POS path (`POST /api/v1/pos/sale`) without breaking legacy behavior.

### 10.1 Org policy

- **`posPricingGovernanceEnabled`** on `OrgPricingPolicy` (default **false**): when **true**, `pos.service` `createSale` calls `assertPosSalePricingGovernance` before creating the order. Resolves list price via `pricingEngine.resolveSellingPrice`, then runs `validateRetailDiscountLine` (floor, retail rules, approval threshold, optional **approved** request id).

### 10.2 Approval consumption

- **`RetailDiscountApprovalRequest.consumedOrderId` / `consumedAt`**: set after **payment completes** (`processPayment` with `COMPLETED`), via `consumeRetailDiscountApprovalsForPaidOrder`. **`OrderItem.retailDiscountApprovalRequestId`** links the line to the approval for audit.

### 10.3 RBAC / routes

- **`pricing.routes.ts`** uses real **`requirePermission`** (403 when missing) — replaces the prior no-op helper.
- Central / branch pricing writes require **`pricing.central.write`** / **`pricing.branch.override`** (no `org.write` / `branch.write` fallback on those controllers).
- Retail discount rules / approvals aligned with **`pricing.retail.rule.manage`**, **`retail.discount.apply`**, **`retail.discount.approve`**.

### 10.4 Non-destructive deploy (production-like DB)

1. `node scripts/check-migration-integrity.js` (before).
2. `npx prisma migrate deploy` (applies `20260408120000_pos_pricing_governance_hardening` among others).
3. `node scripts/check-migration-integrity.js` (after).
4. Re-run permission seed if roles need new keys: `npx prisma db seed` (or project seed script) — see `prisma/seeders/seedRolesPermissions.ts`.

**Risk:** additive columns only; default **`posPricingGovernanceEnabled = false`** keeps existing POS behavior until an owner enables it in **Owner → Inventory → Pricing governance**.

### 10.5 Verification scenarios (manual / QA)

1. **Normal sale** — governance off: unchanged from pre–Phase 4 behavior.
2. **Governance on**, sale at list price: succeeds if list resolves and optional retail rule allows zero discount.
3. **Below floor**: rejected with `BELOW_MIN_SALE_PRICE` / POS code `PRICING_GOVERNANCE`.
4. **Discount over max %**: `EXCEEDS_MAX_DISCOUNT_PERCENT`.
5. **Over threshold without approval id**: `APPROVAL_REQUIRED` (client should request approval then retry with `retailDiscountApprovalId` on the line).
6. **Approved request**: sale with matching `retailDiscountApprovalId` completes; approval row shows `consumedOrderId`.
7. **Rejected approval**: cannot complete sale with that id (`APPROVAL_NOT_APPROVED`).
8. **Central price change** after approval: `LIST_PRICE_CHANGED` if list moves beyond tolerance vs snapshot.

---

## 11. Phase 5 — Controlled receiving and print documents (implemented)

**Purpose:** Enforce manager-confirmed stock posting for both vendor→warehouse and warehouse→branch receive flows, with printable operational documents.

### 11.1 Architecture summary

The system uses existing `VendorReceiveSession` (linked to `Grn`) and `DispatchReceiveSession` (linked to `StockDispatch`) models that were created in earlier migrations (`20260405120000_controlled_receive_sessions`, `20260406100000_grn_extra_dispatch_discrepancy_notes`). No additional schema changes were required.

### 11.2 Vendor → Warehouse receive flow

**Golden path:**
1. Staff creates a DRAFT GRN via bulk receive (PO-linked) — `POST /api/v1/inventory/receipts/bulk` with `postImmediately: false`
2. Backend auto-creates a `VendorReceiveSession` with `status: DRAFT` linked to the GRN
3. Staff records line-by-line counts: accepted, damaged, short, extra, batch/lot, expiry, discrepancy notes — all on `GrnLine`
4. Staff submits for confirmation — `POST /api/v1/grn/:id/vendor-receive/submit` → session moves to `AWAITING_CONFIRMATION`
5. Warehouse manager confirms — `POST /api/v1/grn/:id/receive` (requires `grn.confirm.warehouse_manager`) → `receiveGrn` executes:
   - Creates `StockLot` entries per line
   - Posts `GRN_IN` ledger entries (stock becomes available)
   - Creates QC inspections if warehouse has `qcInboundEnabled`
   - Syncs PO line `receivedQty`
   - Session → `POSTED` with `confirmedAt` / `confirmedByUserId`
   - Enqueues putaway tasks
6. **Stock does NOT become available until step 5**

### 11.3 Warehouse → Branch receive flow

**Golden path:**
1. Dispatch arrives at branch (status `IN_TRANSIT`)
2. Branch staff records verification — `POST /api/v1/inventory/dispatches/:id/receive` with `receiveMode: "verify"`:
   - Creates `DispatchReceiveSession` with `status: DRAFT`
   - Saves `DispatchReceiveSessionLine` per item with proposed received/damaged/short
   - **No ledger or GRN** — staff without `dispatch.receive.confirm.branch_manager` cannot default to legacy immediate
3. Staff submits — `receiveMode: "submit"` → session moves to `AWAITING_CONFIRMATION`
4. Branch manager confirms — `receiveMode: "confirm"` (requires `dispatch.receive.confirm.branch_manager`) → calls `receiveDispatchLegacyImmediate`:
   - Updates `StockDispatchItem` running totals
   - Posts `TRANSFER_IN` ledger entries (stock becomes available at branch)
   - Posts `DAMAGE` ledger for damaged quantity
   - Creates `StockDispatchDiscrepancy` rows
   - Creates transfer GRN with `status: RECEIVED`
   - Session → `POSTED`
5. **Branch stock does NOT increase until step 4**

### 11.4 Discrepancy handling

**Vendor → Warehouse:**
- `GrnLine` fields: `quantityDamaged`, `quantityShort`, `quantityExtra`, `lineDiscrepancyNote`, `lineRemarks`
- After GRN receive: `syncInboundDiscrepanciesFromGrnLines` creates `InboundDiscrepancy` rows for DAMAGED/SHORT/EXTRA
- Only `quantity` (accepted good) goes to sellable stock via `GRN_IN` ledger

**Warehouse → Branch:**
- `DispatchReceiveSessionLine` fields: `quantityReceived`, `quantityDamaged`, `quantityShort`, `reasonCode`, `lineNote`
- `StockDispatchDiscrepancy` created on confirm for DAMAGE and SHORT reason codes
- Only `quantityReceived` goes to `TRANSFER_IN` ledger; `quantityDamaged` goes to `DAMAGE` (negative) ledger

### 11.5 Print documents (all serve HTML, browser-printable)

| # | Document | Endpoint | Content |
|---|----------|----------|---------|
| 1 | Purchase Order | `GET /api/v1/purchase-orders/:id/print` | PO header, vendor, warehouse, lines with ordered/unit cost/total/received |
| 2 | Supplier receive worksheet | `GET /api/v1/purchase-orders/:id/print/worksheet` | Blank verification form with ordered qty, empty columns for invoice qty, counted, accepted, damaged, short, extra, batch, expiry, remarks |
| 3 | Warehouse GRN | `GET /api/v1/grn/:id/print` | GRN header, lines with ordered/accepted/damaged/short/extra/batch/expiry, signature blocks |
| 4 | GRN discrepancy report | `GET /api/v1/grn/:id/print/discrepancy` | Inbound discrepancies or line-level damage/short/extra summary |
| 5 | Pick list | `GET /api/v1/pick-lists/:id/print` | Pick lines with location/bin, batch, expiry, to-pick/picked, check column |
| 6 | Dispatch challan | `GET /api/v1/inventory/dispatches/:id/print/challan` | Dispatch header, transport details, items with qty sent/batch/expiry |
| 7 | Branch receive worksheet | `GET /api/v1/inventory/dispatches/:id/print/branch-worksheet` | Blank verification form with expected/actual/accepted/damaged/missing/extra/note |
| 8 | Branch receive confirmation | `GET /api/v1/inventory/dispatches/:id/print/branch-confirmation` | Cumulative received/damaged/short/extra per item, session status |
| 9 | Transfer discrepancy report | `GET /api/v1/inventory/dispatches/:id/print/discrepancy` | `StockDispatchDiscrepancy` rows with reason/qty/lot/status |

### 11.6 RBAC updates

| Permission key | Role(s) | Purpose |
|----------------|---------|---------|
| `grn.confirm.warehouse_manager` | WAREHOUSE_MANAGER, BRANCH_MANAGER | Confirm vendor GRN posting |
| `dispatch.receive.verify` | WAREHOUSE_MANAGER, RECEIVING_STAFF, BRANCH_MANAGER | Save draft verification |
| `dispatch.receive.confirm.branch_manager` | WAREHOUSE_MANAGER, BRANCH_MANAGER | Confirm dispatch receive and post stock |

- Permission keys already in `seedRolesPermissions.ts` seed
- Added to `branchRoles.ts` for branch dashboard access resolution
- `RECEIVING_STAFF` can `grn.create` + `grn.post` (for draft creation) but **cannot** `grn.confirm.warehouse_manager` (staff can draft, only manager can post)

### 11.7 Frontend updates

**Warehouse receive-po page** (`app/staff/(larkon)/branch/[branchId]/warehouse/receive-po/page.tsx`):
- Shows pending DRAFT GRNs with session status, discrepancy highlights
- GRN card with submit-for-confirmation and confirm actions (role-gated)
- Print actions: GRN print, discrepancy report, PO print, receive worksheet
- Embeds BulkReceivePage for new receive creation

**Branch dispatch receive drawer** (`app/staff/(larkon)/branch/[branchId]/inventory/receive/_components/DispatchReceiveDrawer.jsx`):
- Full controlled receive workflow: Save verification → Submit for confirmation → Confirm & post
- Pre-populates from existing `DispatchReceiveSession` lines
- Discrepancy highlighting (rows with damage/short shown in warning)
- Print buttons: challan, worksheet, confirmation receipt, discrepancy report
- Role-based button visibility (staff sees verify/submit; manager sees confirm)

**API helpers** added in `lib/api.ts`:
- `grnSubmitForConfirmation(id)`, `grnReceive(id)`
- `purchaseOrderPrintUrl(poId, kind)`, `pickListPrintUrl(pickListId)`
- Extended `dispatchPrintUrl` with `"branch-worksheet"` kind

### 11.8 Non-destructive deployment

No new migrations required — all schema entities were created in prior migrations. Deploy sequence:
1. `node scripts/check-migration-integrity.js` (before)
2. `npx prisma migrate deploy` (ensures all prior migrations applied)
3. `node scripts/check-migration-integrity.js` (after)
4. Re-run permission seed if needed: `npx prisma db seed`

### 11.9 Verification scenarios (manual / QA)

**Vendor → Warehouse:**
1. PO exact match: create bulk receive with all lines matching PO ordered qty → GRN DRAFT → submit → manager confirm → GRN RECEIVED, `GRN_IN` ledger entries, stock available
2. PO short receive: accept less than ordered → confirm → `quantityShort` on GrnLine, `InboundDiscrepancy` with SHORT type
3. PO extra receive: accept more than ordered → `quantityExtra` on GrnLine, `InboundDiscrepancy` with EXTRA type
4. PO damaged receive: mark some damaged → `quantityDamaged` on GrnLine, `InboundDiscrepancy` with DAMAGED type; only accepted qty in `GRN_IN`
5. PO batch mismatch: enter `actualBatch` different from `expectedBatch` → captured in `lineDiscrepancyNote`
6. Manager not confirmed → GRN stays DRAFT, no ledger, no stock
7. Confirmed → stock/ledger updated, putaway enqueued, QC if enabled

**Warehouse → Branch:**
8. Branch exact receive: verify all = dispatched → confirm → `TRANSFER_IN` ledger, branch stock increases
9. Branch short receive: verify less than dispatched → `StockDispatchDiscrepancy` with SHORT
10. Branch extra receive: received > dispatched → rejected by validation (total cannot exceed dispatched per batch)
11. Branch damaged receive: mark some damaged → `DAMAGE` ledger (negative), `StockDispatchDiscrepancy` with DAMAGE
12. Staff verify without confirm → session DRAFT or AWAITING_CONFIRMATION, no stock posted
13. Manager confirm → stock posted, session POSTED

**Print documents:**
14. All 9 print endpoints return well-formed HTML with A4 layout, required fields (org, source/dest, document #, date, items, signature blocks)

---

## 12. Phase 6 — Unified internal stock movement + legacy deprecation (implemented)

**Goal:** Unify all internal stock movement into a single canonical flow and safely deprecate legacy transfer systems.

### 12.1 Legacy paths identified

Three parallel internal transfer mechanisms existed:

| System | Model(s) | API Routes | UI Pages | Status |
|--------|----------|------------|----------|--------|
| **StockTransfer** | `StockTransfer`, `StockTransferItem`, `StockDiscrepancy` | `/api/v1/transfers/*` | `/owner/transfers`, `/staff/branch/[id]/inventory/transfers` | **DEPRECATED** |
| **WarehouseTransferOrder** | `WarehouseTransferOrder`, `WarehouseTransferOrderLine` | `/api/v1/inventory/warehouse-transfer-orders/*` | `/owner/inventory/warehouse-transfers` | **DEPRECATED** |
| **ClinicalStockTransfer** | `ClinicalStockTransfer` | `/api/v1/clinic/transfers/*` | `/staff/branch/[id]/clinic/transfers` | Scope-specific (clinic items); remains active |

### 12.2 Canonical flow (GOLDEN PATH)

All internal stock movement should use this flow:

```
StockRequest → AllocationPlan → PickList → StockDispatch
→ sendDispatch (TRANSFER_OUT ledger)
→ Branch Receive Session (verify/submit/confirm)
→ Manager Confirm
→ Ledger Update (TRANSFER_IN)
```

**Benefits over legacy:**
- Manager confirmation gate before stock posts
- Controlled receive session with discrepancy tracking
- Transport/challan metadata and proof of delivery
- Full audit trail via `DispatchReceiveSession` and `StockDispatchDiscrepancy`
- Integration with allocation plans, pick lists, and stock requests

### 12.3 Deprecation implementation

**Backend services deprecated:**
- `src/api/v1/modules/transfers/transfers.service.ts` — Full module deprecation header
- `src/api/v1/modules/inventory/warehouseTransferOrder.service.ts` — Full module deprecation header

**Backend controllers with blocking:**
- `transfers.controller.ts` — `createTransfer` now warns/blocks if `BLOCK_LEGACY_TRANSFERS=true`
- `warehouseTransferOrder.controller.ts` — `createWTO` now warns/blocks if `BLOCK_LEGACY_TRANSFERS=true`

**Route-level deprecation warnings:**
- `transfers.routes.ts` — Logs deprecation warning on every request
- `inventory.routes.ts` — WTO routes have `wtoDeprecationMiddleware`

**Environment variable to block new transfers:**
```bash
BLOCK_LEGACY_TRANSFERS=true  # Set to block creation of new StockTransfer/WTO
```

### 12.4 Frontend UI changes

**Owner pages updated:**
- `/owner/transfers` — Shows deprecation banner, redirects "Create" to Stock Requests
- `/owner/transfers/new` — Shows deprecation gate with recommended alternative
- `/owner/inventory/warehouse-transfers` — Shows deprecation banner, redirects "New Transfer" to Stock Requests
- `/owner/inventory/warehouse-transfers/new` — Shows deprecation gate with recommended alternative

**Menu labels updated:**
- `permissionMenu.ts` — Items marked with `deprecated: true` and "(Legacy)" suffix
- `branchSidebarConfig.ts` — Staff transfers item marked `deprecated: true`

**New behavior:**
- "Create Transfer" buttons now link to Stock Requests page
- "New Transfer" pages show deprecation notice with option to proceed (for emergency/legacy data entry)
- Legacy pages remain functional for viewing/managing existing records

### 12.5 Data safety

- **Existing records remain readable:** No schema changes, no migrations
- **Historical data intact:** All StockTransfer, WarehouseTransferOrder data persists
- **No breaking changes:** APIs continue to work for existing records
- **Gradual enforcement:** Set `BLOCK_LEGACY_TRANSFERS=true` only when ready

### 12.6 Migration path for users

1. **For new branch restock:** Create `StockRequest` → Wait for allocation → Pick → Dispatch
2. **For admin overrides:** Use direct `createDispatch` with appropriate permissions
3. **For existing WTO/StockTransfer records:** Complete them using existing flows, then use dispatch for future

### 12.7 Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Users confused by multiple paths | UI clearly labels legacy, redirects to canonical flow |
| Existing integrations break | Gradual deprecation — warn first, block later via env var |
| Historical reports affected | Legacy data remains readable, reports continue to work |
| Emergency transfers needed | Legacy forms accessible via "Continue with Legacy" option |

### 12.8 Deployment

1. Deploy backend changes (deprecation warnings active immediately)
2. Deploy frontend changes (UI shows deprecation banners)
3. Monitor logs for `[DEPRECATED]` warnings to track legacy usage
4. When legacy usage is minimal, set `BLOCK_LEGACY_TRANSFERS=true`
5. Eventually remove legacy UI pages (separate release)

---

## 13. Final hardening — transactions, visibility, QA

### 13.1 Transaction-safe flows (backend)

- **POS sale:** `createSale` uses a single `prisma.$transaction` for order creation, payment, retail discount approval consumption (when applicable), order status update, and stock movement (FEFO shop path or legacy `adjustStock` with the same transaction client). Clinic settlement ledger for visits remains after commit, as before.
- **Vendor GRN receive:** `receiveGrn` locks the GRN row (`SELECT … FOR UPDATE`) at the start of the transaction before posting stock and ledger entries.
- **Branch / dispatch receive:** Controlled confirmation runs in one transaction: lock `dispatch_receive_sessions` by dispatch, re-validate status, then `receiveDispatchLedgerInTx` (which locks the dispatch row). Legacy immediate receive uses the same in-transaction helper.

### 13.2 Ledger and approval safeguards

- **Double post / duplicate confirmation:** Session and dispatch rows are locked; receive paths re-check status before posting.
- **Retail discount approvals:** Consumed in the POS transaction; validation includes **expiry (7 days after review)** and price/order line alignment (see pricing governance implementation).
- **Idempotency:** Prefer deterministic keys on notifications and approval consumption; retries should not double-consume approvals when the order is already paid.

### 13.3 Operational API (read-only)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/inventory/operations/exception-summary` | Counts: pending vendor/dispatch receive confirmations, open discrepancies, draft GRNs, in-transit dispatches, POS orders pending/failed payment |
| `GET /api/v1/inventory/operations/pending-confirmations?limit=` | Recent rows awaiting confirmation |
| `GET /api/v1/inventory/lookup/variant-by-barcode?barcode=&orgId=` | Org-scoped variant lookup for receiving / scanning |

Permissions: `inventory.read` or `org.read`. Optional `orgId` query for multi-org users.

### 13.4 UI surfaces

- **Owner — Stock (`/owner/inventory`):** Warning banner when the exception summary total is non-zero, with link to Receipts.
- **Staff — Warehouse dashboard:** Same summary when `orgId` is available on the branch context, with link to branch receive.
- **Bulk receive:** Optional barcode field (scan or type, Enter) adds a line using catalog lookup.

### 13.5 Notifications (in-app)

- Owner is notified (system notification) when vendor receive or dispatch receive is **submitted for confirmation** (deduped keys). Extend later to email/push via the same service.

### 13.6 QA scenarios (manual / automated)

1. **POS + pricing:** Paid POS sale with approved discount → approval consumed; repeat attempt → no double consumption. Expired approval → sale rejected. Price mismatch → rejected.
2. **Vendor receive:** Submit for confirmation → owner notification; confirm → GRN posted once; second confirm → rejected or no-op per API rules.
3. **Dispatch receive:** Submit session → notification; confirm → ledger and stock updated once; duplicate confirm → error.
4. **Transfers:** Complete a stock request → dispatch → receive; balances consistent at source and destination.
5. **Exception summary:** With test data, `exception-summary` counts match UI banners; barcode lookup returns only variants in the org catalog.

---

*End of implementation plan — Phases 1–6 implemented. Controlled receiving (Phase 5) and unified stock movement (Phase 6) are operational. Section 13 documents final hardening and operational visibility.*
