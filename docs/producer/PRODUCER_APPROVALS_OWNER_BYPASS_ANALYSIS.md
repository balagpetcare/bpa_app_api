# Producer Approvals — Owner Bypass: Phase 0 Analysis & Phase 1 Proposal

## Phase 0 — Current Implementation Summary

### 1. Backend models (Prisma)

| Location | Relevant detail |
|----------|-----------------|
| `prisma/schema.prisma` | **ProducerOrg**: `ownerUserId` (owner of the org). |
| | **ProducerApproval**: `producerOrgId`, `entityType` (PRODUCT \| BATCH), `entityId`, `status` (SUBMITTED \| APPROVED \| REJECTED), `submittedByUserId`, `reviewedByUserId`, `reviewedAt`, `note`. Unique on `(producerOrgId, entityType, entityId)`. |
| | **AuthProduct**: `status` (AuthProductStatus: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, ACTIVE, INACTIVE), `submittedAt`, `reviewedAt`, `createdByUserId`. |
| | **AuthBatch**: `status` (DRAFT, APPROVED, REJECTED, GENERATED). |

### 2. Role detection (producer auth)

| File | What it does |
|------|----------------|
| `src/api/v1/middlewares/producerAuth.ts` | **requireProducerPermission(perms)**: Resolves org by `ProducerOrg.ownerUserId === userId` → sets `req.producerOrgId`, `req.isProducerOwner = true`. Else looks up `ProducerOrgStaff` by userId (and optional producerOrgId), checks role permissions → sets `req.producerOrgId`, `req.isProducerOwner = false`. |
| | **requireProducerOwner**: Allows only if `ProducerOrg` exists with `ownerUserId === userId`; sets `req.producerOrgId`, `req.isProducerOwner = true`. |
| | **Single source of “is owner”**: Currently only on `req.isProducerOwner` set by these middlewares. No shared function that can be called from services. |

### 3. Product creation flow

| File | Flow |
|------|------|
| `src/api/v1/modules/producer/producer.controller.ts` | **createProduct**: Uses `requireProducerPermission(["producer.products.write"])` (so `req.isProducerOwner` is set). Calls `service.createProduct(userId, producerOrgId, req.body)`. Does **not** call approval service; writes audit `PRODUCT_CREATED` with `actorType: req.isProducerOwner ? "OWNER" : "STAFF"`. |
| `src/api/v1/modules/producer/producer.service.ts` | **createProduct**: Creates `AuthProduct` with `status: "DRAFT"`, `createdByUserId: userId`. No approval row created. |

So: **product creation never creates a ProducerApproval.** Owner-created products only get an approval row when someone later calls **submit product**.

### 4. Submit product flow (where the bug is)

| File | Flow |
|------|------|
| `producer.controller.ts` | **submitProduct**: Calls `service.submitProduct(userId, producerOrgId, id)` then **always** calls `approvalService.submitProductForApproval(producerOrgId, data.id, userId)`. Does not branch on `req.isProducerOwner`. |
| `producer.service.ts` | **submitProduct**: Updates product to `status: "SUBMITTED"`, `submittedAt: now`. |
| `producerApproval.service.ts` | **submitProductForApproval**: Upserts **ProducerApproval** with `status: "SUBMITTED"`, `submittedByUserId`. |

So: **when the OWNER clicks “Submit for approval”, we still create a ProducerApproval with status SUBMITTED.** That row is then returned by the approvals list.

### 5. Submit batch flow (same pattern)

| File | Flow |
|------|------|
| `producer.controller.ts` | **submitBatch**: Always calls `approvalService.submitBatchForApproval(...)`. No owner check. |
| `producerApproval.service.ts` | **submitBatchForApproval**: Upserts ProducerApproval (BATCH) with `status: "SUBMITTED"`. |

Owner-submitted batches also get a SUBMITTED approval row and appear in the list.

### 6. Approvals listing

| File | Logic |
|------|--------|
| `producerApproval.service.ts` | **listApprovals(producerOrgId, params)**: `status = params.status || "SUBMITTED"`. `where = { producerOrgId, status, entityType? }`. Returns all matching rows. |
| | So the list is “all approvals with status SUBMITTED” (and optional type). It does **not** exclude rows where the submitter is the org owner. |

### 7. Why the bug happens

- **Submit (product or batch)** always creates/updates a **ProducerApproval** with **status SUBMITTED**, regardless of whether the actor is the owner or staff.
- **listApprovals** returns every row with **status === SUBMITTED** for the org.
- So when the **owner** submits their own product (or batch), we create a SUBMITTED approval and the owner sees it in “Pending approvals” — i.e. the owner is asked to approve their own submission.

**Root cause:** No branch on “actor is owner” in submit flows, and no exclusion of owner-submitted rows in the listing (or we avoid creating a “pending” row for owner at all).

---

## Phase 1 — Proposed Code Changes

### Option chosen: owner auto-approve at submit (no schema change)

- When **owner** submits product: set product to **UNDER_REVIEW**, create/upsert **ProducerApproval** with **status APPROVED** and `reviewedByUserId = userId`, `reviewedAt = now` (so it does not appear in “pending” list).
- When **owner** submits batch: set batch to **APPROVED**, create/upsert **ProducerApproval** with **status APPROVED** and `reviewedByUserId`, `reviewedAt`.
- When **staff** submits: keep current behaviour (product/batch SUBMITTED + ProducerApproval SUBMITTED).
- **listApprovals**: Keep returning only rows with **status === SUBMITTED** (explicit in code). No need to filter by “submitter ≠ owner” if we never create SUBMITTED rows for owner.

No new enum value and no change to ProducerApproval model. Optional: add audit events PRODUCT_AUTO_APPROVED / BATCH_AUTO_APPROVED when owner auto-approves.

---

### Backend changes (exact)

#### A) Single source of truth: `resolveProducerActorIsOwner(userId, producerOrgId)`

- **New file (or in existing producer auth/util):** e.g. `src/api/v1/modules/producer/producerAuthHelpers.ts` (or add to `producerApproval.service.ts` if you prefer).
- **Function:**  
  `resolveProducerActorIsOwner(userId: number, producerOrgId: number): Promise<boolean>`  
  - Query: `ProducerOrg.findFirst({ where: { id: producerOrgId, ownerUserId: userId }, select: { id: true } })`.  
  - Return `!!org`.
- Use this (or `req.isProducerOwner` set by middleware) so controller and approval service share one notion of “is owner”.

#### B) Product creation

- **createProduct** (controller + service):  
  - **No change** to creating a ProducerApproval (we don’t create one today).  
  - **Optional (later):** If product is created by owner and you want it to start in UNDER_REVIEW instead of DRAFT, that would be a separate product-creation change; **not required** for “owner must not see own items in approvals” and can be done in a follow-up.

So for this fix: **no change** to product creation; only submit + listing.

#### C) Submit product (owner → auto-approve)

- **producer.controller.ts** — **submitProduct**:
  - If `req.isProducerOwner` (or `await resolveProducerActorIsOwner(userId, producerOrgId)`):
    - Call a **new** approval service method, e.g. `approvalService.autoApproveProductAsOwner(producerOrgId, productId, userId)` (see below).
    - Response: e.g. `{ product, approval, message: "Approved (owner)" }` or `message: "Product submitted for platform review"`.
  - Else:
    - Keep current: `service.submitProduct` + `approvalService.submitProductForApproval`.
- **producerApproval.service.ts**:
  - **New:** `autoApproveProductAsOwner(producerOrgId, productId, userId)`:
    - Load product (same as submitProductForApproval). If not found, throw 404.
    - In one transaction:
      - Update **AuthProduct**: `status: "UNDER_REVIEW"`, `submittedAt: now`, `reviewedAt: now` (and optionally `reviewedByAdminId` or a dedicated “owner approved” field if you add it later; for now just status + dates).
      - Upsert **ProducerApproval** (same unique key): `status: "APPROVED"`, `submittedByUserId: userId`, `reviewedByUserId: userId`, `reviewedAt: now`.
    - Return the approval (and optionally product).
  - **submitProductForApproval**: Unchanged; still used for staff.

#### D) Submit batch (owner → auto-approve)

- **producer.controller.ts** — **submitBatch**:
  - If owner: call new `approvalService.autoApproveBatchAsOwner(producerOrgId, batchId, userId)`.
  - Else: keep current `submitBatchForApproval`.
- **producerApproval.service.ts**:
  - **New:** `autoApproveBatchAsOwner(producerOrgId, batchId, userId)`:
    - Load batch; if not found, throw 404.
    - In one transaction:
      - Update **AuthBatch**: `status: "APPROVED"`.
      - Upsert **ProducerApproval** (BATCH): `status: "APPROVED"`, `submittedByUserId`, `reviewedByUserId: userId`, `reviewedAt: now`.
    - Return the approval.

#### E) Approvals listing (only pending)

- **producerApproval.service.ts** — **listApprovals**:
  - Ensure `where.status` is **always** `"SUBMITTED"` when the API is used as “pending approvals” (e.g. default `params.status` to `"SUBMITTED"` and do not allow empty status to mean “all”). So only SUBMITTED rows are returned; APPROVED/REJECTED (including owner auto-approved) never appear in the inbox.
  - No change to schema or to filtering by `submittedByUserId`.

#### F) Audit (optional but recommended)

- In controller (or inside auto-approve methods), after owner auto-approve:
  - **Product:** `writeProducerAudit({ ..., action: "PRODUCT_AUTO_APPROVED", entityType: "AUTH_PRODUCT", entityId: String(productId) })`.
  - **Batch:** `writeProducerAudit({ ..., action: "BATCH_AUTO_APPROVED", entityType: "AUTH_BATCH", entityId: String(batchId) })`.
- **PRODUCT_CREATED** already logs `actorType: OWNER | STAFF`; no change needed there.

#### G) Tests (minimal)

- **Owner submit product:** Assert no ProducerApproval with `status: "SUBMITTED"` for that product; one with `status: "APPROVED"` and `reviewedByUserId === ownerId`; product status UNDER_REVIEW.
- **Staff submit product:** Assert ProducerApproval `status: "SUBMITTED"`; product status SUBMITTED.
- **listApprovals:** Assert only rows with `status: "SUBMITTED"` are returned (and owner-auto-approved rows are not).

---

### Frontend changes (Producer 3105)

#### F) After product submit

- **ProductForm (or page that calls submit):**  
  - If response indicates owner auto-approve (e.g. `message` contains “Approved” or `approval.status === "APPROVED"`), show “Approved” / “Sent for platform review” and **do not** redirect to `/producer/approvals`.
  - If response indicates pending (e.g. `approval.status === "SUBMITTED"`), show “Sent for approval” and optionally link to approvals; no change to current success message if already correct.

#### G) Approvals page

- **Approvals page** already requests `status: "SUBMITTED"`; backend will only return pending. No need to “remove UI that forces owner to approve their own items” if backend no longer returns owner’s own submissions (they will be APPROVED and filtered out). If there is any copy like “approve your own submission”, remove or reword.

---

### Files to touch (summary)

| Area | File | Change |
|------|------|--------|
| Backend | `src/api/v1/modules/producer/producerAuthHelpers.ts` (or equivalent) | New: `resolveProducerActorIsOwner(userId, producerOrgId)`. |
| Backend | `src/api/v1/modules/producer/producerApproval.service.ts` | Add `autoApproveProductAsOwner`, `autoApproveBatchAsOwner`; ensure `listApprovals` defaults to and uses `status: "SUBMITTED"` only for inbox. |
| Backend | `src/api/v1/modules/producer/producer.controller.ts` | submitProduct: branch on owner → call autoApproveProductAsOwner; submitBatch: branch on owner → call autoApproveBatchAsOwner; add audit PRODUCT_AUTO_APPROVED / BATCH_AUTO_APPROVED. |
| Backend | Tests | New or extend: owner submit product/batch does not create SUBMITTED approval; staff does; listApprovals returns only SUBMITTED. |
| Frontend | Producer product submit flow (e.g. ProductForm or page calling submit) | Handle “approved (owner)” response; do not redirect to approvals when already approved. |
| Frontend | `app/producer/(larkon)/approvals/page.jsx` | No logic change if API only returns SUBMITTED; optional copy/UX polish. |

---

### Conflicts / risks

- **Auth product status:** Current `approveApproval` in producerApproval.service sets product to **UNDER_REVIEW** (owner internal approval). Auto-approve for owner will do the same (UNDER_REVIEW) so behaviour is consistent.
- **Batch:** Owner auto-approve sets batch to APPROVED; same as when owner clicks “Approve” on a SUBMITTED batch. No conflict.
- **requireProducerOwner:** Only used for approvals **routes** (list, approve, reject). Submit product/batch use **requireProducerPermission**; both set `req.isProducerOwner`. So we can rely on `req.isProducerOwner` in the submit handlers without adding requireProducerOwner to submit routes.

---

## Next step

**STOP after Phase 1.** Please confirm:

1. You are happy with **owner auto-approve at submit** (product → UNDER_REVIEW + ProducerApproval APPROVED; batch → APPROVED + ProducerApproval APPROVED) and **listApprovals** returning only **SUBMITTED**.
2. You do **not** want product **creation** by owner to auto-set status to UNDER_REVIEW (we only fix submit + listing).
3. Any preference on where to put `resolveProducerActorIsOwner` (new `producerAuthHelpers.ts` vs inside approval service vs reusing only `req.isProducerOwner` in controller).

After your approval, implementation can proceed on branch `work/fix-producer-approvals-owner-bypass` (backend + web) with the exact changes above and verification steps.

---

## Implementation notes (completed)

### Backend (branch: work/fix-producer-approvals-owner-bypass)

- **producerAuthHelpers.ts** (new): `resolveProducerActorIsOwner(userId, producerOrgId)` — single source of truth for owner check in services.
- **producerApproval.service.ts**:  
  - `listApprovals`: default/unspecified status forces `status === "SUBMITTED"` so only pending items are returned; explicit `params.status === "APPROVED"` or `"REJECTED"` still allowed.  
  - `autoApproveProductAsOwner(producerOrgId, productId, userId)`: in one transaction updates AuthProduct to UNDER_REVIEW (submittedAt, reviewedAt) and upserts ProducerApproval with status APPROVED, reviewedByUserId, reviewedAt; returns `{ product, approval, previousStatus }`.  
  - `autoApproveBatchAsOwner(producerOrgId, batchId, userId)`: in one transaction updates AuthBatch to APPROVED and upserts ProducerApproval APPROVED; returns `{ approval }`.
- **producer.controller.ts**:  
  - `submitProduct`: if `req.isProducerOwner` → `autoApproveProductAsOwner`, audit PRODUCT_AUTO_APPROVED (entityId enriched with productId|oldStatus|newStatus:UNDER_REVIEW), response `data: { product, approval, autoApproved: true }`, message "Approved (owner). Sent for platform review."; else unchanged (staff path).  
  - `submitBatch`: if `req.isProducerOwner` → `autoApproveBatchAsOwner`, audit BATCH_AUTO_APPROVED, response `data: { approval, autoApproved: true }`; else unchanged.
- **Tests**: `producerApproval.ownerBypass.test.ts` — listApprovals SUBMITTED/APPROVED filter, autoApproveProductAsOwner returns APPROVED + UNDER_REVIEW, submitProductForApproval (staff) creates SUBMITTED, autoApproveBatchAsOwner returns APPROVED.

### Frontend (branch: work/fix-producer-approvals-owner-bypass)

- **ProductForm.jsx**: After submit, reads `data.autoApproved` or `data.approval?.status === "APPROVED"`; sets product state to UNDER_REVIEW and toasts "Approved. Sent for platform review." when auto-approved, else "Submitted for approval" and SUBMITTED. No redirect to approvals (unchanged).
- **Batches page**: `handleSubmit` checks response `data.autoApproved` / `data.approval?.status === "APPROVED"` and toasts "Approved." vs "Batch submitted for approval."
- **Batch [id] page**: Submit handler uses response `res?.data?.autoApproved` / `res?.data?.approval?.status` and shows "Approved." vs "Submitted for approval."
- **Approvals page**: No change; continues to request list with default (SUBMITTED only).

---

## Verification steps

1. **Owner submits product**
   - Log in as producer **owner** (user who owns the producer org).
   - Create or open a DRAFT product, add proof, accept declaration, click **Submit for approval**.
   - **Expected:** Toast "Approved. Sent for platform review." Product status becomes UNDER_REVIEW. Open `/producer/approvals` — this product must **not** appear in Pending approvals.
   - Console/network: POST `/api/v1/producer/products/:id/submit` returns `200`, `data.autoApproved === true`, `data.approval.status === "APPROVED"`.

2. **Staff submits product**
   - Log in as producer **staff** (user with staff role, not owner).
   - Submit a product for approval.
   - **Expected:** Toast "Submitted for approval." Product status SUBMITTED. As **owner**, open `/producer/approvals` — this product **must** appear in Pending approvals and can be approved/rejected there.

3. **Owner submits batch**
   - As owner, create a batch (DRAFT) and click **Submit for approval** (from batches list or batch detail).
   - **Expected:** Toast "Approved." (or "Approved." in batch [id] alert). Batch status APPROVED. Batch must **not** appear in `/producer/approvals`.

4. **Staff submits batch**
   - As staff, submit a batch.
   - **Expected:** "Batch submitted for approval." Batch appears in owner’s approvals list.

5. **Approvals list**
   - With only owner-submitted products/batches: `/producer/approvals` shows no pending items (or only staff-submitted ones).
   - With staff-submitted items: they appear with status SUBMITTED; owner can approve/reject.

6. **Re-submit idempotency (owner)**
   - As owner, submit the same product (e.g. from DRAFT again after edit) or batch twice.
   - **Expected:** Second request still returns APPROVED; no duplicate SUBMITTED row; approvals list still does not show the item.
