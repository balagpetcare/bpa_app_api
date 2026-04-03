# Branch Verification vs Operational Active – Root Cause and Fix

## 1. Root cause

- **Observed**: Admin verification center shows branches as VERIFIED/approved, but staff clinic panel throws `VALIDATION_ERROR: Branch is not active.` when creating an appointment (e.g. branch 5, route `/staff/branch/5/clinic/appointments/new`).
- **Cause**: Two separate concepts were out of sync:
  - **Verification (KYC)**: `BranchProfileDetails.verificationStatus` and optionally `Branch.verificationStatus` (VERIFIED after admin approve).
  - **Operational status**: `Branch.status` (lifecycle: DRAFT → PENDING_REVIEW → ACTIVE | INACTIVE | BLOCKED).
- **Logic bug**: On admin **approve** (branch KYC), the code set `Branch.status = "DRAFT"` (comment: “ready for publish request”) and did **not** set `Branch.status = "ACTIVE"` or `Branch.verificationStatus = "VERIFIED"`. Appointment creation (and other clinic flows) require `Branch.status === "ACTIVE"`. So verified branches never became operationally active.

**Conclusion**: Workflow bug – verification approval did not transition the branch into the active operational state that clinic/appointment logic expects.

---

## 2. Files audited

| Area | Files |
|------|--------|
| Branch model | `prisma/schema.prisma` (Branch, BranchStatus, VerificationStatus, BranchProfileDetails) |
| Appointment validation | `src/api/v1/modules/clinic/appointment.service.ts` (`validateCreateAppointmentData`, line 220) |
| Admin branch verification | `src/api/v1/modules/admin_verifications/admin_verifications.controller.ts` (`approveBranchKyc`, `rejectBranchKyc`, `requestChangesBranchKyc`, `suspendBranchKyc`, `listBranchKycs`) |
| Owner branch submit | `src/api/v1/modules/owner/owner.controller.ts` (submit flow, dashboard metrics) |
| Other branch status usage | `src/api/v1/services/appointmentAvailability.service.ts`, `src/api/v1/modules/clinic/clinic.controller.ts`, `src/api/v1/modules/doctor/doctor.service.ts`, `src/api/v1/modules/owner/owner.controller.ts` |
| Admin status mapping | `src/api/v1/modules/admin/admin.controller.ts` (`updateEntityStatus`: APPROVED → ACTIVE) |
| Publish request flow | `src/api/v1/modules/partner_onboarding/admin_onboarding.controller.ts` (sets Branch ACTIVE on publish approve) |

---

## 3. Branch state model (actual)

- **Branch** (Prisma):
  - `status`: `BranchStatus` = DRAFT | PENDING_REVIEW | ACTIVE | INACTIVE | BLOCKED (default DRAFT).
  - `verificationStatus`: `VerificationStatus` = UNSUBMITTED | SUBMITTED | VERIFIED | REJECTED | EXPIRED (default UNSUBMITTED).
- **BranchProfileDetails** (KYC profile): `verificationStatus` (same enum).
- **Used by**:
  - Admin verification center: lists `BranchProfileDetails`, filters by `verificationStatus`; approve updates profile + Branch.
  - Appointment creation: `appointment.service.ts` loads `Branch` by `branchId`, checks `branch.status === "ACTIVE"`; no use of `verificationStatus`.
  - Owner dashboard: uses both `status` and `verificationStatus` for counts (active / inactive / pending).

---

## 4. Business rule chosen

- **Verification approval = branch becomes operationally usable.**  
  When admin approves branch KYC, the branch is set to **ACTIVE** and **VERIFIED** so clinic (appointments, etc.) can use it without a separate “publish” step.
- **Reject**: Branch remains **DRAFT**, `Branch.verificationStatus` set to **REJECTED** for consistency.
- **Request changes**: Branch set back to **DRAFT** (no change to operational status logic).
- **Suspend**: Branch set to **BLOCKED** (BranchStatus has no SUSPENDED; BLOCKED prevents operational use).
- **Appointment validation**: Unchanged – still requires `Branch.status === "ACTIVE"`. No weakening of validation.

---

## 5. Files changed

| File | Change |
|------|--------|
| `src/api/v1/modules/admin_verifications/admin_verifications.controller.ts` | **approveBranchKyc**: set Branch `status: "ACTIVE"`, `verificationStatus: "VERIFIED"` (no longer DRAFT). **rejectBranchKyc**: set Branch `verificationStatus: "REJECTED"` in addition to status DRAFT. **suspendBranchKyc**: set Branch `status: "BLOCKED"` (was invalid "SUSPENDED"). **listBranchKycs**: include `branch.status` and `branch.verificationStatus` in response. |
| `scripts/backfill-branch-verified-to-active.ts` | New one-time script: set Branch `status: "ACTIVE"`, `verificationStatus: "VERIFIED"` for branches that are verified (profile or branch) but not ACTIVE. |
| `src/api/v1/modules/clinic/appointment.service.branchActive.test.ts` | New test: error code/message and branch.status condition for appointment create. |
| `docs/CLINIC_BRANCH_VERIFICATION_ACTIVE_FIX.md` | This report. |

---

## 6. Data repair / backfill

- **Script**: `scripts/backfill-branch-verified-to-active.ts`
- **What it does**: Finds branches where (BranchProfileDetails.verificationStatus = VERIFIED or Branch.verificationStatus = VERIFIED) and Branch.status ≠ ACTIVE; updates those to `status: "ACTIVE"`, `verificationStatus: "VERIFIED"`.
- **Usage**:
  - Dry run: `DRY_RUN=1 npx ts-node scripts/backfill-branch-verified-to-active.ts`
  - Apply: `npx ts-node scripts/backfill-branch-verified-to-active.ts`
- **When**: Run once after deploying the controller fix (e.g. for branch 5 and any other already-verified but inactive branches).

---

## 7. How the fix works

1. **Admin approves branch** (e.g. in `/admin/verifications/branches`, approve for a branch):
   - BranchProfileDetails: `verificationStatus = VERIFIED`, `reviewedAt`, etc.
   - Branch: `status = "ACTIVE"`, `verificationStatus = "VERIFIED"`.
2. **Appointment creation** (e.g. `/staff/branch/5/clinic/appointments/new`):
   - `validateCreateAppointmentData` loads Branch by `branchId`; condition `branch.status !== "ACTIVE"` is false, so validation passes and appointment can be created.
3. **Existing verified-but-inactive branches**: Run backfill so their `Branch.status` becomes ACTIVE and they behave like newly approved branches.

---

## 8. Validation (branch 5 scenario)

- **Before fix**: Branch 5 has BranchProfileDetails VERIFIED (or Branch.verificationStatus VERIFIED) and Branch.status = DRAFT (or non-ACTIVE). Create appointment → `VALIDATION_ERROR: Branch is not active.`
- **After fix** (and backfill for existing data):
  1. New approvals: Branch 5 gets status ACTIVE and verificationStatus VERIFIED when admin approves.
  2. Already approved: Run `npx ts-node scripts/backfill-branch-verified-to-active.ts` so branch 5 (and others) get status ACTIVE.
  3. Create appointment for branch 5 → no “Branch is not active” error (other validations still apply: service, pet, etc.).

---

## 9. Risks and follow-up

- **Publish request flow**: `admin_onboarding.controller.ts` also sets Branch to ACTIVE when a **publish request** is approved. That flow remains; it can still be used for a separate “go live” step if needed. Now KYC approval alone is enough for clinic use.
- **REQUEST_CHANGES / SUSPENDED**: BranchProfileDetails uses `VerificationStatus` enum (UNSUBMITTED, SUBMITTED, VERIFIED, REJECTED, EXPIRED). The controller still sets `verificationStatus: "REQUEST_CHANGES"` and `"SUSPENDED"` on BranchProfileDetails; if the schema does not allow these values, that may need a separate schema or enum fix.
- **Admin UI**: `listBranchKycs` now returns `branch.status` and `branch.verificationStatus` so the admin verification center can show “Verified” and “Operational status” (e.g. Active) clearly if desired.
- **Tests**: `src/api/v1/modules/clinic/appointment.service.branchActive.test.ts` asserts the error code and message and documents the branch.status === "ACTIVE" condition. Full flow: run backfill then create appointment for branch 5 (manual or e2e).
