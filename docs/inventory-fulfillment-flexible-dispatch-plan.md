# Flexible enterprise stock-request fulfillment & dispatch

## 1. Current flow analysis (request → fulfillment → dispatch)

1. **Branch** creates a `StockRequest` (`DRAFT`) with `StockRequestItem` rows (`requestedQty`, `productId`, `variantId`).
2. **Branch** submits → `SUBMITTED` (notification to owner).
3. **Owner** opens **Owner → Inventory → Stock Requests → Detail** (`/owner/inventory/stock-requests/[id]`).
4. Owner selects **from** warehouse location and **to** branch location, enters fulfill quantities **per lot row** (only rows built from `availableLotsByVariant` from `GET /stock-requests/:id?fromLocationId=`).
5. Owner calls **`POST /api/v1/stock-requests/:id/dispatch`** with body `{ fromLocationId, toLocationId, items: [{ variantId, lotId, quantity }] }`.
6. **`fulfillAndDispatch`** (`stock_requests.service.ts`): validates status `SUBMITTED` | `OWNER_REVIEW`, creates a **`StockTransfer`** (`DRAFT`, `stockRequestId` set), **`sendTransfer`** posts **`TRANSFER_OUT`** ledger lines (lot-backed only), marks **`StockRequest.status = DISPATCHED`**.
7. **Branch** receives via existing transfer receive flow (`TRANSFER_IN`).

**Pain points observed**

- UI only renders lot rows when `StockLotBalance` has `onHandQty > 0` for the variant at the chosen location; if none, **no fulfill rows** → dispatch is effectively blocked (“No lot stock found”).
- **`sendTransfer`** rejects any `StockTransferItem` without `lotId` (“Lot-backed transfers only”), so **non-lot / aggregate-only** movement is impossible even though `StockTransferItem.lotId` is nullable and `ledger.recordLedgerEntryInTx` supports **`lotId: null`** with **`StockBalance`** updates.
- **Extra items** on the owner page require **manual variant ID** + FEFO load; no product picker.
- **No persisted “fulfilled vs requested”** on `StockRequestItem`; totals compare raw sum of dispatch lines vs sum of `requestedQty` only to decide an unused `fullFulfilled` flag.
- **Over-fulfillment** (dispatch more than requested) is not surfaced as warnings; **partial** (send less than requested) is allowed mathematically but not labeled in status (`DISPATCHED` always).

---

## 2. Data model gap

| Area | Today | Gap |
|------|--------|-----|
| `StockRequestItem` | `requestedQty` only | No **`fulfilledQty`**, no **line classification** (requested vs extra). |
| Dispatch vs request | Inferred from transfer items | No stable **requested vs fulfilled vs extra** on the request record. |
| Lots | Required for send | Blocks dispatch when inventory is only aggregate or lots missing in UI. |

---

## 3. Required schema changes

1. **`StockRequestItem`**
   - **`fulfilledQty`** `Int` `@default(0)` — set when a linked transfer is successfully sent (this release: one dispatch per request; field supports future multi-wave fulfillment).
   - **`lineKind`** enum **`REQUESTED` | `EXTRA`** (default **`REQUESTED`**). Extra lines may be created at fulfillment time for auditability.

2. **No change** to `StockTransferItem` shape beyond continuing to allow **`lotId`** nullable in DB (already optional); service layer will permit **`lotId: null`** for **manual / non-lot** dispatch lines.

3. **Optional JSON** on `StockRequest` (if needed later): `fulfillmentMeta` for warnings snapshot — not required for MVP; API can return warnings in the HTTP response only.

---

## 4. Business rules

1. **Stock availability (hard)**
   - Cannot post **`TRANSFER_OUT`** that would drive **`StockLotBalance`** or **`StockBalance`** negative.
   - **Over-fulfillment vs requested quantity** is allowed when **physically** stock exists; return **warnings**, not HTTP errors.

2. **Soft warnings (non-blocking)**
   - **`fulfillQty > requestedQty`** for a requested line → warning (e.g. `OVER_FULFILLMENT`).
   - **`fulfillQty` > available** at UI → warn before submit; backend still **rejects** if it would violate stock (hard).

3. **Lot vs non-lot**
   - If **FEFO / explicit lots** can cover the quantity → use lot lines (expiry-safe, recall/QC rules via existing FEFO helpers).
   - If **no lot coverage** but **`StockBalance`** (aggregate) can cover → allow **single line `lotId: null`** (**manual / fallback mode**), with a warning `NON_LOT_DISPATCH`.

4. **Status**
   - After dispatch: set **`FULFILLED_PARTIAL`** if total fulfilled quantity for **requested** lines is **less than** total requested; otherwise **`FULFILLED_FULL`** or **`DISPATCHED`** per existing conventions (implementation: **`FULFILLED_PARTIAL`** vs **`DISPATCHED`** for “met or exceeded” to keep list filters meaningful).

---

## 5. UI flow (Owner detail page)

1. **Per requested line**: show **Requested**, **Fulfill qty** (editable), **Delta** (fulfill − requested) with color: **red** (under), **green** (over), **neutral** (equal).
2. **Lot grid**: when **manual mode** off — show FEFO / per-lot rows as today; **Auto-fill FEFO** preserved.
3. **Manual mode** toggle: prefer **non-lot** line when policy allows (one line per variant for that mode).
4. **No lots at location**: **warning** banner, not a hard blocker; offer **manual non-lot** if balance exists.
5. **Extra items**: **searchable product picker** (same API as create flow: **`GET /api/v1/inventory/stock-request-products?branchId=...`**), variant dropdown, fulfill qty, add to dispatch.
6. Submit via **`PATCH /api/v1/stock-requests/:id/fulfill`** (new) with flexible payload; keep **`POST .../dispatch`** for backward compatibility.

---

## 6. API changes

### New: `PATCH /api/v1/stock-requests/:id/fulfill`

**Auth**: org owner (same as dispatch).

**Body (example)**

```json
{
  "fromLocationId": 1,
  "toLocationId": 2,
  "manualMode": false,
  "items": [
    {
      "stockRequestItemId": 10,
      "fulfillQty": 7,
      "lots": [{ "lotId": 5, "quantity": 7 }]
    }
  ],
  "extraItems": [
    { "productId": 3, "variantId": 9, "fulfillQty": 2 }
  ]
}
```

- **`items`**: requested lines; **`fulfillQty`** may be `<`, `=`, or `>` **`requestedQty`** (warnings).
- **`lots`**: optional; if omitted and **`manualMode` false**, server runs **FEFO** then **non-lot fallback** if needed.
- **`extraItems`**: adds fulfillment for variants not on the original request; may create **`StockRequestItem`** with **`lineKind = EXTRA`**.

### Legacy: `POST /api/v1/stock-requests/:id/dispatch`

Unchanged contract: `{ fromLocationId, toLocationId, items: [{ variantId, lotId, quantity }] }` with **`lotId`** still supported; optional **`lotId`** omission can be documented as deprecated in favor of PATCH.

### Response (fulfill)

Include **`data.transfer`**, **`data.fulfillment`**:

```json
{
  "requestedQty": 100,
  "fulfilledQty": 73,
  "remainingQty": 27,
  "overFulfilledQty": 0,
  "warnings": [{ "code": "OVER_FULFILLMENT", "message": "..." }]
}
```

(Exact field names aligned with implementation.)

---

## 7. Validation rules

1. Request must be **`SUBMITTED`** or **`OWNER_REVIEW`** (same as today).
2. **`fulfillQty`** ≥ 0 integer; at least one line with **> 0** total.
3. **Explicit lots**: sum of lot quantities = **`fulfillQty`** per line (or documented tolerance — default strict equality).
4. **Org/location** ownership unchanged from current checks.

---

## 8. Edge cases

| Case | Behavior |
|------|----------|
| Multiple lots same variant | Multiple `StockTransferItem` rows; receive flow already assumes one row per variant in some paths — known limitation elsewhere. |
| FEFO short | Fallback to **`StockBalance`** non-lot line if full qty available; else error. |
| Extra only dispatch | Allowed if **`extraItems`** carry all quantity. |
| Concurrency | `sendTransfer` + ledger writes remain transactional; two simultaneous dispatches for same request prevented by **single `stockRequestId` on transfer** (unique). |

---

## 9. Migration / compatibility

1. Prisma migration: add **`fulfilledQty`**, **`lineKind`** with default **`REQUESTED`**.
2. Existing rows: **`fulfilledQty = 0`**; no backfill of historical transfers unless scripted separately.
3. Old clients using **`POST /dispatch`** continue to work.

---

## 10. Verification checklist

1. Requested **10**, fulfill **3** → dispatch succeeds; **`FULFILLED_PARTIAL`**; **`remainingQty`** correct.
2. Requested **50**, fulfill **70** (stock ≥ 70) → success + **over-fulfillment** warning.
3. No lots but aggregate stock → **non-lot** dispatch succeeds with warning.
4. Extra item via picker → appears on transfer / optional **`EXTRA`** line rows.
5. Stock **decreases** correctly (lot and/or aggregate).
6. No unhandled runtime errors on owner page.
7. UI shows requested vs fulfill vs delta colors.

---

## Implementation notes (completed in repo)

- **`transfers.service.sendTransfer`**: branch for **`lotId == null`** using **`StockBalance`** check + **`recordLedgerEntryInTx`** with **`lotId: null`**.
- **`stock_requests.service`**: expand flexible payload → lines; update **`fulfilledQty`**; return warnings + summary.
- **Owner `page.tsx`**: editable fulfill qty per request line, manual toggle, product picker, **`ownerPatch`** to **`/fulfill`**.
