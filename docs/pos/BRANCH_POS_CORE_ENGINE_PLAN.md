# Branch POS Core Engine — Plan (Source of Truth)

**Scope:** Product-only POS core at `/staff/branch/:branchId/pos`. Services POS is out of scope.

**Baseline:** BPA/WPA repos; API port 3000, Next.js staff 3104; BPA_STANDARD.md and PROJECT_CONTEXT.md apply.

---

## 1. Scope

- **In scope:** Product POS: product search, barcode lookup, cart, checkout (tax/discount), payment, invoice, receipt, line-item returns, credit notes, branch isolation, audit, stock ledger (FEFO).
- **Out of scope:** Service POS; cash drawer backend; partial payment; barcode hardware (UI input only).

---

## 2. Roles / Permissions Matrix

| Permission             | Staff (SELLER) | Manager (BRANCH_MANAGER) |
|------------------------|----------------|---------------------------|
| pos.view               | Yes            | Yes                       |
| pos.sell               | Yes            | Yes                       |
| pos.refund             | No             | Yes                       |
| pos.discount.override  | No             | Yes                       |
| cashdrawer.open/close  | No             | Yes (UI only)             |

**Branch isolation:** Every POS request is validated for `BranchMember` (userId + branchId, status ACTIVE) and role-derived permissions. Receipt/invoice by `orderId` resolve branch from order and then enforce same branch membership.

---

## 3. Business Rules

- **Inventory:** Deduct from branch SHOP `InventoryLocation` via `StockBalance` / `StockLedger` (FEFO). No sale without sufficient available stock (onHand - reserved).
- **Batch/lot:** FEFO respects lot expiry; expired lots are skipped. Variants with `requiresLot` must have valid (non-expired) lots.
- **Pricing:** Unit price from cart; subtotal = sum(line total); discount % applied; tax % on (subtotal - discount). Grand total = subtotal - discount + tax.
- **Payment:** Single payment method per sale; payment status COMPLETED at checkout.
- **Invoice:** One `PosInvoice` per completed sale; invoice number `INV-{branchId}-{YYMMDD}-{seq}`.
- **Returns:** Line-item return creates `ReturnRequest` (APPROVED → RECEIVED), `RETURN_IN` ledger entries, and `PosCreditNote` (credit number `CN-{branchId}-{YYMMDD}-{seq}`). Full order refund remains via order cancel (existing).

---

## 4. Data Model (Prisma)

- **Order:** Added `subtotalAmount`, `discountPercent`, `discountAmount`, `taxPercent`, `taxAmount`, `invoiceNumber` (unique).
- **PosInvoice:** orderId (unique), invoiceNumber (unique), branchId, subtotal, discountPct/Amt, taxPct/Amt, grandTotal, paymentMethod, paidAt.
- **PosCreditNote:** returnRequestId (unique), orderId, branchId, creditNumber (unique), amount.
- **AuditEntityType:** Added POS_SALE, POS_REFUND, POS_INVOICE.

Migrations:

- `20260302120000_add_pos_invoice_and_order_financial_fields`
- `20260302130000_add_pos_credit_note`

---

## 5. API Design

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET    | `/pos/products?branchId=` | pos.view | Products with variants, stock, location price (SHOP) |
| GET    | `/pos/products/barcode/:barcode?branchId=` | pos.view | Lookup by barcode; product, variant, stock, price |
| POST   | `/pos/sale` | pos.sell | Create sale (transactional: order + payment + ledger + invoice) |
| GET    | `/pos/receipt/:orderId` | pos.view | Receipt payload (branch from order) |
| GET    | `/pos/invoice/:orderId` | pos.view | Invoice payload for print (branch from order) |
| POST   | `/pos/return` | pos.refund | Line-item return (ReturnRequest + RETURN_IN + PosCreditNote) |

**Request/response:** Envelope `{ success, data?, message?, code? }`. Error codes: INSUFFICIENT_STOCK, BRANCH_ACCESS_DENIED, INVALID_CART, VALIDATION_ERROR, NOT_FOUND, REFUND_NOT_ALLOWED.

---

## 6. Audit Events

| Action                 | Entity Type | When                    |
|------------------------|-------------|-------------------------|
| POS_SALE_FINALIZED     | POS_SALE    | After successful sale   |
| POS_INVOICE_GENERATED  | POS_INVOICE | After invoice created   |
| POS_RECEIPT_VIEWED     | POS_SALE    | Receipt fetched         |
| POS_REFUND_COMPLETED   | POS_REFUND  | Line-item return done   |

---

## 7. UI Flows

- **New Sale:** Barcode input (Enter) → lookup → add to cart with price; product search → add to cart (auto price from API); cart (qty/price edit); checkout (discount, tax, payment, notes); complete sale → success + Print invoice / View receipt.
- **Sales History:** List orders; view detail; open Refunds for that order.
- **Refunds:** Partial return: select order → line-item table (return qty, reason) → submit → credit note shown. Full refund: select order → reason → cancel order (existing).

---

## 8. Edge Cases & Concurrency

- **Concurrent sales:** Single `prisma.$transaction` for sale (stock check, order, ledger, invoice); one of two concurrent last-unit sales fails with INSUFFICIENT_STOCK.
- **Expired lots:** FEFO skips expired lots; if not enough non-expired stock, sale fails.
- **Return qty:** Cannot exceed order line quantity; validated in transaction.

---

## 9. QA Checklist

**Seed:** Branch with SHOP location; products/variants with barcodes and LocationPrice; StockBalance/StockLot data; BRANCH_MANAGER and SELLER members.

**Manual:** (1) Sale with auto-price and discount; (2) barcode add to cart; (3) print invoice; (4) sale with qty > stock → error; (5) line-item return → credit note and restock; (6) seller cannot refund (403); (7) no branch access → 403.

---

## 10. Implementation Phases (Done)

- **P0:** Safety — pos.middleware (requirePosPermission, requirePosPermissionForOrder), pos.audit, pos.responses, hardened routes and controller.
- **P1:** Core sale — schema (Order + PosInvoice), barcode endpoint, getProducts with LocationPrice/StockBalance, transactional createSale (order + FEFO + invoice), getInvoice, frontend barcode + auto-price + invoice print.
- **P2:** Returns — PosCreditNote schema, POST /pos/return (transactional return + restock + credit note), Refunds tab line-item UI + staffPosReturn.

---

## Files Touched (Summary)

**Backend:**  
`pos.routes.ts`, `pos.controller.ts`, `pos.service.ts`, `pos.middleware.ts`, `pos.audit.ts`, `pos.responses.ts`, `prisma/schema.prisma`, `ledger.service.ts` (saleFEFOInTx, getAvailableLotsFEFOWithTx, recordMultipleLedgerEntriesInTx).

**Frontend:**  
`app/staff/(larkon)/branch/[branchId]/pos/page.jsx`, `lib/api.ts`.

**Migrations:**  
`prisma/migrations/20260302120000_add_pos_invoice_and_order_financial_fields/migration.sql`,  
`prisma/migrations/20260302130000_add_pos_credit_note/migration.sql`.
