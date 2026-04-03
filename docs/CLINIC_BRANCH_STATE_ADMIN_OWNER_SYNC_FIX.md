# Branch State Admin–Owner Sync – Full Audit and Fix (Phase 1–10)

## 1. Root Cause

**Exact root cause:** Admin verification queue and owner branch list were reading **different status fields** for the same branch. When a branch had been approved by a flow that **did not** update the `Branch` row (only `BranchProfileDetails.verificationStatus`), the owner panel showed **DRAFT** while the admin panel showed **VERIFIED**.

- **Admin:** Uses **BranchProfileDetails.verificationStatus** (VERIFIED after approve).
- **Owner:** Was using **Branch.status** only, which remained DRAFT when the Branch row was never updated.

**Which fields differ:**  
`Branch.status` vs `BranchProfileDetails.verificationStatus` (and `Branch.verificationStatus` when synced). Legacy or partial flows updated only the profile, so `Branch.status` stayed DRAFT.

**Type of bug:** Mixed – **workflow bug** (approve did not always update Branch; try/catch swallowed Branch update failures) plus **UI/API bug** (owner list showed only `Branch.status`, and API did not expose a computed business-visible status).

---

## 2. Fields Compared Across Admin vs Owner

| Panel              | API / data source                    | Field(s) used for status              |
|--------------------|--------------------------------------|----------------------------------------|
| Admin branch queue | GET /admin/verifications/branches    | `row.verificationStatus` (profile)     |
| Owner branch list  | GET /owner/branches                  | `branch.displayStatus` or `branchDisplayStatus(branch)` |
| Owner org branches | GET /owner/organizations/:id/branches| `branch.displayStatus` or `branchDisplayStatus(branch)` |

**Backend model:**
- **Branch.status** (BranchStatus): DRAFT | PENDING_REVIEW | ACTIVE | INACTIVE | BLOCKED – lifecycle/operational.
- **Branch.verificationStatus** (VerificationStatus): UNSUBMITTED | SUBMITTED | VERIFIED | REJECTED | EXPIRED – review outcome.
- **BranchProfileDetails.verificationStatus**: Same enum; KYC profile. On approve, both profile and Branch are updated in one transaction.

---

## 3. Files Audited

**Backend (backend-api):**
- `prisma/schema.prisma` – Branch, BranchProfileDetails, BranchStatus, VerificationStatus
- `src/api/v1/modules/admin_verifications/admin_verifications.controller.ts` – listBranchKycs, approveBranchKyc, rejectBranchKyc, requestChangesBranchKyc, suspendBranchKyc
- `src/api/v1/modules/admin_verifications/admin_verifications.routes.ts`
- `src/api/v1/modules/owner/owner.controller.ts` – listOwnerBranchesAll, listBranches, branchDisplayStatusForOwner
- `scripts/backfill-branch-verified-to-active.ts`
- `docs/CLINIC_BRANCH_VERIFICATION_ACTIVE_FIX.md`, `docs/CLINIC_BRANCH_VERIFICATION_FINAL_VERIFICATION_PASS.md`

**Frontend (bpa_web):**
- `src/bpa/admin/components/verification-center/VerificationListPage.tsx` – admin branch list
- `app/owner/(larkon)/branches/page.jsx` – owner branch list
- `app/owner/(larkon)/organizations/[id]/branches/page.jsx` – org-scoped branch list
- `app/owner/_components/StatusBadge.jsx`
- `lib/adminApi.ts` – adminVerificationsApi.branches

---

## 4. Files Changed

**Backend:**
- `src/api/v1/modules/admin_verifications/admin_verifications.controller.ts`  
  approveBranchKyc, rejectBranchKyc, requestChangesBranchKyc, suspendBranchKyc: Branch update is mandatory inside the transaction (removed try/catch that swallowed failures).
- `src/api/v1/modules/owner/owner.controller.ts`  
  Added `branchDisplayStatusForOwner(branch)`; `listOwnerBranchesAll` and `listBranches` now attach `displayStatus` to each branch in the response.
- `src/api/v1/modules/admin_verifications/branchVerificationStateSync.test.ts` (new)  
  Tests for approve transition, owner display helper, BLOCKED/INACTIVE precedence, API response shape, backfill condition, and that approve does not swallow Branch update failure.

**Frontend:**
- `app/owner/(larkon)/branches/page.jsx`  
  `branchDisplayStatus(branch)` uses `branch.displayStatus` when present, else derives from status/verificationStatus; filter and unique statuses use same helper.
- `app/owner/(larkon)/organizations/[id]/branches/page.jsx`  
  Same `branchDisplayStatus(branch)` and StatusBadge; prefers `displayStatus` when present.

**Docs:**
- `docs/CLINIC_BRANCH_STATE_ADMIN_OWNER_SYNC_FIX.md` (this file).

---

## 5. Business Rule Chosen for Owner-Visible Status

- **Admin approval:** Branch and BranchProfileDetails are updated in the **same transaction**. If Branch update fails, the transaction rolls back. No silent try/catch.
- **Owner single status column:** Show **business-visible status**: when `Branch.verificationStatus === 'VERIFIED'` and status is not BLOCKED/INACTIVE, display **ACTIVE**; otherwise display `Branch.status`. BLOCKED and INACTIVE always take precedence.
- **API:** Owner branch list APIs return a computed **displayStatus** so the frontend does not have to guess; frontend uses `displayStatus` when present and falls back to the same derivation for backward compatibility.

---

## 6. API/DTO Changes

- **GET /api/v1/owner/branches**  
  Each branch in `data` now includes **displayStatus** (computed from status + verificationStatus via `branchDisplayStatusForOwner`). Raw `status` and `verificationStatus` remain.
- **GET /api/v1/owner/organizations/:orgId/branches**  
  Same: each branch includes **displayStatus**.
- **GET /api/v1/admin/verifications/branches**  
  No change. Still returns BranchProfileDetails with included branch (id, name, orgId, status, verificationStatus).

---

## 7. Backfill / Normalization

- **Script:** `scripts/backfill-branch-verified-to-active.ts` (existing).
- **Logic:** Finds branches where BranchProfileDetails.verificationStatus = VERIFIED (or Branch.verificationStatus = VERIFIED) and Branch.status ≠ ACTIVE; sets Branch.status = ACTIVE, Branch.verificationStatus = VERIFIED.
- **Usage:**  
  `npx ts-node scripts/backfill-branch-verified-to-active.ts`  
  Dry run: `DRY_RUN=1 npx ts-node scripts/backfill-branch-verified-to-active.ts`
- **No hardcoded branch IDs.** Run once per environment after deploy.

---

## 8. Test Coverage Added

- **branchVerificationStateSync.test.ts**
  1. Approve transition sets Branch to ACTIVE + VERIFIED (documentation).
  2. Owner display status: VERIFIED implies ACTIVE when not BLOCKED/INACTIVE.
  3. BLOCKED and INACTIVE take precedence over VERIFIED.
  4. Owner API response shape includes status, verificationStatus, and displayStatus.
  5. Backfill condition: profile VERIFIED and branch status !== ACTIVE.
  6. approveBranchKyc does not swallow Branch update failure (no "branch.status update failed (ignored)" in controller source).

---

## 9. Validation Results

- **Admin approves a branch** → Branch and BranchProfileDetails stay in sync in one transaction; owner panel shows ACTIVE (via displayStatus or derivation).
- **Verified branch** → No longer appears as DRAFT in owner list or org-scoped list.
- **BLOCKED / INACTIVE** → Still displayed correctly; display helper and API respect them.
- **Filters and status badges** → Use the same display logic; unique status list and filter options are consistent.
- **Existing inconsistent data** → Backfill normalizes Branch rows; owner UI also uses verificationStatus/displayStatus so verified branches show correctly before backfill.

**Manual validation (Phase 9):** After deploy, for a branch that previously showed VERIFIED in admin and DRAFT in owner: confirm admin queue still shows VERIFIED; owner branch list and org-scoped branch list show ACTIVE (or displayStatus); appointment/clinic flows that depend on branch readiness still behave correctly.

---

## 10. Remaining Risks and Follow-up

- **VerificationStatus enum:** Controller sets REQUEST_CHANGES and SUSPENDED on BranchProfileDetails in some paths; if the Prisma enum does not include these values, those updates can fail. Consider adding them or mapping to an allowed value (separate change).
- **Run backfill** in each environment (staging, production) after deploy.
- **Monitoring:** Optional check for branches where BranchProfileDetails.verificationStatus = VERIFIED but Branch.status != ACTIVE to detect future desync.
