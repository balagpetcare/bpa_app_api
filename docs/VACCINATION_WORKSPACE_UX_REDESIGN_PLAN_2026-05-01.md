# Vaccination Workspace UX Redesign Plan

## 1. Goal

Redesign the staff branch Vaccination module into a two-step clinical workflow:

- A branch Vaccination Home/Search page where staff can review branch-level vaccination status and find the correct patient.
- A dedicated Patient Vaccination Workspace page where staff complete patient-specific vaccination, deworming, billing-linked administration, reminder review, correction, void, and audit actions.

This keeps the existing vaccination route available while giving clinical actions a focused patient context.

## 2. Current Problem

The current vaccination page is confusing because it combines too many jobs in one long screen:

- branch dashboard
- patient search
- reminder list
- pet vaccination card
- stock-backed vaccination administration
- optional service-based billing
- manual vaccination records
- deworming records
- correction, void, and audit workflows

The start point is unclear. Search result selection currently changes a section lower on the same page, but it does not clearly move staff into a focused patient workflow. Stock, deworming, billing, reminder, correction, void, and audit panels are stacked together, which makes the page feel operationally dense and increases the risk of staff acting on the wrong patient context.

## 3. Recommended Routes

Landing/search page:

`D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\vaccinations\page.jsx`

New patient workspace page:

`D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\patients\[patientId]\vaccination\page.jsx`

URLs:

- `/staff/branch/[branchId]/clinic/vaccinations`
- `/staff/branch/[branchId]/clinic/patients/[patientId]/vaccination`

Optional redirect/query behavior:

- `/staff/branch/[branchId]/clinic/vaccinations?petId=123` or `?patientId=123` should redirect or link-load `/staff/branch/[branchId]/clinic/patients/123/vaccination` if safe.
- The Patient Profile Vaccines tab should link to the new workspace.

## 4. Landing Page Design

The landing page should include:

- clean Larkon-style page header
- centered search hero card
- search by pet name, owner, phone, email, unique pet ID, or numeric ID
- search results as premium cards
- clear result action button: “Open vaccination workspace”
- KPI cards:
  - today due
  - upcoming
  - overdue
  - given today
  - recent records
  - low stock
- compact reminder summary / due-overdue list
- compact recent vaccination records
- compact low stock vaccine item alert
- no vaccination or deworming forms

The landing page is a branch-level overview and patient finder only.

## 5. Patient Vaccination Workspace Design

The patient workspace should include:

- back to vaccination search
- back to patient profile
- patient summary header card
- owner summary
- branch context
- vaccination status badge
- next due / overdue summary cards
- tabs:
  1. Vaccination
  2. Deworming
  3. Reminders
  4. Billing
  5. Audit

Vaccination tab:

- vaccination history
- next due
- certificate tokens
- stock-backed Administer & Deduct Stock form
- optional service-based billing checkbox
- manual/no-stock vaccination form in a clearly separated “Legacy/manual” panel

Deworming tab:

- deworming history
- add deworming form

Reminders tab:

- pending/overdue/all reminder list
- no send button yet

Billing tab:

- show linked order/invoice info if available
- show billing CREATED/SKIPPED/FAILED status messages where available
- no billing cancellation/refund automation

Audit tab:

- correction/void/audit panel
- warning summary
- no stock reversal button yet

## 6. Component Strategy

Keep the change additive and conservative:

- Move the patient-specific clinical workflow into the new route.
- Keep reusable local helper functions in page files for now where that avoids a broad refactor.
- Extract only small helper functions when they reduce duplication or keep the file readable.
- Avoid overengineering or introducing a new module structure during this UX pass.
- Avoid making the landing page another giant file; it should only own branch dashboard, search, reminders, recent records, and low-stock alert display.

## 7. API Strategy

Reuse existing API helpers in `D:\BPA_Data\bpa_web\lib\api.ts`:

- patient search/list/get
- vaccination dashboard
- vaccine types
- stock candidates
- administer vaccination
- billing options
- manual create vaccination
- deworming list/create
- reminders
- correction/void/audit

Add or adjust helpers only if needed for route-level patient auto-load. The current helpers already support patient lookup by `Pet.id`, vaccination lists, next due, deworming, pet-specific reminders, stock candidates, billing options, and audit actions, so no backend/API contract change is planned.

## 8. UX Rules

- Landing page is for finding a patient and seeing branch-level vaccination overview only.
- Patient workspace is for clinical actions.
- Do not show administer, deworming, correction, void, or audit forms until a patient workspace is opened.
- Search result click should navigate to the patient workspace.
- Patient Profile Vaccines tab should include “Open vaccination workspace”.
- Keep responsive desktop layout.
- Follow Larkon card style: white cards, subtle shadows, compact headers, badges, clear action buttons, and two-column layouts where useful.

## 9. Risks

- Moving working form logic can break the existing stock-backed administer flow.
- Patient id vs pet id confusion can route staff to the wrong page if search payloads expose multiple ids.
- Branch visibility checks may fail if a pet is not branch-visible.
- Route param mismatch can break workspace auto-load.
- Duplicate API calls can make the new workspace feel slow.
- The existing page is large, so splitting it must avoid accidental behavioral changes.

## 10. Acceptance Criteria

- Landing page no longer contains administer/deworming forms.
- Landing page search result click opens the workspace.
- Workspace loads selected patient by route param.
- Stock-backed vaccination still works.
- Manual vaccination still works.
- Deworming still works.
- Reminders still visible.
- Correction/void/audit still works.
- Patient Profile Vaccines tab links to workspace.
- Targeted lint passes for changed frontend files.

## 11. Final Implementation Summary Template

Final response should report:

- changed files
- planning file path
- new route
- moved UI sections
- patient profile bridge
- preserved workflows
- validation results
- known limitations
