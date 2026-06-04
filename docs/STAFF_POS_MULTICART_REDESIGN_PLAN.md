# Staff POS Multi-Cart Redesign Plan

## Summary
- Canonical staff POS UI lives in `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx`; it is currently a single large client component with page tabs for `sale / history / refunds / drawer`, a visible `BranchHeader`, a cart queue card, product list, cart table, and a checkout card.
- Canonical POS backend already exists in `backend-api/src/api/v1/modules/pos/` with server-side carts (`PosCart`, `PosCartLine`), finalize/reuse of `createSale`, receipt/invoice/refund/shift endpoints, pricing governance reuse, and branch-isolated permission checks.
- The redesign should stay low-risk by keeping the existing route, preserving the existing history/refunds/cash-drawer sections, and rebuilding only the `sale` workspace into a fixed two-column multi-cart POS driven by the existing cart APIs.

## Current State
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx`
  - Monolithic page; `sale` tab currently shows a `Cart queue` card, `Products` card, `Cart` card, and `Checkout` card.
  - Customer support is only a raw `customerId` input; there is no phone lookup, no inline customer creation, and no pet summary.
  - Membership support is exact card-number apply only via `staffPosMembershipLookup`; no lookup by member identity.
  - Product browse/search already supports name/SKU/barcode server-side, and barcode enter already does quick-add.
- `bpa_web/lib/api.ts`
  - Already exposes `staffPosProducts`, `staffPosBarcodeLookup`, `staffPosCart*`, `staffPosCartFinalize`, `staffPosMembershipLookup`, `staffPosReturn`, `staffPosGetCurrentShift`, `staffPosOpenShift`, `staffPosCloseShift`, and sales-history helpers.
  - Clinic owner lookup/create helpers already exist as `staffClinicOwnerLookup`, `staffClinicEnsureOwner`, and `staffClinicPatientsList`.
- `backend-api/src/api/v1/modules/pos/pos.routes.ts`, `pos.controller.ts`, `pos.service.ts`, `posCart.service.ts`
  - Reusable server cart/session model already exists.
  - Pricing reuse already exists through `assertPosSalePricingGovernance`, `posListPriceResolution.service.ts`, `orders.service.ts`, and FEFO inventory deduction.
  - Permission and branch isolation are already enforced in `pos.middleware.ts`.
- `backend-api/src/api/v1/modules/clinic/patient.service.ts` and `clinic.controller.ts`
  - Phone/email owner lookup and inline owner creation already exist, but under clinic endpoints and clinic permissions, not POS-safe cashier endpoints.

## Target UX Structure
- Remove the large branch header block from the POS route and keep a compact POS page header.
- Keep outer page tabs as `New Sale`, `Sales History`, `Refunds`, and `Cash Drawer`.
- Replace the visible cart queue with browser-like cart tabs and a compact held-carts menu.
- Keep all cart rows on the left side.
- Keep customer, membership/card, and checkout context on the right side only.
- Add keyboard-first scan and search flow with scanner autofocus support.

## File-By-File Change Plan
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx`
  - Reduce to a route-level coordinator.
  - Keep outer page tabs for `New Sale / Sales History / Refunds / Cash Drawer`.
  - Remove `BranchHeader` from the sale working area and replace with a minimal POS header row.
  - Mount a modular sale workspace instead of inline queue/cart/checkout markup.
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosSaleWorkspace.jsx`
  - New fixed two-column layout wrapper for the sale tab.
  - Left column owns scanner/search, product results, active cart rows, and footer summary/actions.
  - Right column owns customer, membership/card, and checkout/payment sections.
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosCartTabs.jsx`
  - New browser-tab-like cart strip.
  - Render open carts as tabs, visually highlight the active cart, add `+` tab for create, and `x` for close.
  - Replace the large queue card with tabs plus a compact held-carts menu.
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosCartLinesTable.jsx`
  - New cart row UI: product info, batch/expiry preview if available, qty controls, unit price, discount display, line total, remove.
  - Keep data source as server cart lines plus optional preview fields.
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosProductPanel.jsx`
  - Merge barcode input and product search into one cashier-first top section.
  - Add scan-mode toggle and autofocus behavior.
  - Keep existing `staffPosProducts` and `staffPosBarcodeLookup` flows.
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosCustomerPanel.jsx`
  - New phone lookup and inline create panel.
  - On phone search, auto-fill matched customer details.
  - If clinic-enabled and patient data is available, show linked pet summary; otherwise omit pet subsection cleanly.
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosMembershipPanel.jsx`
  - New membership/card lookup section.
  - Support lookup by card number and by resolved customer identity.
  - Show applied card/tier details and a staff-safe handoff note when new-card creation is not supported in POS.
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosCheckoutPanel.jsx`
  - Keep payment methods, split payments, totals, and complete-sale submit on the right side.
  - Keep cart note handling separate on the left summary/footer while persisting note at cart level.
- `bpa_web/lib/api.ts`
  - Add POS-safe customer lookup/create client helpers.
  - Add POS membership lookup by card or customer identity.
- `backend-api/src/api/v1/modules/pos/pos.routes.ts`
  - Add cashier-safe customer lookup/create endpoints under `/api/v1/pos/...`.
  - Add membership lookup endpoint that can resolve by card number or customer identity.
  - Keep all existing sale/finalize/refund/shift routes unchanged.
- `backend-api/src/api/v1/modules/pos/pos.controller.ts`
  - Parse new customer and membership lookup inputs.
  - Continue delegating finalize/refund/receipt/invoice/shift behavior to current services.
- `backend-api/src/api/v1/modules/pos/pos.service.ts`
  - Add POS-safe wrappers around owner lookup/create and membership identity lookup.
  - Reuse existing pricing, sale finalize, invoice, receipt, refund, and branch validation logic.
  - Add optional FEFO lot preview helper for batch/expiry display without changing finalize behavior.
- `backend-api/src/api/v1/modules/pos/posCart.service.ts`
  - Standardize note persistence and lightweight tab metadata for UI display.
  - Use `metadataJson` for cart note persistence to avoid a schema change.

## API / Data Dependencies
- Reuse without contract changes:
  - `/api/v1/pos/products`
  - `/api/v1/pos/products/barcode/:barcode`
  - `/api/v1/pos/carts`, `/api/v1/pos/carts/:id`, `/lines`, `/hold`, `/resume`, `/finalize`
  - `/api/v1/pos/receipt/:orderId`, `/invoice/:orderId`, `/orders/:orderId/cancel`, `/return`
  - `/api/v1/pos/shift/current`, `/shift/open`, `/shift/close/:id`, `/shift/:id/z-report`
  - Pricing resolution in `posListPriceResolution.service.ts` and governance enforcement in `retailDiscount.service.ts`
- New POS-safe lookup coverage:
  - `/api/v1/pos/customers/lookup`
  - `/api/v1/pos/customers/ensure`
  - `/api/v1/pos/membership/resolve`
- Display-only enrichment:
  - Cart note preview in `metadataJson.note`
  - Live FEFO lot preview in cart line responses

## Risk List
- Replacing the monolithic sale UI can accidentally regress history, refunds, or drawer if state is not isolated.
- Reusing clinic owner logic without a POS-safe wrapper can create permission failures for cashier roles.
- Membership-by-identity can be ambiguous if one customer has multiple cards; the UI must make the selected card explicit.
- Batch and expiry preview can drift before final checkout because FEFO stock is live; UI must label it as preview only.
- Keyboard autofocus and scan mode can conflict with manual entry if focus rules are too aggressive.
- Address editing currently has no dedicated POS-safe persistence API, so address stays cart-scoped until a future customer profile endpoint is exposed safely.

## Phased Implementation Steps
1. Frontend modularization
- Extract the sale workspace from `page.jsx` into new `_components`.
- Leave history, refunds, and drawer behavior unchanged.
- Remove the large branch info block from the POS route header.

2. Multi-cart tab UX
- Replace the current cart queue card with cart tabs plus `+`.
- Keep one cart open by default.
- Empty tab close abandons the cart immediately.
- Non-empty tab close opens a confirm dialog with `Hold and close` as the recommended action and `Discard` as the destructive fallback.
- Held carts move to a compact held-carts menu.

3. Customer and membership right rail
- Add phone-based customer search with auto-fill.
- Add inline customer creation when not found.
- If clinic-enabled and patient records exist, show a lightweight linked-pets subsection.
- Add membership lookup by card number or resolved customer identity and allow apply/clear from the same panel.

4. Cart-row and checkout redesign
- Move all cart rows to the left column.
- Add qty steppers, keyboard qty edits, price, line discount display, line total, and remove action.
- Add cart note, hold, and clear actions near the cart summary/footer.
- Keep payment and finalize on the right side.

5. Regression hardening
- Verify sales history, refunds, invoices, receipts, and cash drawer flows still work.
- Verify no backend pricing/refund/history contracts changed.
- Verify branch isolation and permission checks still gate every new endpoint and UI control.

## Acceptance Checklist
- POS opens with one cart tab by default and no visible cart queue card.
- `+` creates a new tab and active-tab styling is clear.
- Cart item rows appear only on the left side.
- Right side contains customer, membership/card, and checkout only.
- Phone search resolves an existing customer and auto-fills details.
- Missing customer can be created inline from POS.
- Membership can be applied by card number or resolved customer identity.
- Hold, clear, note, subtotal, discount, tax, and payable are available in the sale workspace.
- Sales history, refunds, receipt/invoice, and cash drawer continue to work.
- No unnecessary package install and no backend contract breakage.

## Implementation Notes
- `PosCart.metadataJson.note` is the note persistence mechanism in v1.
- Customer draft fields are stored under `metadataJson.customerDraft` to keep the POS flow resilient across tab switches.
- FEFO lot and expiry display is preview-only; final allocation remains authoritative at checkout.
- No Prisma schema change is required for this redesign pass.
