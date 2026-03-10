# POS Core Engine — Manual QA Script

Run after applying migrations and seeding data. Staff POS URL: `http://localhost:3104/staff/branch/{branchId}/pos`.

---

## Prerequisites

1. **Migrations applied**
   - `npx prisma migrate deploy` (or apply `20260302120000_add_pos_invoice_and_order_financial_fields` and `20260302130000_add_pos_credit_note`).

2. **Seed data (minimal)**
   - At least one **Branch** with an **InventoryLocation** `type = SHOP`, `isActive = true`.
   - **Product(s)** with **ProductVariant(s)**; at least one variant with `barcode` set.
   - **StockBalance** (or **StockLotBalance** + **StockLedger**) so the SHOP location has stock for those variants.
   - **LocationPrice** for (SHOP locationId, variantId) so POS shows a price.
   - **BranchMember** for a test user with:
     - BRANCH_MANAGER: `pos.view`, `pos.sell`, `pos.refund`, `pos.discount.override`.
     - SELLER: `pos.view`, `pos.sell` only (for permission tests).

3. **Auth**
   - Log in as a user who is a BranchMember of the branch used in the URL.

---

## Test Cases

### 1. Products and auto-price

1. Open POS: `http://localhost:3104/staff/branch/{branchId}/pos`.
2. In **New Sale**, ensure product list loads.
3. Add a product that has a **variant** with `price` from API (LocationPrice).
4. **Pass:** Cart line shows a non-zero unit price (auto-filled).

### 2. Barcode lookup

1. In the barcode field, type a barcode that exists on a **ProductVariant** and has stock at the branch’s SHOP location.
2. Press Enter (or click “Add by barcode”).
3. **Pass:** One line added to cart with correct product/variant and price (if LocationPrice exists).

### 3. Sale with discount

1. Add at least one item to cart.
2. Choose a discount preset (e.g. 10%) or, as manager, enter a custom discount.
3. **Pass:** Subtotal, discount amount, and grand total update correctly.
4. Select payment method and click **Complete sale**.
5. **Pass:** Success message; order appears in Sales History; “Print invoice” appears.

### 4. Print invoice

1. After a successful sale, click **Print invoice**.
2. **Pass:** Modal shows invoice with invoice number, items, subtotal, discount, total, payment method.
3. Click **Print** (or browser Print).
4. **Pass:** Print view shows only invoice content (no full page clutter).

### 5. Insufficient stock

1. Add an item to cart with quantity greater than available stock at the SHOP location.
2. Click **Complete sale**.
3. **Pass:** Request fails with message indicating insufficient stock (e.g. INSUFFICIENT_STOCK or “Insufficient stock…”).

### 6. Receipt view

1. After a sale, click **View receipt**.
2. **Pass:** Modal shows order number, date, items, total, payment method.

### 7. Sales History and order detail

1. Go to **Sales History**.
2. **Pass:** List shows branch orders (e.g. the one just created).
3. Click **View** on an order.
4. **Pass:** Modal shows order details and items.

### 8. Line-item return (manager)

1. Log in as a user with `pos.refund` (e.g. BRANCH_MANAGER).
2. Open **Refunds** tab.
3. Find a completed order (CONFIRMED/COMPLETED) that has variant items.
4. Click **Partial return**.
5. **Pass:** Form shows order lines with “Return qty” and “Reason”.
6. Set return qty (≤ ordered qty) and a reason for at least one line; submit.
7. **Pass:** Success message with credit note number (e.g. CN-…); order list refreshes.

### 9. Refund permission denied (seller)

1. Log in as a user with only `pos.view` and `pos.sell` (e.g. SELLER), no `pos.refund`.
2. Open **Refunds** tab.
3. **Pass:** Refund actions are either hidden or return 403 if attempted via API (e.g. POST /pos/return).

### 10. Branch access denied

1. Call an endpoint with a `branchId` the current user is not a member of (e.g. different branch or invalid id).
2. **Pass:** Response 403 with BRANCH_ACCESS_DENIED or “don’t have access to this branch”.

### 11. Return more than ordered

1. As manager, start a **Partial return** for an order.
2. Set “Return qty” greater than “Ordered” for a line.
3. **Pass:** Backend rejects with validation error (e.g. “Invalid return quantity” or “max N”).

---

## API Quick Checks

- `GET /api/v1/pos/products?branchId={id}` — 200, list of products with variants and `price`/stock.
- `GET /api/v1/pos/products/barcode/{code}?branchId={id}` — 200 with product/variant/stock/price, or 404.
- `POST /api/v1/pos/sale` — body: branchId, items (productId, variantId?, quantity, price), paymentMethod, discountPercent?, taxPercent?; 201 with order + posInvoice.
- `GET /api/v1/pos/invoice/{orderId}` — 200 with invoice payload (branch resolved from order).
- `POST /api/v1/pos/return` — body: branchId, orderId, items (variantId, quantity, reason?); 201 with returnRequest and posCreditNote.

---

## Failure / Regression Notes

- **Out of stock:** Sale must fail with clear message; no order or partial ledger write.
- **Invalid serial/barcode:** Barcode lookup returns 404 or empty; no crash.
- **Permission:** Missing `pos.sell` / `pos.refund` / branch access must yield 403 with consistent envelope.
- **Concurrent last unit:** Run two sales for the same last unit in parallel; one 201, one 400 (or similar) and only one order created.
