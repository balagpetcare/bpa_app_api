# Warehouse Final Real-World Receive & Vendor Print Flow — Plan

**Created:** 2026-04-06  
**Status:** IMPLEMENTING

---

## 1. Current State

### Backend (backend-api)
- `GRN` model with `DRAFT` / `RECEIVED` / `VOIDED` status
- `VendorReceiveSession` model with `DRAFT` / `AWAITING_CONFIRMATION` / `POSTED` / `CANCELLED`
- `GrnLine` fields: `quantity` (accepted), `quantityDamaged`, `quantityShort`, `quantityExtra`, `lotCode`, `expDate`, `lineDiscrepancyNote`
- `InboundDiscrepancy` model: types `DAMAGED` / `SHORT` / `EXTRA`
- `applyManagerConfirmLineEdits` — validates and updates GRN lines in-place before posting
- `receiveGrn` — posts stock via `GRN_IN` ledger entries using `quantity + quantityExtra` as stock-in qty
- `syncInboundDiscrepanciesFromGrnLines` — creates InboundDiscrepancy records from GRN lines on post
- `printDocuments.service.ts` — `renderGrnPrintHtml`, `renderGrnDiscrepancyReportHtml`
- Routes: `POST /:id/confirm`, `POST /:id/vendor-receive/draft`, `POST /:id/vendor-receive/submit`, `GET /:id/print`, `GET /:id/print/discrepancy`

### Frontend (bpa_web)
- `ManagerReceiveEditor.tsx` — editable table for all line fields, helper buttons, summary row, save draft + confirm buttons
- `VendorReceiveGrnCard.tsx` — read-only display + submit-for-confirmation button + manager editor toggle
- `vendor-receipts/[grnId]/page.tsx` — canonical manager detail page

### Current Gaps
1. **Reconciliation formula** — current validation uses `accepted + damaged + short <= ordered + extra` (cap check); does NOT enforce full reconciliation equation
2. **Inline per-row errors** — no per-row inline error messages; only a single top-level alert
3. **Notes fields** — only `grnNotes`; missing `deliveryConditionNote` and `vendorHandoverNote` on GRN top-level
4. **Print documents** — no status watermark (DRAFT / PENDING / CONFIRMED); no dedicated vendor-facing confirmed receipt print; worksheet is PO-based not GRN-based
5. **Confirm dialog** — uses plain `window.confirm()`; lacks proper React modal
6. **Summary section** — missing `totalExpected`, `stockToPost`, `discrepancyCount` 
7. **Print route for worksheet** — no `GET /:id/print/worksheet` for GRN-based worksheet
8. **Audit** — does not record pre/post-confirm delta

---

## 2. Real-World Business Rules

### A. Expected Base
- `expectedQty` = `purchaseOrderLine.orderedQty` for PO-linked lines; else `grnLine.quantity` (original draft)

### B. Actual Received Model
| Field | Meaning |
|---|---|
| `acceptedQty` | Good-condition stock accepted into warehouse |
| `damagedQty` | Physically received but damaged; NOT added to stock |
| `shortQty` | Expected but not physically received |
| `extraQty` | Received above expected; accepted into stock |

- `physicallyReceivedTotal = acceptedQty + damagedQty`
- `stockToPost = acceptedQty + extraQty`
- **Core reconciliation rule:** `acceptedQty + damagedQty + shortQty = expectedQty + extraQty`

### C. Valid Cases
| Scenario | accepted | damaged | short | extra | expected | Valid? |
|---|---|---|---|---|---|---|
| Exact receive | 1500 | 0 | 0 | 0 | 1500 | ✅ |
| Short receive | 1497 | 0 | 3 | 0 | 1500 | ✅ |
| Damaged in receive | 1490 | 10 | 0 | 0 | 1500 | ✅ |
| Partial + damaged | 1485 | 5 | 10 | 0 | 1500 | ✅ |
| Extra delivered | 1502 | 0 | 0 | 2 | 1500 | ✅ |
| Extra + damaged | 1501 | 1 | 0 | 2 | 1500 | ✅ |

### D. Invalid Cases (Reject on Confirm)
- Any negative quantity
- `accepted + damaged + short ≠ expected + extra` (at final confirm; draft save allows any valid intermediate state)
- `sum(accepted + extra) = 0` at confirm (nothing to post)
- Missing/invalid expiry where `requiresExpiry = true`
- Invalid date formats

---

## 3. Editable Receive Rules

**Draft save** (`POST /:id/vendor-receive/draft`):
- Accepts any non-negative values (intermediate entry)
- `allowZeroTotalStock: true`
- Does NOT enforce reconciliation rule
- Updates lines in-place

**Final confirm** (`POST /:id/confirm`):
- Enforces full reconciliation rule per line
- Enforces expiry where required
- Enforces total `stockToPost > 0`
- Then posts stock and syncs discrepancies

---

## 4. Print Document Rules

| Print | Trigger | Watermark | Contents |
|---|---|---|---|
| GRN print (`/print`) | Any time | DRAFT / PENDING CONFIRMATION / CONFIRMED RECEIPT | Full GRN with all quantities, notes, signatures |
| GRN worksheet (`/print/worksheet`) | Any time | Based on status | Physical count worksheet with blank count columns |
| Discrepancy report (`/print/discrepancy`) | Any time | Based on status | Discrepancy lines only |
| Vendor copy (same as GRN print but labeled) | Post-confirm | CONFIRMED RECEIPT — GOODS RECEIVED NOTE | Vendor signature block prominent |

**Signature blocks:**
- Vendor Representative
- Warehouse Receiving Officer
- Warehouse Manager / Approver
- (Optional) Security / Gate Check-off

---

## 5. Notification & Badge Behavior

| Event | Who gets notified | URL in notification |
|---|---|---|
| Owner/staff submits GRN for confirmation | Warehouse manager(s) at branch | `/staff/branch/{branchId}/warehouse/vendor-receipts/{grnId}` |
| Manager confirms GRN | Owner + submitter | `/staff/branch/{branchId}/warehouse/vendor-receipts/{grnId}` |

**Dashboard/sidebar badges:**
- `vendorReceivePendingCount` = `awaitingConfirmation` count (already implemented)
- Sidebar badge links to `/staff/branch/{branchId}/warehouse/receive-po`

---

## 6. Role Separation

| Role | Can create GRN | Can submit for confirmation | Can save draft edits | Can confirm & post | Can print |
|---|---|---|---|---|---|
| Owner | ✅ | ✅ | ❌ | ❌ (unless emergency) | ✅ |
| Branch staff (purchase.receive) | ✅ | ✅ | ❌ | ❌ | ✅ |
| Warehouse manager (grn.confirm.warehouse_manager) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Emergency override (inventory.emergency.override) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 7. Implementation Phases

### Phase 2 — Backend Business Rule Correction
**File:** `src/api/v1/modules/grn/grn.service.ts`

Changes:
1. Add reconciliation rule validation in `applyManagerConfirmLineEdits`:
   - On final confirm (`allowZeroTotalStock = false`): enforce `accepted + damaged + short = expected + extra`
   - On draft save (`allowZeroTotalStock = true`): skip reconciliation, allow any non-negative values
2. Expose `expectedQty` on each prepared line for validation messages
3. Accept `deliveryConditionNote` and `vendorHandoverNote` on GRN (store in `notes` structured or as separate fields if schema allows, otherwise embed in notes)

### Phase 3 — Frontend Manager Receive UX
**File:** `ManagerReceiveEditor.tsx`

Changes:
1. Per-row validation with inline error display
2. `expectedQty` column visible in table
3. Row-level reconciliation check: `accepted + damaged + short = expected + extra`
4. `deliveryConditionNote` textarea
5. `vendorHandoverNote` textarea
6. Summary section: `totalExpected`, `totalAccepted`, `totalDamaged`, `totalShort`, `totalExtra`, `stockToPost`, `discrepancyCount`
7. Confirm dialog as React modal (not `window.confirm`)
8. Print buttons: Final receive copy, Worksheet, Discrepancy report
9. "Fix invalid rows" helper button
10. Invalid rows summary at top

### Phase 4 — Backend Confirm Logic
**File:** `src/api/v1/modules/grn/grn.controller.ts`

Changes:
1. Accept `deliveryConditionNote` and `vendorHandoverNote` in confirm body
2. Store notes properly on GRN
3. Reconciliation rule enforced via updated `applyManagerConfirmLineEdits`

### Phase 5 — Discrepancy & Audit
**File:** `src/api/v1/modules/grn/grn.service.ts`

Changes:
1. Audit log records pre-confirm snapshot vs final values
2. `syncInboundDiscrepanciesFromGrnLines` already handles DAMAGED/SHORT/EXTRA — verify and harden
3. `logWarehouseAuditInTx` captures who confirmed, when, and discrepancy summary

### Phase 6 — Print Documents
**File:** `src/api/v1/modules/inventory/printDocuments.service.ts`

Changes:
1. `renderGrnPrintHtml` — add status watermark (DRAFT / PENDING CONFIRMATION / CONFIRMED RECEIPT)
2. `renderGrnPrintHtml` — add `deliveryConditionNote`, `vendorHandoverNote`, `confirmedAt`, `confirmedByUserId`
3. `renderGrnPrintHtml` — prominent 4-box signature area for vendor copy
4. New `renderGrnWorksheetHtml(grnId, orgId)` — GRN-based physical count worksheet
5. `renderGrnDiscrepancyReportHtml` — add status watermark
6. New route: `GET /:id/print/worksheet`

### Phase 7 — Notifications/Badges
Already implemented. Verify URLs are stable (`/vendor-receipts/{grnId}`).

### Phase 9 — Tests
**File:** `grn.reconciliation.test.ts` (new)

Tests:
- Valid short receive passes reconciliation
- Valid damaged receive passes
- Valid extra receive passes
- Invalid mismatch is rejected
- Draft save bypasses reconciliation
- Stock posting uses `accepted + extra`
- Damaged not posted to stock
- Discrepancy records created

---

## 8. Acceptance Criteria

- [ ] Manager can enter real counted quantities with legitimate discrepancy scenarios
- [ ] Reconciliation rule `A + D + S = E + X` enforced on confirm only
- [ ] Invalid math blocked with clear per-row message
- [ ] Draft save always succeeds with valid non-negative values
- [ ] Stock = `acceptedQty + extraQty` only
- [ ] Damaged excluded from stock posting
- [ ] Discrepancy records for DAMAGED / SHORT / EXTRA
- [ ] GRN print shows CONFIRMED RECEIPT watermark after posting
- [ ] Worksheet print available from GRN
- [ ] Vendor-facing print has full signature blocks
- [ ] No broken routes

---

## 9. Regression Checklist

- [ ] Non-vendor GRN (transfer-based) unaffected
- [ ] Existing posted GRNs still load
- [ ] Submit for confirmation still works
- [ ] Duplicate confirm still blocked (status = POSTED)
- [ ] PO over-receipt tolerance still enforced
- [ ] Expiry-required variant still validated
- [ ] Notification URLs stable (`/vendor-receipts/{grnId}`)
- [ ] `grnSaveVendorReceiveDraft` still returns 200 with partial/zero values

---

## 10. Browser QA Checklist

1. Open `/staff/branch/{id}/warehouse/receive-po` — confirm pending count badge
2. Click a GRN in AWAITING_CONFIRMATION state → opens `/vendor-receipts/{grnId}`
3. Enter exact receive (all accepted = ordered) → Confirm → stock posts ✅
4. Enter short receive (short = 3, accepted = 1497, expected = 1500) → Confirm → passes ✅
5. Enter damaged receive (damaged = 10, accepted = 1490, expected = 1500) → Confirm → passes ✅
6. Enter bad math (accepted = 100, damaged = 0, short = 0, expected = 1500, extra = 0) → row highlighted, confirm blocked ✅
7. Save draft with zeros → succeeds ✅
8. Open `/api/v1/grn/{id}/print` — see CONFIRMED RECEIPT watermark after posting ✅
9. Open `/api/v1/grn/{id}/print/worksheet` — see blank count columns ✅
10. Open `/api/v1/grn/{id}/print/discrepancy` — see discrepancy lines ✅
11. Confirm blocked on already-POSTED GRN ✅
12. Notification arrives after submission and confirmation ✅
