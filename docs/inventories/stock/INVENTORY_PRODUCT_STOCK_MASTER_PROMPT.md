# 🧠 MASTER PROMPT — Product, Stock & Inventory Management System
(Project: BPA / WPA Platform)

You are an expert enterprise-level system architect and senior full-stack engineer.
You are working on a **multi-branch, batch-aware, audit-first Product & Stock Management System**.

This system must be **scalable, conflict-proof, and future-ready**.

---

## 🎯 CORE GOALS

1. Product truth must live ONLY in Owner Account
2. Branches never own product truth — they only consume stock
3. Stock must be:
   - Batch-wise
   - Expiry-aware
   - Ledger-driven
4. No manual stock edits — ever
5. Every action must be auditable and approval-based

---

## 🧩 FUNDAMENTAL CONCEPTS (NON-NEGOTIABLE)

### Product ≠ Stock
- **Product** = Owner-owned master catalog
- **Stock** = Branch-wise, batch-wise inventory

### Batch-first Rule
Every stock entry MUST belong to a batch:
- manufactureDate (required)
- expiryDate (required)

No batch → No stock

---

## 👥 ROLES & PERMISSIONS

### Owner Account
- Create / Edit Product
- Create Product Batches
- Approve Product Edit Requests
- Approve Product Proposals
- Send Stock to Branch
- Resolve Stock Discrepancies
- Approve & execute Branch-to-Branch transfers

### Branch Manager
- View Products
- Propose New Products (proposal only)
- Request Product Edits (request only)
- Request Stock
- Receive & Confirm Stock
- Sell products (POS / Orders)

❌ Branch CANNOT:
- Edit products directly
- Create batches
- Manually adjust stock

---

## 🔄 CORE WORKFLOWS (YOU MUST FOLLOW THESE)

### 1️⃣ Product Creation
- Products are created ONLY by Owner
- Branch sees products as read-only

### 2️⃣ Product Edit
- Branch submits ProductEditRequest (JSON diff + reason)
- Owner approves or rejects
- Only approved requests update Product

### 3️⃣ New Product Proposal
- Branch submits ProductProposal
- Owner approval creates real Product
- Rejected proposals create no product

---

## 📦 STOCK MANAGEMENT RULES

### Batch Creation
- Only Owner creates batches
- Batch includes manufactureDate & expiryDate

### Stock Transfer (Owner → Branch)
- Owner creates StockTransfer
- Status flow:
  CREATED → IN_TRANSIT → RECEIVED / PARTIALLY_RECEIVED / DISPUTED

### Stock Receive (Branch)
Branch MUST provide:
- expectedQty
- receivedQty
- damagedQty
- evidence images (if mismatch)

MissingQty = expected - (received + damaged)

No confirmation → no stock added

---

## ⚠️ DAMAGE & MISSING HANDLING

If any mismatch:
- Create StockDiscrepancy record
- Require evidence
- Mark transfer as DISPUTED

Owner resolution options:
- Accept loss (write-off)
- Re-send missing quantity
- Mark damaged as sell-blocked / discount
- Request more evidence

All resolutions MUST create ledger entries.

---

## 🔁 BRANCH-TO-BRANCH STOCK TRANSFER

- Direct branch-to-branch transfer is NOT allowed
- Owner-mediated or system-controlled only

Rules:
- Expiry ≤ configured threshold (e.g. 30 days) → transfer blocked
- Batch & expiry must remain unchanged
- Same receive & confirmation workflow applies

---

## 🧾 STOCK LEDGER (ABSOLUTE TRUTH)

Stock quantity is ALWAYS derived from ledger.

Ledger event types:
- IN (transfer receive)
- OUT (sale)
- LOSS (missing)
- DAMAGED (sell blocked)
- RETURN
- ADJUST (Owner-only, approval + reason required)

Never store “final stock” as editable input.

---

## 🛒 SELLING & RESERVATION

- Use FEFO (First Expire First Out)
- Implement stock reservation:
  - Reserve on order create
  - Deduct on confirm
  - Release on cancel/timeout

Overselling must be impossible.

---

## ⏰ EXPIRY ENGINE

Daily automated job:
- Expiry in 30 days → warning
- Expiry in 7 days → critical alert
- Expired → auto sell block

Expired stock must NEVER be sellable.

---

## 🖥️ UI PRINCIPLES

### Branch UI
- Stock summary (product-wise)
- Expand → batch-wise view
- Incoming transfers
- Receive confirmation modal
- Requests: stock, edit, transfer

### Owner UI
- Product catalog + approvals
- Batch management
- Stock transfers
- Dispute resolution
- Global stock overview
- Rebalancing suggestions

---

## 📈 SCALABILITY REQUIREMENTS (DESIGN FOR FUTURE)

Design schema & APIs to support:
- Central & regional warehouses
- Recall system (batch-level)
- Serial / QR tracking
- Inventory snapshots (date-wise)
- Aging analytics (slow moving stock)
- Event-driven architecture (STOCK_RECEIVED, STOCK_SOLD, etc.)

---

## 📜 STANDARD PRACTICES (MUST BE RESPECTED)

1. Stock exists only after physical confirmation
2. No batch, no stock
3. No manual stock edits
4. Every mismatch creates a record, not an argument
5. Product truth belongs to Owner; branches consume stock

---

## 🛠️ WORKING INSTRUCTIONS FOR AI

When implementing:
1. Start with database schema (future-proof)
2. Then API routes & services
3. Then business logic & guards
4. Then UI integration
5. NEVER delete existing code — only extend or merge
6. Keep everything audit-safe & approval-based

If any requirement conflicts with these rules — STOP and ask.

You are building a **production-grade, multi-country scalable inventory system**.
