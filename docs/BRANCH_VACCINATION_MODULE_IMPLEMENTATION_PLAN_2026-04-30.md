# Branch Vaccination Module Implementation Plan

## 1. Goal

Create a dedicated branch-level Vaccination module inside the staff clinic branch panel. The module should let a branch team open one branch-scoped page, review vaccination due/overdue status, search/select a patient pet, view the pet vaccination card data that already exists, and add basic vaccination/deworming records using the current backend model.

This pass is intentionally additive and low risk. It does not attempt the full V2 pet vaccination card schema or deep integration with inventory, billing, reminders, QR, PDF, or customer portal workflows.

## 2. Current Reusable System

Reusable backend pieces:

- `prisma/schema.prisma` has `VaccineType`, `Vaccination`, and `DewormingRecord`.
- `src/api/v1/modules/clinic/vaccination.service.ts` can list pet vaccinations, list next due records, create vaccination records, look up certificate tokens, list deworming records, and create deworming records.
- `src/api/v1/modules/clinic/clinic.controller.ts` exposes vaccination/deworming handlers.
- `src/api/v1/modules/clinic/clinic.routes.ts` already has branch-prefixed vaccination/deworming routes.
- `src/api/v1/modules/clinic/patient.service.ts` already has branch patient search/list and branch-scope helpers.
- `src/api/v1/modules/clinic/clinicalItemStock.service.ts` already exposes low-stock alerts for clinic items.

Reusable frontend pieces:

- `D:\BPA_Data\bpa_web\lib\api.ts` already has staff clinic vaccination/deworming API helpers.
- `D:\BPA_Data\bpa_web\app\clinic\(larkon)\vaccinations\page.jsx` is a standalone manual-ID vaccination page.
- `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\patients\[patientId]\page.jsx` has a read-only `Vaccines` tab.
- `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\patients\page.jsx` shows branch-scoped patient list/search patterns.
- `D:\BPA_Data\bpa_web\src\lib\branchSidebarConfig.ts` controls the staff branch sidebar.

## 3. Implementation Scope For This Pass

Implement now:

- Add a staff branch route at `app/staff/(larkon)/branch/[branchId]/clinic/vaccinations/page.jsx`.
- Add a "Vaccination" entry to the staff branch Clinic sidebar.
- Reuse the current branch patient search/list API for patient/pet search.
- Add a numeric `Pet.id` fallback through the existing branch patient get API when search text is numeric.
- Add a branch-scoped vaccine type picker backed by a new read-only backend API.
- Add a low-risk read-only branch vaccination dashboard API for counts and recent records.
- Use existing pet vaccination list, next-due, create vaccination, deworming list, and create deworming APIs.
- Add branch-scope checks to vaccination/deworming read/create controller paths before reading or writing pet records.
- Improve create validation enough to return friendly errors for invalid patient, invalid vaccine type, and invalid date input.
- Display low-stock vaccine-like items by reusing the existing clinic low-stock alerts API and filtering by item names/codes.

## 4. Out Of Scope For This Pass

Do not implement now:

- New full V2 Prisma vaccination card models.
- Inventory batch deduction transaction.
- Clinic invoice, POS, order, or billing linkage.
- Public QR verification.
- PDF generation.
- Customer portal vaccination card.
- Reminder scheduler/job.
- Large migration or data backfill.
- Deep permission redesign or new role matrix migration.
- Refactoring the existing standalone clinic vaccination page.

## 5. Backend Plan

Files to inspect/change:

- `D:\BPA_Data\backend-api\src\api\v1\modules\clinic\vaccination.service.ts`
- `D:\BPA_Data\backend-api\src\api\v1\modules\clinic\clinic.controller.ts`
- `D:\BPA_Data\backend-api\src\api\v1\modules\clinic\clinic.routes.ts`
- `D:\BPA_Data\backend-api\docs\BRANCH_VACCINATION_MODULE_IMPLEMENTATION_PLAN_2026-04-30.md`

Backend changes:

- Add `listVaccineTypes({ search, limit })` to `vaccination.service.ts`.
- Add `getBranchVaccinationDashboard(branchId)` to `vaccination.service.ts`.
- Add `listVaccineTypes` controller handler.
- Add `getBranchVaccinationDashboard` controller handler.
- In vaccination/deworming controller handlers, resolve `branchId` from `req.clinicBranchId` or route params and verify the pet is in branch scope through `patientService.resolvePatientForBranch`.
- Keep existing response shapes for existing APIs.
- Add route `GET /api/v1/clinic/branches/:branchId/vaccine-types`.
- Add route `GET /api/v1/clinic/branches/:branchId/vaccinations/dashboard`.

## 6. Frontend Plan

Files to inspect/change:

- `D:\BPA_Data\bpa_web\lib\api.ts`
- `D:\BPA_Data\bpa_web\src\lib\branchSidebarConfig.ts`
- `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\vaccinations\page.jsx`

Frontend changes:

- Add API client helpers for branch vaccination dashboard and vaccine type list.
- Reuse existing helpers for patients, patient get, vaccination list, next due, vaccination create, deworming list/create, and low-stock alerts.
- Build the branch vaccination page as a client page using route `branchId`.
- Use existing branch context, permission, card, and page workspace conventions where practical.

## 7. Sidebar/Menu Plan

Add one menu item to the existing Clinic group in:

- `D:\BPA_Data\bpa_web\src\lib\branchSidebarConfig.ts`

Menu item:

- Key: `clinic-vaccinations`
- Label: `Vaccination`
- Icon: `ri:syringe-line`
- Href: `/staff/branch/:branchId/clinic/vaccinations`
- Permissions: reuse broad clinic read permissions such as `clinic.patients.read`, `clinic.emr.read`, with `clinic.emr.write` as an alternate permission.

The entry will be additive and will not duplicate the standalone `/clinic/vaccinations` page.

## 8. Branch Safety Plan

- The new staff page will read `branchId` from the route params only.
- No manual Branch ID input will be shown.
- All API calls will use `clinicBase(branchId)` through existing API helpers.
- Existing vaccination/deworming backend routes will check that the selected `petId` is visible in the current branch through existing patient branch-scope rules.
- Legacy vaccination rows do not have `branchId`; they will be displayed as legacy records for branch-visible pets only.

## 9. UI Layout Plan

Page sections:

- Header: branch header, back-to-clinic link, title "Vaccination".
- Dashboard cards: today due vaccines, upcoming vaccines, overdue vaccines, vaccines administered today, recent record count, low stock vaccine-like item count.
- Recent vaccination records: small branch-level recent records table from the read-only dashboard endpoint.
- Patient search: search box for pet name, unique pet ID, owner name/email/phone; numeric `Pet.id` fallback if branch patient list does not return a match.
- Pet vaccination card view: selected pet basic info, owner info, legacy-data label, vaccination history, next due records, deworming history, and certificate tokens when available.
- Add vaccination record form: vaccine type select, administered date, next due date, batch number, manufacturer, notes.
- Optional deworming form: medication name, dosage, weight, next due date, notes.
- Low stock vaccine items: show vaccine-like low-stock alerts if returned by existing stock APIs.

## 10. Risks

- Existing `Vaccination` records do not store `branchId`, so branch dashboard counts are inferred from pets visible to the branch.
- Existing `Vaccination` records do not store staff/doctor administered-by IDs.
- Existing `VaccineType` is global and has no org/branch active status.
- Existing patient search supports pet name, unique pet ID, owner profile/auth fields, and phone/email; numeric internal pet ID requires a fallback API call.
- Low-stock vaccine items are inferred by filtering existing low-stock item names/codes because there is no vaccine-specific stock candidate endpoint yet.
- Reminder, billing, inventory deduction, QR/PDF, and customer portal flows remain future work.

## 11. Acceptance Criteria

- Planning file exists at this path.
- Staff branch sidebar shows one new `Vaccination` item under Clinic.
- New route works at `/staff/branch/[branchId]/clinic/vaccinations`.
- Page never asks for manual Branch ID.
- Page loads dashboard cards and handles empty/error states.
- Page can search/select branch-visible pet patients.
- Page shows pet info, owner info, vaccination history, next due records, deworming history, and certificate token labels when present.
- Page uses a vaccine type picker instead of forcing numeric `vaccineTypeId` typing.
- Page can add a vaccination record for the selected pet and refresh history afterward.
- Page can optionally add deworming records and refresh deworming history afterward.
- Existing standalone clinic vaccination page remains unchanged.
- Existing staff patient profile Vaccines tab remains compatible.
- Existing POS, inventory, billing, prescription, appointment, and patient routes are not changed except for additive vaccination/read-only helpers.

## 12. Future Phases

- Phase 2: proper vaccination card schema with card, record status, correction/void, branch, owner, doctor/staff, and legacy migration/read adapters.
- Phase 3: inventory and batch deduction through clinical stock ledger, including branch vaccine stock candidate API.
- Phase 4: billing/invoice/POS link from vaccination administration to clinic invoice/order.
- Phase 5: reminder engine with persisted reminders, notification delivery, overdue dashboard, and duplicate prevention.
- Phase 6: customer portal vaccination card plus public QR verification and PDF certificate/card.
- Phase 7: audit logs and permissions hardening for view, create, correct, void, print, verify, and vaccine master management.
