# POS enterprise implementation report

**Date:** 2026-04-20
**Scope:** Reuse-first POS hardening on `backend-api` + `bpa_web`. Canonical POS remains **Staff branch** route: `/staff/branch/[branchId]/pos`. Legacy **`/shop/pos`** is not extended; it shows a deprecation banner and menu label clarifies “legacy”.

---

## What was implemented

### Branch-scoped orders (Phase A1)

- Explicit branch resolution for staff order list/detail via `ordersBranchAccess.service.ts` (no ambiguous `branchMember.findFirst({ userId })` overriding the requested branch).
- Order cancel paths aligned with POS refund permission where applicable.

### POS invoices, discount/tax, payments (Phases A2–A3, E)

- **PosInvoice** creation on successful POS finalization (inside the same transactional flow as `createSale` / FEFO), with deterministic invoice numbering (see `pos.service.ts`).
- **Discount / tax:** `discountPercent` and `taxPercent` flow into order totals (`subtotalAmount`, `discountAmount`, `taxAmount`, `totalAmount`) via shared helpers; dead API fields are not silently ignored on finalize paths in use.
- **Split tender:** `OrderPayment` rows + `PaymentMethod.MIXED` on the order header when multiple payments are used; Z-report aggregates by method with legacy fallback to `Order.paymentMethod`.
- **`POST /api/v1/pos/sale`:** Retained for compatibility; delegates to the same `createSale` stack as cart finalize (no second stock path). Primary cashier flow on Staff UI uses **cart finalize** (`POST /api/v1/pos/carts/:id/finalize`).

### POS-scoped cancel/refund (Phase A4)

- **`POST /api/v1/pos/orders/:orderId/cancel`** — POS middleware + `pos.refund` (and branch isolation) so staff do not need unrelated owner cancel permissions.

### Shop POS deprecation (Phase A5)

- **`bpa_web/app/shop/(larkon)/pos/page.tsx`:** Warning banner + link to `/staff`; code comment states no new features on this route.
- **`bpa_web/src/lib/permissionMenu.ts`:** Menu label `POS (legacy)` with comment pointing to Staff POS as canonical.

### Server-side multi-cart (Phase C)

**Prisma / DB**

- Migration: `prisma/migrations/20260420190000_pos_enterprise_cart_order_payment/migration.sql`
  - Tables: `pos_carts`, `pos_cart_lines`, `order_payments`
  - Enum values: `PosCartStatus`, `OrderPaymentStatus`, `PaymentMethod.MIXED` (Postgres `ADD VALUE IF NOT EXISTS` where applicable)

**Models (schema.prisma)**

- `PosCart`, `PosCartLine`, `OrderPayment`; relations on `Order`, `Branch`, `User`, `PosShift`, `OwnerDiscountCard`, `Product`, `ProductVariant`.

**API (`src/api/v1/modules/pos/`)**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/pos/carts?branchId=` | List open carts for current staff + branch |
| POST | `/api/v1/pos/carts` | Create cart |
| GET | `/api/v1/pos/carts/:cartId?branchId=` | Get cart + lines (lines include product/variant labels) |
| PATCH | `/api/v1/pos/carts/:cartId` | Update cart (membership snapshots, version) |
| POST | `/api/v1/pos/carts/:cartId/lines` | Add / merge line |
| PATCH | `/api/v1/pos/carts/:cartId/lines/:lineId` | Quantity |
| DELETE | `/api/v1/pos/carts/:cartId/lines/:lineId` | Remove line |
| POST | `/api/v1/pos/carts/:cartId/hold` | Hold |
| POST | `/api/v1/pos/carts/:cartId/resume` | Resume |
| POST | `/api/v1/pos/carts/:cartId/preview` | Totals preview |
| POST | `/api/v1/pos/carts/:cartId/finalize` | Authoritative finalize → `createSale` |
| DELETE | `/api/v1/pos/carts/:cartId` | Abandon |
| GET | `/api/v1/pos/membership/card?branchId=&code=` | Cashier-safe membership validation |
| POST | `/api/v1/pos/orders/:orderId/cancel` | POS refund/cancel |

**Cart service (`posCart.service.ts`)**

- Merge-on-add by variant + sell price + approval id.
- Optimistic version on `PATCH` cart.
- **Cart cleanup:** `expiresAt` exists on model; no scheduler in-repo — run periodic abandon job or cron as a follow-up (documented here).

### Membership-aware pricing (Phase D)

- Lookup endpoint validates org, branch scope, active status, expiry.
- Staff POS attaches card via `PATCH` cart with **snapshots** (`memberNameSnapshot`, `cardNumberSnapshot`, `discountPercentSnapshot`) for audit/history.
- Finalize combines **membership snapshot % + manual discount %** (capped at 100%) before calling `createSale`.

### Staff POS UI (Phases B, C–E wiring)

- **`bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx`**
  - Debounced **`q`** on `GET /api/v1/pos/products`.
  - **Cart queue:** new / hold / clear, switch carts, resume HELD.
  - **Server cart lines** as source of truth; qty commit on blur; remove line via API.
  - **Membership** apply/clear block.
  - **Checkout** uses **`staffPosCartFinalize`** with single or split **`payments`** array.
  - Full cancel/refund tab uses **`staffPosCancelOrder`** (`/pos/orders/:id/cancel`).
- **`bpa_web/lib/api.ts`** — wrappers for carts, membership, cancel, products `q`, etc.

### Audit + permissions (Phases F2–F3)

- Extended **`pos.audit.ts`** actions (cart lifecycle, membership denied, invoice issued, refund full, etc.) — masked card in logs only.
- **`permissionsRegistry.service.ts`** — POS / cash drawer keys aligned with branch matrix (`pos.sell`, `pos.refund`, `pos.discount.override`, `cashdrawer.open` / `close`).

---

## Compatibility decisions (code / ops)

1. **`POST /pos/sale`** — Kept for legacy clients; same `createSale` + FEFO + invoice path as cart finalize where applicable. Prefer **`/pos/carts/:id/finalize`** for new UI.
2. **`/shop/pos`** — Deprecated surface only; banner + menu label; no new product or payment UX.
3. **Payments** — `Order.paymentMethod` may be `MIXED` when splits exist; readers should prefer **`order_payments`** when present (receipt/Z-report already biased that way in POS services).
4. **Invoices** — Older POS orders may lack `PosInvoice`; read paths should tolerate missing invoice (Staff UI already handles “invoice not available”).
5. **Cart expiry / abandoned carts** — Structure in DB; operational cleanup TBD.

---

## Migrations

- Apply with your normal process: **`prisma migrate deploy`** (never `migrate reset` / `db push` on production-like DB per project policy).
- Run **`node scripts/check-migration-integrity.js`** before/after deploy.
- PostgreSQL: confirm version supports `ADD VALUE IF NOT EXISTS` for enum migration (or adjust if on older PG).

---

## Follow-up (optional)

- Split **Staff POS page** into `_components/*` (PosWorkspaceShell, panels) for maintainability — behavior is correct in a single file for now.
- **Scheduled job** to expire `ABANDONED` / stale `HELD` carts using `expiresAt`.
- **Receipt / invoice print** — surface split payments in print template if not already mirrored from `orderPayments`.
- **POS_MEMBERSHIP_ATTACHED** audit on successful PATCH (currently GET path audits denial).

---

## Files touched (this continuation + prior POS enterprise work)

| Area | Files |
|------|--------|
| Prisma | `prisma/schema.prisma`, `prisma/migrations/20260420190000_pos_enterprise_cart_order_payment/migration.sql` |
| POS | `pos.service.ts`, `pos.controller.ts`, `pos.routes.ts`, `posCart.service.ts`, `pos.audit.ts` |
| Orders | `orders.controller.ts`, `orders.service.ts`, `orders.routes.ts`, `ordersBranchAccess.service.ts`, `ordersCancelInventory.service.ts` (as introduced in this effort) |
| Permissions | `permissionsRegistry.service.ts` |
| Web | `app/staff/(larkon)/branch/[branchId]/pos/page.jsx`, `lib/api.ts`, `app/shop/(larkon)/pos/page.tsx`, `src/lib/permissionMenu.ts` |

---

## Verification suggestions

1. Staff user with **`pos.sell`**: create two carts, hold one, resume, finalize with cash and with split payments; confirm **order_payments** rows and **PosInvoice** `GET /pos/invoice/:orderId`.
2. User with **`pos.refund`**: cancel a completed POS order via **`POST /pos/orders/:id/cancel`** (not owner-only cancel).
3. **Branch isolation:** orders list with `branchId` query only shows current branch for staff.
4. **Membership:** attach card, preview totals, finalize; then clear membership on a new cart.
