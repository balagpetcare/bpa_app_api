# Branch Verification → Operational Activation: Final Verification Pass

## 1. approveBranchKyc sets Branch.status = ACTIVE and Branch.verificationStatus = VERIFIED

**Verified.**  
`src/api/v1/modules/admin_verifications/admin_verifications.controller.ts` (lines 1480–1486):

- After updating BranchProfileDetails to VERIFIED, the controller updates Branch with:
  - `status: "ACTIVE"`
  - `verificationStatus: "VERIFIED"`
- Comment in code: "Make branch operationally active so clinic/appointments and other flows can use it."
- No other code path in approveBranchKyc changes Branch; the previous "status: DRAFT" update has been removed.

---

## 2. rejectBranchKyc and suspendBranchKyc use only valid BranchStatus values

**Verified.**

- **BranchStatus** (Prisma): `DRAFT` | `PENDING_REVIEW` | `ACTIVE` | `INACTIVE` | `BLOCKED`.
- **rejectBranchKyc** (lines 1528–1530): sets Branch to `status: "DRAFT"`, `verificationStatus: "REJECTED"`. `DRAFT` is valid.
- **suspendBranchKyc** (lines 1614–1618): sets Branch to `status: "BLOCKED"` (comment: "BranchStatus enum has no SUSPENDED; use BLOCKED"). `BLOCKED` is valid.
- **requestChangesBranchKyc** (lines 1573–1575): sets Branch to `status: "DRAFT"` only. `DRAFT` is valid.

No invalid BranchStatus values are used.

---

## 3. Dry-run of backfill: which branches would be updated

**Run:**  
`DRY_RUN=1 npx ts-node scripts/backfill-branch-verified-to-active.ts` (PowerShell: `$env:DRY_RUN="1"; npx ts-node scripts/backfill-branch-verified-to-active.ts`)

**Result:**

- Found **2** branches to normalize to ACTIVE + VERIFIED:
  - **Branch 2** (Bala G Pet Clinic, Uttara): `status=DRAFT`, `verificationStatus=SUBMITTED`
  - **Branch 5** (Bala G Pet Clinic, Gulshan): `status=DRAFT`, `verificationStatus=SUBMITTED`
- Selection logic: BranchProfileDetails.verificationStatus = VERIFIED and Branch.status ≠ ACTIVE (or Branch.verificationStatus = VERIFIED and status ≠ ACTIVE). So these two branches have a verified **profile** but the Branch row was left DRAFT/SUBMITTED by the old approve flow.
- Dry run wrote nothing; applying the backfill (without `DRY_RUN`) will set both to `status: "ACTIVE"`, `verificationStatus: "VERIFIED"`.

---

## 4. Branch 5 after backfill: ACTIVE + VERIFIED

**Validated by logic.**

- Backfill script updates each listed branch with:
  - `status: "ACTIVE"`
  - `verificationStatus: "VERIFIED"`
- Branch 5 is in the dry-run list, so after running the backfill once (no `DRY_RUN`), branch 5 will have:
  - `Branch.status = "ACTIVE"`
  - `Branch.verificationStatus = "VERIFIED"`
- No code changes required; run:  
  `npx ts-node scripts/backfill-branch-verified-to-active.ts`

---

## 5. Appointment creation flow for /staff/branch/5/clinic/appointments/new

**Code path confirmed.**

- Appointment create calls `validateCreateAppointmentData`, which:
  - Loads Branch by `branchId` with `select: { id: true, status: true }`
  - Throws `VALIDATION_ERROR: Branch is not active.` only when `branch.status !== "ACTIVE"`
- **Before backfill:** Branch 5 has `status = DRAFT` → condition is true → error is thrown.
- **After backfill:** Branch 5 has `status = ACTIVE` → condition is false → validation passes (other validations still apply: service, pet, etc.).
- **Re-test:** After running the backfill, open `/staff/branch/5/clinic/appointments/new?registered=1&ownerId=46&petId=12` and create an appointment. "Branch is not active" should no longer occur. If the API and DB are already using the fixed approve flow for new approvals, no backfill is needed for those branches; backfill is only for branches already verified under the old flow (e.g. 2 and 5).

---

## 6. Other clinic flows depending on Branch.status === ACTIVE

**Only one place enforces Branch.status for clinic.**

- **appointment.service.ts** – `validateCreateAppointmentData`:  
  Explicitly checks `branch.status !== "ACTIVE"` and throws "Branch is not active." This is the only clinic flow that gates on **Branch** status.
- **appointmentAvailability.service.ts** – `getBookingConstraints`:  
  Loads Branch for `clinicSettingsJson` / profileDetails only; does **not** check Branch.status.
- **clinicScheduleTime.service.ts** – `getBranchTimezone`:  
  Loads Branch for orgId only; does **not** check Branch.status.
- **clinic.controller.ts** – various endpoints:  
  Use `branchId` and load Branch for `orgId` or other fields; no Branch.status checks.
- **doctor.service.ts** – branch usage:  
  Loads Branch for org/context; no Branch.status === ACTIVE gate for clinic operations.

Other "status: ACTIVE" filters in clinic are on **Service**, **SurgeryPackage**, **DoctorScheduleTemplate**, **BranchRoom**, etc., not on Branch. They remain correct and unchanged.

**Conclusion:** Only appointment create validates Branch.status; after the fix and backfill, that check correctly allows ACTIVE branches and blocks non-ACTIVE ones.

---

## 7. Admin UI labels vs backend operational state

**Current state (no change to business rules).**

- **Admin verification branches list** (`VerificationListPage.tsx`):
  - For branches, table row status is `row.verificationStatus || "UNSUBMITTED"` (profile verification status).
  - Backend now also returns `branch.status` and `branch.verificationStatus` in listBranchKycs (branch-level operational state).
- **Interpretation:**
  - "Verified" in the list = BranchProfileDetails.verificationStatus = VERIFIED. With the fix, approve also sets Branch to ACTIVE + VERIFIED, so "Verified" and "operational" are aligned.
  - The UI does not currently show "Operational: Active" or Branch.status; it only shows verification status. That is consistent and not misleading after the fix.
- **Optional improvement (not required):** The list could show both, e.g. "Verified" and "Active", using `row.branch?.status` and `row.branch?.verificationStatus` from the API. No change was made to avoid altering UI behavior; the API is ready if you want to expose operational status later.

**No remaining mismatch:** Admin "Verified" corresponds to profile VERIFIED and, after fix/backfill, to Branch ACTIVE + VERIFIED.

---

## Summary

| Task | Result |
|------|--------|
| 1. approveBranchKyc sets ACTIVE + VERIFIED | Yes, confirmed in code |
| 2. reject/suspend use valid BranchStatus | Yes (DRAFT, BLOCKED) |
| 3. Dry-run backfill | 2 branches (2 and 5) would be updated |
| 4. Branch 5 after backfill | ACTIVE + VERIFIED (by script logic) |
| 5. Appointment create for branch 5 | "Branch is not active" removed after backfill; code path verified |
| 6. Other clinic flows and Branch.status | Only appointment create checks Branch.status; others unchanged and correct |
| 7. Admin UI vs backend | No mismatch; optional to show operational status later |

**Recommended next step:** Run the backfill once (without `DRY_RUN`) so branches 2 and 5 become ACTIVE + VERIFIED, then re-test appointment creation at `/staff/branch/5/clinic/appointments/new`.
