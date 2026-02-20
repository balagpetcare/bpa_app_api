# STOCK_REQUEST_AND_FULFILLMENT_SYSTEM.md
## BPA / WPA — Stock Request → Owner Fulfillment → Dispatch → Branch Receive (Cursor AI Agent Playbook)
**Goal:** Implement the complete “Branch requests stock (Product+Qty) → Owner fulfills with batch/expiry → Dispatch → Branch confirms receive” workflow **by reusing/modifying existing code** (no deletions).

---

## 0) Non‑negotiable rules (must follow)
- **No deletion** of existing code or tables; only **merge/extend**.
- **API port = 3000** (unchanged).
- **Next.js ports fixed** (unchanged): mother 3100, shop 3101, clinic 3102, admin 3103, owner 3104, producer 3105.
- **Product truth stays in Owner**. Branch cannot edit product/batch.
- **Stock is batch-wise + expiry-aware + ledger-driven**.
- **No receive → no sell** (incoming stock is not sellable until confirmed).
- Every movement must create **ledger** entries and **audit logs**.

---

## 1) What you are implementing (two entry paths, one engine)
### Path A — Branch Initiated (Stock Request)
1) Branch Manager creates **Stock Request** (Product + Variant + Qty only)
2) Owner reviews request and **Fulfill** (select batch/expiry/source + fulfill qty)
3) Owner **Dispatches** (creates transfer shipment)
4) Branch **Receives** (received/missing/damaged) and confirms
5) System settles inventory + ledger, closes request

### Path B — Owner Initiated (Direct Dispatch)
Owner creates a dispatch directly (bulk) → Branch receives
> This can reuse the same fulfillment + transfer engine; only the “request” step is skipped.

---

## 2) Naming (keep it consistent)
Use these terms in code/UI/docs:
- **StockRequest**: request header (branch, date, status)
- **StockRequestItem**: product/variant + requestedQty + note
- **Fulfillment**: owner action that converts request items into batch-based transfer items
- **Transfer / StockTransfer**: shipment header (sender, destination, status)
- **TransferItem**: batch_id + qty
- **ReceiveReport**: branch confirmation (received/missing/damaged per batch)
- **Ledger**: append-only truth

---

## 3) Status lifecycle
### Stock Request statuses
```
DRAFT → SUBMITTED → OWNER_REVIEW
→ FULFILLED_PARTIAL / FULFILLED_FULL
→ DISPATCHED
→ RECEIVED_PARTIAL / RECEIVED_FULL
→ CLOSED
→ (optional) CANCELLED
```

### Transfer statuses (if already exists, map to your existing ones)
```
DRAFT → DISPATCHED → IN_TRANSIT → RECEIVED_PARTIAL/FULL → COMPLETED → (optional) DISPUTED
```

---

## 4) UI design scope (WowDash)
### Branch UI (branch dashboard)
- Inventory → **Stock Requests**
  - List + filters (date, status)
  - Create request: **bulk table** (Product, Variant, Requested Qty, Notes)
  - “Repeat last request” helper (optional)
  - Submit request

### Owner UI (owner=3104)
- Inventory → **Requests → Stock Requests**
  - Daily view / filters (Date, Branch, Pending)
  - Request detail:
    - Requested items list
    - **Fulfill table** (Requested, Available, Fulfill Qty, Batch selector)
    - Save fulfillment draft
    - Dispatch now (creates transfer)
- Notifications:
  - Owner top menu shows new requests count
  - Branch top menu shows incoming shipments

### Branch Receive UI
- Inventory → Incoming Shipments
  - Receive screen: batch-wise sent qty + inputs for received/missing/damaged
  - Evidence upload when mismatch (optional but recommended)

---

# ================================
# PHASE 0 — AUDIT WHAT EXISTS
# ================================

## Objective
Prove what is already implemented and what is missing, so we reuse and avoid duplicates.

### Cursor AI Prompt (run first)
```
You are working on my existing BPA/WPA repos (API + Next.js).

Rules:
- DO NOT delete code. Only merge/extend.
- Keep ports unchanged.
- Follow existing patterns (routes, services, middlewares, DTOs, permissions).

Task:
1) Locate everything related to:
   - products, variants
   - batches, expiry, serials
   - inventory, ledger, adjustments
   - transfers (owner→branch), receiving
   - requests/approvals/notifications (if any)
2) Output docs/inventory/STOCK_REQUEST_AUDIT.md with:
   - Existing Prisma models and relations
   - Existing API routes and controllers
   - Existing UI pages (owner/branch)
   - Gaps for: StockRequest + Owner Fulfillment UI
3) Do NOT implement anything in this phase.
Return: file paths touched + summary.
```

### Done criteria
- A clear reuse-map exists.
- No guessing.

---

# ================================
# PHASE 1 — SPEC + MAPPING TO CURRENT SYSTEM
# ================================

### Cursor AI Prompt
```
Using docs/inventory/STOCK_REQUEST_AUDIT.md, create:
docs/inventory/STOCK_REQUEST_SPEC.md

Include:
- Data objects (StockRequest, StockRequestItem, Fulfillment mapping to Transfer)
- Status transitions
- Validation rules (no batch at branch side; owner selects batch; partial allowed)
- Permissions matrix (owner vs branch manager vs seller)
- Notifications requirements
- MVP vs phase-2 (repeat request, backorder, CSV bulk add)
No code in this phase.
```

### Done criteria
- Spec aligns with existing routes/models naming.
- All gaps are explicit.

---

# ================================
# PHASE 2 — DATABASE (ONLY IF NEEDED)
# ================================

### What to do
- If **StockRequest** entities do not exist, add minimal models.
- If requests already exist under another name, **reuse** and document mapping.
- Do not break existing data.

### Cursor AI Prompt
```
Based on STOCK_REQUEST_SPEC.md:
1) Determine whether StockRequest tables already exist.
2) If not, add minimal additive models + migration.
3) Ensure:
   - StockRequest stores branchId/orgId, requesterUserId, status, timestamps
   - StockRequestItem stores productId/variantId, requestedQty, note
4) Do not store batch here.
Create docs/inventory/STOCK_REQUEST_DB_CHANGELOG.md describing what changed.
```

### Done criteria
- Branch can create request with items (product+qty only).
- No batch in request tables.

---

# ================================
# PHASE 3 — API (REQUEST + FULFILLMENT + DISPATCH)
# ================================

## API capabilities (MVP)
### Branch endpoints
- Create request (draft)
- Add/update/remove items
- Submit request
- List own requests + detail

### Owner endpoints
- List requests (filters: date, branch, status)
- View request detail
- Fulfill request (choose batch + fulfill qty)
- Dispatch fulfillment (creates transfer + reserves/adjusts inventory)

### Receive endpoints
- List incoming transfers
- Receive report submit (received/missing/damaged)

> If Transfer/Receive already exists, extend it; don’t duplicate.

### Cursor AI Prompt
```
Implement API according to STOCK_REQUEST_SPEC.md reusing existing patterns.

Rules:
- Use DB transactions for inventory + ledger.
- Ensure idempotency for receive submit.
- Dispatch must validate sender stock availability (batch-wise).
- Partial fulfillment is allowed; remaining requestedQty becomes backorder/pending.
- Always write ledger events: TRANSFER_OUT, TRANSFER_IN, MISSING, DAMAGED.

Write docs/inventory/STOCK_REQUEST_API_CHANGELOG.md with:
- New/modified routes
- Controllers/services touched
- Validation rules
- Ledger entries summary
```

### Done criteria
- Branch request can be created/submitted.
- Owner can fulfill & dispatch.
- Branch can receive and ledger updates correctly.

---

# ================================
# PHASE 4 — UI (BRANCH REQUEST CREATION)
# ================================

### Cursor AI Prompt
```
Implement Branch UI for Stock Requests in WowDash style:
- List page with filters
- Create page with bulk table
- Draft/save/submit
- Detail page shows status timeline

No batch selection in Branch UI.
Use existing API client wrapper and permission gates.
Write docs/inventory/STOCK_REQUEST_UI_BRANCH.md listing routes + UX steps.
```

### Done criteria
- Branch manager can submit a 25-item request in one screen.
- Request shows in owner panel.

---

# ================================
# PHASE 5 — UI (OWNER FULFILLMENT HUB)
# ================================

### Key UX requirements
- **Daily view**: show “On 3rd, Branch X requested 25 items”
- Detail fulfill table: Requested, Available, Fulfill Qty, Batch selector
- “Fulfill & Dispatch” in one flow (or draft then dispatch)

### Cursor AI Prompt
```
Implement Owner UI for Stock Requests:
- Requests list with date+branch filters
- Daily grouping view (by date)
- Request detail with fulfillment table:
  - Owner selects batches and quantities
  - Show expiry warnings
  - Allow partial fulfillment
- Dispatch creates transfer and triggers branch incoming shipment

Write docs/inventory/STOCK_REQUEST_UI_OWNER.md listing routes + UX steps.
```

### Done criteria
- Owner can fulfill a 25-item request quickly.
- System generates transfer and branch sees incoming shipment.

---

# ================================
# PHASE 6 — RECEIVE CONFIRMATION (BRANCH)
# ================================

### Cursor AI Prompt
```
Ensure Branch Receive flow is complete:
- Incoming shipments list
- Receive screen: sent vs inputs (received/missing/damaged)
- Evidence upload if mismatch (optional)
- Submit creates ledger entries and final statuses

Write docs/inventory/STOCK_REQUEST_RECEIVE_FLOW.md with edge cases.
```

### Done criteria
- No receive → no stock added to sellable inventory.
- Partial receive and discrepancies recorded.

---

# ================================
# QUALITY GATE (MUST RUN AFTER EVERY PHASE)
# ================================

### Cursor AI Prompt
```
Before marking phase complete, verify:
1) API builds and tests pass (or at least starts cleanly)
2) Next.js builds without runtime errors
3) No duplicate route mounts introduced
4) No deletion of existing code
5) Permissions enforced (owner vs branch manager vs seller)
6) Ledger entries correct for a happy-path scenario
7) Phase docs updated in docs/inventory/

Return checklist ✅/❌ and commands run.
```

---

## 5) Happy-path scenario to test (your exact example)
**Date:** 3rd of the month
1) Branch creates StockRequest with **25 items**
2) Owner opens daily view → sees that request
3) Owner fulfills as many as possible:
   - some items full
   - some items partial (insufficient stock)
   - some items zero (backorder)
4) Owner dispatches
5) Branch receives and confirms
6) Stock becomes sellable and POS can sell FEFO

---

## 6) Deliverables checklist (what Cursor must produce)
- docs/inventory/STOCK_REQUEST_AUDIT.md
- docs/inventory/STOCK_REQUEST_SPEC.md
- docs/inventory/STOCK_REQUEST_DB_CHANGELOG.md (if DB changed)
- docs/inventory/STOCK_REQUEST_API_CHANGELOG.md
- docs/inventory/STOCK_REQUEST_UI_BRANCH.md
- docs/inventory/STOCK_REQUEST_UI_OWNER.md
- docs/inventory/STOCK_REQUEST_RECEIVE_FLOW.md

---

## 7) Finalization (when to say “done”)
System is “final” only if:
- Branch can submit a bulk request (25 items)
- Owner can fulfill + dispatch
- Branch can receive + confirm
- Ledger reflects every movement
- Permissions are enforced
- No duplicate routes / broken builds
