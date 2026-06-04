# POS Enterprise Implementation Master Plan

## 1. Executive Direction

### Canonical POS decision

- **Canonical POS UI:** Staff branch route only — [`bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx`](../../bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx) (`/staff/branch/:branchId/pos`).
- **Canonical POS API surface:** [`backend-api/src/api/v1/modules/pos/`](../src/api/v1/modules/pos/) mounted at `/api/v1/pos` in [`src/api/v1/routes.ts`](../src/api/v1/routes.ts), with branch isolation via [`pos.middleware.ts`](../src/api/v1/modules/pos/pos.middleware.ts).

### Target product direction

Deliver a **counter-grade, multi-customer, membership-aware** point of sale that:

- Reuses **order + payment + ledger + pricing governance** already used by [`pos.service.ts`](../src/api/v1/modules/pos/pos.service.ts) (`createSale` → `orders.service` → `ledgerService.saleFEFOInTx`, `assertPosSalePricingGovernance`).
- Adds **explicit server-side cart sessions** (hold / resume / switch), **membership card resolution** (building on `OwnerDiscountCard` / `MembershipTier` in Prisma), **split payments**, and **reliable invoice/receipt** generation.
- Keeps **shift** controls ([`PosShift`](../prisma/schema.prisma), [`pos.routes.ts`](../src/api/v1/modules/pos/pos.routes.ts)) and extends **audit** ([`pos.audit.ts`](../src/api/v1/modules/pos/pos.audit.ts)) for cashier-grade traceability.

### Reuse-first approach

- **Do not rebuild** the sale atomic path in `pos.service.ts` without strong cause; extend it with cart finalization, payment rows, and invoice creation inside the same transactional discipline already documented in code comments there.
- **Reuse** [`lib/api.ts`](../../bpa_web/lib/api.ts) staff POS helpers (`staffPosProducts`, `staffPosBarcodeLookup`, `staffPosSale`, etc.) — evolve signatures and add new functions rather than introducing a parallel client.
- **Reuse** enterprise list resolution: [`posListPriceResolution.service.ts`](../src/api/v1/modules/pricing/posListPriceResolution.service.ts), [`posPricingPolicy.util.ts`](../src/api/v1/modules/pricing/posPricingPolicy.util.ts), and governance enforcement in [`retailDiscount.service.ts`](../src/api/v1/modules/pricing/retailDiscount.service.ts) (`assertPosSalePricingGovernance`).
- **Reuse** membership pricing backend already oriented to tiers/cards: [`enterprisePricing.controller.ts`](../src/api/v1/modules/pricing/enterprisePricing.controller.ts) (owner APIs) and Prisma [`OwnerDiscountCard`](../prisma/schema.prisma) / [`MembershipTier`](../prisma/schema.prisma) — add **branch-scoped, cashier-safe** read/validate endpoints for POS (not owner-only).

---

## 2. Current-State Constraints from Audit

These facts bound every design decision (baseline truth from code review):

1. **Staff page is the only rich integration:** tabs (sale, history, refunds, drawer), barcode, shifts, line returns — all in [`pos/page.jsx`](../../bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx) using `staffPos*` from [`lib/api.ts`](../../bpa_web/lib/api.ts).

2. **Shop POS is duplicate/legacy:** [`bpa_web/app/shop/(larkon)/pos/page.tsx`](../../bpa_web/app/shop/(larkon)/pos/page.tsx) calls the same `/api/v1/pos/*` via `apiFetch` with a different auth/branch discovery model; it must not drive product requirements.

3. **No server-side cart:** Cart is React `useState` only; **no hold/resume/switch** and no cross-tab durability.

4. **`discountPercent` / `taxPercent` on `POST /pos/sale` are not applied** in [`pos.service.ts`](../src/api/v1/modules/pos/pos.service.ts) `createSale` — `Order` model fields exist ([`schema.prisma`](../prisma/schema.prisma) `subtotalAmount`, `discountPercent`, etc.) but the current finalize path does not wire controller inputs into persisted totals (order total is sum of line `price * quantity` from [`orders.service.ts`](../src/api/v1/modules/orders/orders.service.ts) `createOrder`).

5. **`PosInvoice` rows are not created in application code** under `src/` (only `findUnique` in [`pos.service.ts`](../src/api/v1/modules/pos/pos.service.ts) `getInvoice`) — print invoice from staff UI often yields empty.

6. **Branch-scoped orders list/detail is fragile:** [`orders.controller.ts`](../src/api/v1/modules/orders/orders.controller.ts) `getOrders` / `getOrder` resolve `branchMember` with `findFirst({ userId })` and can **ignore** `branchId` query when another membership exists — breaks multi-branch cashiers and mis-filters sales history.

7. **Refund permission mismatch:** Staff “full refund” uses [`staffOrderCancel`](../../bpa_web/lib/api.ts) → [`orders.routes.ts`](../src/api/v1/modules/orders/orders.routes.ts) `POST /:id/cancel` guarded by `order.update` / `org.write`, while POS refund UI gates on `pos.refund` — cashiers may be blocked at API despite UI.

8. **Alternate inventory path unused:** [`POST /api/v1/inventory/pos-sale`](../src/api/v1/modules/inventory/inventory.routes.ts) + [`staffRecordPosSale`](../../bpa_web/lib/api.ts) is **not** used by Staff POS; canonical stock movement is **`saleFEFOInTx`** inside `createSale` — avoid double-sale patterns.

9. **Stock check skips** when no SHOP location or no `variantId` in line — documented in [`pos.service.ts`](../src/api/v1/modules/pos/pos.service.ts) (ledger branch vs legacy `inventoryService.adjustStock`).

10. **Permissions registry gap:** [`permissionsRegistry.service.ts`](../src/api/v1/services/permissionsRegistry.service.ts) documents `pos.view` but not the full branch matrix keys (`pos.sell`, `pos.refund`, `pos.discount.override`, `cashdrawer.*`) defined in [`branchRoles.ts`](../src/api/v1/constants/branchRoles.ts) — admin UX and audits may drift.

---

## 3. Target POS Product Definition

### What the final POS must do

| Area | Must |
|------|------|
| Counter ops | Fast scan/search, merge lines, correct prices, obvious totals, minimal taps to pay |
| Parallel customers | Multiple **held** carts per register (user + branch), switch without losing state |
| Membership | Scan/enter **card**, validate **status + expiry + org/branch scope**, apply **tier/card rules** with governance |
| Pricing | Branch list price + enterprise resolution consistent with [`assertPosSalePricingGovernance`](../src/api/v1/modules/pricing/retailDiscount.service.ts) |
| Inventory | SHOP location ledger availability; **FEFO** sale; surface **lot/expiry** where policy requires block/warn |
| Checkout | Single or **split** payment methods, reconcile to `Order` |
| Documents | **Receipt** (transaction summary) + **Invoice** (`pos_invoices`) with stable numbers |
| Post-sale | Line return ([`POST /pos/return`](../src/api/v1/modules/pos/pos.routes.ts)), full cancel/refund aligned with permissions |
| Controls | Shift open/close, Z-report, optional `featuresJson.posRequireShift` |
| Compliance | Audit key cashier actions; supervisor overrides for discounts / voids |

### User roles

- **Cashier:** `pos.view`, `pos.sell`, barcode, carts, checkout, receipt print, shift open if policy (may need split: open vs sell).
- **Senior cashier / supervisor:** `pos.discount.override`, manager variance notes (already partial in shift close), future `pos.void` / `pos.supervisor` as needed.
- **Refund role:** `pos.refund` must imply allowed API paths for return/cancel (aligned with backend).
- **Branch admin / owner:** pricing governance, membership tier setup (existing owner panels), not day-to-day POS.

### Key workflows

1. Open shift (if required) → **active register session**.
2. Create or resume **cart** → attach **member** (optional) → scan/search add lines → review totals.
3. **Hold** cart → pick another cart from queue → resume.
4. **Pay** (split allowed) → persist `Order` + ledger + invoice + audit.
5. **Return** line items or supervisor-driven full cancel per policy.

---

## 4. Canonical Architecture Decision

### Why Staff POS stays

- It already implements **branch context** via [`useBranchContext`](../../bpa_web/lib/useBranchContext.ts), **permission gates** (`pos.view`, `pos.sell`, …), **shifts**, **barcode**, **line returns**, and **drawer** tab — aligned with BPA branch staff model.
- Backend [`pos.middleware.ts`](../src/api/v1/modules/pos/pos.middleware.ts) enforces **BranchMember + role permissions** per `branchId`, matching staff routing.

### What happens to Shop POS (`/shop/pos`)

| Action | Detail |
|--------|--------|
| **Product** | Non-canonical; **no new features**; no QA priority |
| **Navigation** | Remove or hide entry from [`permissionMenu.ts`](../../bpa_web/src/lib/permissionMenu.ts) (`shop.pos` → `/shop/pos`) or replace with link to staff login / training doc |
| **Route** | Keep **temporary** `redirect` or static deprecation banner (“Use Staff POS”) to avoid breaking bookmarks during rollout |
| **Code** | After Staff POS parity, **delete** or archive `app/shop/(larkon)/pos/page.tsx` in a dedicated cleanup PR |
| **API** | No separate API; same `/api/v1/pos` — no “shop” backend fork |

### Backend canonical flow decision

- **POS mutations** remain under `/api/v1/pos` for cashier operations (cart, finalize, pay, invoice preview).
- **Orders** remain system-of-record for completed sales (`Order`, `OrderItem`, `orderSource: POS`) — extend with payment rows and totals, not a parallel `PosSale` aggregate.
- **Inventory** mutations stay inside finalize transaction (`saleFEFOInTx`) — do **not** reintroduce `inventory/pos-sale` for the main path.

---

## 5. Target UX / Screen Structure

Target: **single-page workspace** with persistent layout (WowDash patterns; no full UI redesign spec — structure only).

### Recommended layout (conceptual “3-panel”)

1. **Left — Queue / carts:** list of **Held** + **Active** cart for current `branchId` + `openedByUserId` (or register id). Actions: New, Resume, Hold, Close (empty), **Switch** (one tap). Badge for member attached / unpaid total.

2. **Center — Scan / search:** barcode field (always focused shortcut), compact search results (server-side typeahead later). Line list for **active** cart: SKU, name, qty, unit price, line total, **lot badge** (read-only or expander). Merge rules: same `variantId` increments qty unless policy forbids (config).

3. **Right — Customer / member / totals / pay:** member scan, status chip (valid / expired / wrong branch), applied discounts breakdown, subtotal/discount/tax/total, **payment composer** (split), Pay, **Receipt** / **Invoice** buttons, notes.

### Cart queue

- Visual **pipeline**: `Held → Active → Paid` (paid disappears from queue; lookup via Sales History tab or global search in later phase).

### Staff route

- All new components live under `app/staff/(larkon)/branch/[branchId]/pos/` — split `page.jsx` into `_components/` as it grows (POS workspace shell, CartQueue, ScanPanel, CheckoutPanel) to keep maintainability without changing route.

---

## 6. Data Model and Session Design

### Design principles

- **Draft state = server carts** (survive refresh, support handoff policy later).
- **Committed state = existing `Order`** + ledger + `PosInvoice` + new payment table.
- **No duplicate stock movement** — one finalize transaction.

### Proposed new / extended models (Prisma)

Implement via **new migration** (follow [`docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`](./PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md)); names illustrative — adjust to naming conventions during implementation.

| Concept | Purpose |
|---------|---------|
| `PosRegisterSession` (optional) | If multiple physical registers per branch need isolation; else scope carts by `(branchId, userId)` and `posShiftId` when shift open |
| `PosCart` | Header: `id`, `branchId`, `staffUserId`, `posShiftId?`, `status` (`ACTIVE`, `HELD`, `CHECKOUT`, `ABANDONED`), `customerUserId?`, `ownerDiscountCardId?` / `cardNumberSnapshot?`, `metadataJson`, `createdAt`, `updatedAt`, `expiresAt` (TTL for abandoned) |
| `PosCartLine` | `cartId`, `productId`, `variantId`, `quantity`, `unitListPrice`, `unitSellPrice`, `retailDiscountApprovalId?`, `pricingSnapshotJson?`, `mergedKey` |
| `OrderPayment` | `orderId`, `method` (enum/string), `amount`, `reference?`, `createdAt` — **split payment**; sum must equal `Order` grand total at finalize |
| Reuse `Order` / `OrderItem` | Final lines mirror cart lines; persist `subtotalAmount`, `discountAmount`, `taxAmount`, `totalAmount` consistently |
| `PosInvoice` | **Create on finalize** with deterministic `invoiceNumber`; link `orderId` unique |
| Return path | Keep [`createPosReturn`](../src/api/v1/modules/pos/pos.service.ts) + `PosCreditNote`; extend audit |

### Cart/session persistence model

- **Server authoritative:** every meaningful cart change posts to API (debounced batching optional for qty only).
- **Concurrency:** optimistic versioning column on `PosCart` (`version` int) to detect double-edit.

### Held cart model

- `status = HELD`, still listed in queue; **no stock reservation** by default (policy: optional soft reserve later — not required for MVP enterprise if business accepts oversell risk at pay time; **recommended**: reserve on `CHECKOUT` only for high contention, phase later).

### Sale finalization model

1. `POST /pos/carts/:id/finalize` validates cart, member, prices (reuse `assertPosSalePricingGovernance` with **resolved lines**), stock (`getStockBalance` per variant).
2. Inside `prisma.$transaction`: create `Order` + `OrderItem`s + `processPayment` / status + **insert `OrderPayment` rows** + `PosInvoice` + `saleFEFOInTx` per line + `consumeRetailDiscountApprovalsForPaidOrder` + `writePriceResolutionSnapshotsForOrder` + link `posShiftId`.
3. Mark cart `PAID` / archive.

### Payment entities

- **`OrderPayment`**: 1..N rows per order.
- **`Order.paymentMethod`**: either set to `MIXED` / primary method enum extension, or keep first method for legacy readers — document decision; prefer **enum extension** in Prisma if `PaymentMethod` is closed.

### Invoice entities

- Populate [`PosInvoice`](../prisma/schema.prisma) in the same transaction as order pay.
- Receipt can remain **computed DTO** from `Order` (`getReceipt`) or separate lightweight `PosReceipt` table — reuse `getReceipt` first to limit scope; add PDF later.

### Return/refund entities

- Keep **line return** as today ([`pos/return`](../src/api/v1/modules/pos/pos.routes.ts)).
- **Full cancel:** align [`orders.controller`](../src/api/v1/modules/orders/orders.controller.ts) permission model with `pos.refund` **or** add `POST /pos/orders/:id/cancel` wrapper with POS middleware (preferred: **single POS-owned cancel** that internally calls shared service).

---

## 7. Pricing and Membership Resolution Design

### Membership card handling

- **Source of truth:** [`OwnerDiscountCard`](../prisma/schema.prisma) (`cardNumber` unique, `expiresAt`, `status`, `discountPercent`, `membershipTierId`, `orgId`, optional `branchId`).
- **New endpoint (example):** `GET /api/v1/pos/membership/card?branchId=&code=` under [`pos.routes.ts`](../src/api/v1/modules/pos/pos.routes.ts) with `requirePosPermission("pos.view")` or `pos.sell`:
  - Resolve by `cardNumber` (scan).
  - Validate: `orgId` matches branch’s org; `status === ACTIVE`; `expiresAt` null or future; `branchId` on card matches or is null (org-wide).
  - Return: `{ userId, displayName, tierId, tierName, discountPercent, governanceHints }` — **no secrets**.

### Validity check

- Explicit errors: `CARD_NOT_FOUND`, `CARD_EXPIRED`, `CARD_INACTIVE`, `CARD_WRONG_ORG`, `CARD_WRONG_BRANCH`.

### Discount application

- **Cart phase:** store `ownerDiscountCardId` on `PosCart`; compute **proposed** line prices client + server preview (`POST /pos/carts/:id/preview`).
- **Governance:** extend `assertPosSalePricingGovernance` inputs to understand **membership discount** vs **manual discount** vs **tier stacking** using existing org policy fields (e.g. `allowMembershipStacking` in [`pricingGovernance.controller.ts`](../src/api/v1/modules/pricing/pricingGovernance.controller.ts) / schema).
- Reuse [`validateRetailDiscountLine`](../src/api/v1/modules/pricing/retailDiscount.service.ts) patterns where membership reduces below floor — may require **new validator** `assertMembershipDiscount` in `retailDiscount.service.ts` or `enterpriseResolution.service.ts`.

### Price breakdown

- Response DTO for UI: `listPrice`, `membershipSaving`, `manualDiscount`, `tax`, `total`, `approvalRequired` flags per line.
- Persist **snapshots:** already have [`priceResolutionSnapshot.service.ts`](../src/api/v1/modules/pricing/priceResolutionSnapshot.service.ts) hook in `createSale` — extend to cart preview + finalize from cart path.

### Branch price and enterprise price interaction

- **Browse/scan list price:** same as today — [`pos.controller.ts`](../src/api/v1/modules/pos/pos.controller.ts) `getProducts` / [`pos.service.ts`](../src/api/v1/modules/pos/pos.service.ts) `getProductByBarcode` using `locationPrice` + [`resolvePosBranchVariantListPrice`](../src/api/v1/modules/pricing/posListPriceResolution.service.ts).
- **Final sale:** unchanged principle — governance uses `resolveSellingPriceWithEnterprise` inside [`assertPosSalePricingGovernance`](../src/api/v1/modules/pricing/retailDiscount.service.ts).

---

## 8. Inventory and Barcode Selling Design

### Barcode flow

- Keep **`GET /pos/products/barcode/:barcode`**; enhance response with **lot summary** (optional): call pattern similar to [`getFefoLots`](../src/api/v1/modules/inventory/inventory.controller.ts) / `ledgerService.getAvailableLotsFEFO` behind `pos.view` (watch payload size).
- **Keyboard:** global listener on workspace for scan wedge (Enter) delegating to same handler as button.

### Item search

- **Phase 0–1:** add query param to `GET /pos/products?branchId=&q=` with indexed search (`name`, `sku`, `barcode`) — replace `take: 100` blind slice in [`pos.controller.ts`](../src/api/v1/modules/pos/pos.controller.ts).
- Frontend typeahead debounced against new param.

### Stock validation

- On **finalize** (and optionally on **each add-to-cart**): use `ledgerService.getStockBalance(shopLocationId, variantId)` as in [`pos.service.ts`](../src/api/v1/modules/pos/pos.service.ts) today.
- **Policy:** block negative at pay; optional soft warning at add.

### Batch/lot/expiry considerations

- Selling already uses **`saleFEFOInTx`** — lot selection is implicit FEFO.
- **UX:** if `LOT_EXPIRED` or similar from ledger ([`recordPosSale` errors](../src/api/v1/modules/inventory/inventory.controller.ts)), map to cashier-friendly message; consider **pre-check** on preview endpoint.

### Line merge rules

- Default: **merge** lines same `variantId` and same `unitSellPrice` + same approval ids.
- Config flag (org or branch `featuresJson`): allow split lines for promotions — optional later.

---

## 9. Payment, Receipt, Invoice, and Return Design

### Checkout flow

1. Cart → **Preview** (totals, governance, stock) — server authoritative JSON.
2. User composes **payments** → **Finalize** — single transaction id returned.

### Split payment

- **Model:** `OrderPayment` N rows; validate sum === grand total; store each method (CASH, CARD, …).
- **Shift / Z-report:** extend [`getZReport`](../src/api/v1/modules/pos/pos.service.ts) to aggregate by method from `OrderPayment` (not only `order.paymentMethod`).

### Receipt

- Keep [`getReceipt`](../src/api/v1/modules/pos/pos.service.ts); extend payload with **payments array**, **membership mask**, **line discounts**.

### Invoice

- **Implement writer:** `prisma.posInvoice.create` in finalize transaction with unique `invoiceNumber` generator (branch-scoped sequence table or safe alphanumeric pattern + DB unique constraint retry).

### Refund / return / cancel

- **Line return:** keep [`POST /pos/return`](../src/api/v1/modules/pos/pos.routes.ts); ensure shift policy matches sale.
- **Full cancel:** new POS-scoped cancel endpoint **or** align `orders` route permissions with `pos.refund` + branch guard using **requested `branchId`** (fix `findFirst` bug first — see Phase 0).

---

## 10. Permissions, Shift, and Audit Design

### Cashier permissions

- Continue [`requirePosPermission`](../src/api/v1/modules/pos/pos.middleware.ts) for all new POS routes.
- **Registry:** add missing keys to [`permissionsRegistry.service.ts`](../src/api/v1/services/permissionsRegistry.service.ts) (`pos.sell`, `pos.refund`, `pos.discount.override`, `cashdrawer.open`, `cashdrawer.close`) for admin assignment UX.

### Supervisor overrides

- Manual discount above threshold: already supports `retailDiscountApprovalId` on lines in [`pos.controller.ts`](../src/api/v1/modules/pos/pos.controller.ts) — wire **Staff POS UI** to request/attach approvals (reuse retail discount approval APIs used elsewhere, e.g. owner/staff pricing flows).
- **Void / cancel:** require supervisor permission key (new) if beyond cashier window.

### Shift requirements

- Reuse [`getBranchPosRequireShift`](../src/api/v1/modules/pos/pos.service.ts) and branch `featuresJson.posRequireShift`.
- **Extend:** cart finalize must fail if shift required but closed mid-sale (detect `posShiftId` mismatch).

### Audit events

- Extend [`POS_AUDIT_ACTIONS`](../src/api/v1/modules/pos/pos.audit.ts): `POS_CART_CREATED`, `POS_CART_HELD`, `POS_CART_RESUMED`, `POS_CART_FINALIZED`, `POS_PAYMENT_CAPTURED`, `POS_MEMBERSHIP_ATTACHED`, `POS_MEMBERSHIP_DENIED`, `POS_INVOICE_ISSUED` (distinct from generated), `POS_REFUND_FULL`.
- Pass `cartId` / `orderId` consistently; never log full card number — log **last4** or hash.

---

## 11. Phased Implementation Plan

### Phase 0: Stabilization

| Item | Detail |
|------|--------|
| **Objective** | Remove footguns that would multiply with multi-cart; make current single-cart flow trustworthy. |
| **Backend** | Fix [`orders.controller.ts`](../src/api/v1/modules/orders/orders.controller.ts) `getOrders`/`getOrder` to **require** `branchId` query/body and verify `BranchMember` for that pair; remove ambiguous `findFirst` without branch filter. Add `PosInvoice` creation to [`createSale`](../src/api/v1/modules/pos/pos.service.ts) **or** stop returning invoice promise in UI until created — prefer **implement create**. Wire `discountPercent`/`taxPercent` from controller into `Order` + line recalculation or reject params until implemented (strict validation). |
| **Frontend** | Staff POS: ensure all order list calls pass `branchId` (already in [`staffOrdersList`](../../bpa_web/lib/api.ts)); retest multi-branch users. |
| **Schema** | Prefer **no** breaking schema changes in Phase 0; invoice uses existing `PosInvoice`. If `OrderPayment` deferred, document single-payment only. |
| **API** | Optional: `POST /pos/orders/:id/cancel` shim with POS middleware. |
| **Risks** | Changing orders scope affects non-POS consumers of `/orders` — regression-test owner panels. |
| **Acceptance** | Multi-branch staff sees **only** current branch orders; invoice print returns 200 with body; discount/tax either applied or API returns 400 “not supported”. |

### Phase 1: Workspace redesign

| Item | Detail |
|------|--------|
| **Objective** | Prepare UI for queue + scan-first without yet persisting multi-cart server-side (optional localStorage backup only). |
| **Backend** | Light: add `q` to `GET /pos/products` as in §8. |
| **Frontend** | Refactor [`pos/page.jsx`](../../bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx) into components; implement **3-panel** shell; barcode focus management; merge lines client-side. |
| **Schema** | None. |
| **Risks** | Large JSX refactor — do in dedicated PR with no logic change first. |
| **Acceptance** | Same sale success rate in QA; barcode + search faster perceived; no feature regression. |

### Phase 2: Multi-cart engine

| Item | Detail |
|------|--------|
| **Objective** | Server-persisted carts + hold/resume/switch. |
| **Backend** | New routes: `POST /pos/carts`, `GET /pos/carts`, `PATCH /pos/carts/:id`, `POST /pos/carts/:id/hold`, `POST /pos/carts/:id/resume`, `DELETE /pos/carts/:id` (soft), all with [`pos.middleware.ts`](../src/api/v1/modules/pos/pos.middleware.ts). New service `posCart.service.ts` colocated under `modules/pos/`. |
| **Frontend** | Queue panel wired to APIs; active cart id in URL query `?cartId=` optional for deep link. |
| **Schema** | `PosCart`, `PosCartLine` + indexes `(branchId, staffUserId, status)`. |
| **Risks** | Orphan carts — TTL job or nightly cleanup; concurrency with `version`. |
| **Acceptance** | Refresh mid-sale restores held cart; two carts alternate without cross-contamination. |

### Phase 3: Membership + pricing

| Item | Detail |
|------|--------|
| **Objective** | Card attach + validation + priced preview with governance. |
| **Backend** | Card resolve endpoint (§7); `POST /pos/carts/:id/preview` calling shared pricing validators; extend governance service for membership stacking rules. |
| **Frontend** | Member panel: scan, clear, show validity; show price breakdown. |
| **Schema** | Possibly `PosCart.ownerDiscountCardId` FK; snapshot fields. |
| **Risks** | Stacking vs retail rules — coordinate with [`pricingGovernance`](../src/api/v1/modules/pricing/pricingGovernance.service.ts). |
| **Acceptance** | Expired card blocked at preview; valid card changes totals predictably; audit logs membership attach/deny. |

### Phase 4: Payment + invoice

| Item | Detail |
|------|--------|
| **Objective** | Split pay + invoice/receipt parity. |
| **Backend** | `OrderPayment` model; finalize endpoint; Z-report aggregation update; invoice create in transaction. |
| **Frontend** | Payment composer; validate sum; print flows. |
| **Schema** | `OrderPayment` + enum/`PaymentMethod` adjustment if needed. |
| **Risks** | Financial reconciliation — double-entry review with accounting. |
| **Acceptance** | Order with 2 payment methods reconciles; Z-report matches; invoice number unique. |

### Phase 5: Returns + audit + hardening

| Item | Detail |
|------|--------|
| **Objective** | Production hardening: permissions, audits, perf, security. |
| **Backend** | POS cancel route or permission alignment; expand audits; rate limits on search; optional `PosRegisterSession`. |
| **Frontend** | Supervisor flows, error banners, offline messaging (read-only if API down). |
| **Schema** | As needed for register session. |
| **Risks** | Permission migration for existing roles — communicate in release notes. |
| **Acceptance** | Security review checklist; load test `GET /pos/products?q=`; full refund path works for `pos.refund` role only. |

---

## 12. Migration and Rollout Strategy

### Move safely without breaking current cashiers

1. **Phase 0 behind no flag** — bugfixes + invoice creation are backward compatible.
2. **Phase 1–2:** ship server carts with **feature flag** `branch.featuresJson.posMultiCart === true` (default false): when false, UI uses single implicit cart id from server auto-created per session, mirroring today’s mental model.
3. **Training:** Staff route unchanged; optional `?cartId=` for support.
4. **Shop POS:** banner in Phase 0; menu hidden Phase 1; redirect Phase 2; remove code Phase 4+.

### Temporary compatibility

- Keep `POST /pos/sale` working during Phase 2–3 by implementing **internal delegation**: single-cart sale = “get or create active cart + add lines + finalize” so integrations/tests using old API still pass.
- Deprecate in docs; remove after Staff POS finalize adoption.

### Deprecation plan for Shop POS

| Milestone | Action |
|-----------|--------|
| M1 (Phase 0 done) | Banner + internal doc |
| M2 (Phase 1) | Remove from [`permissionMenu.ts`](../../bpa_web/src/lib/permissionMenu.ts) |
| M3 (Phase 2+) | HTTP redirect to `/staff` or 410 with message |
| M4 | Delete page + dead `apiFetch` usage |

---

## 13. Final Recommendation

### What to build first

1. **Phase 0** — branch-scoped orders, invoice persistence, discount/tax truth, refund permission alignment. **Highest ROI / lowest rework.**
2. **Phase 1** — search param + workspace shell (enables barcode-first UX without schema).
3. **Phase 2** — server carts (unblocks true multi-customer).

### What not to build too early

- **Soft stock reservations** per held cart — adds complexity before concurrency data exists.
- **Offline-first POS** — not required for first enterprise milestone.
- **PDF engine** — HTML print + `PosInvoice` data sufficient initially.

### Minimum usable production milestone

**“Phase 0 complete + Phase 1 search + single active server cart (flag off = one cart)”**: accurate branch sales list, working invoice, correct permissions on refund, improved scan/search, and **no reliance on Shop POS** — ready for pilot rollout before split payments and multi-cart GA.

---

*Document version: 1.0 — planning only; implementation follows BPA migration and non-destructive Prisma policies.*
