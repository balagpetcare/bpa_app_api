# Injection Tokens & Injection Room — Implementation Summary

**Date:** 2026-03-14.  
**Scope:** Enterprise-grade upgrade of staff medicine-control injection-tokens and injection-room pages.

---

## Changed files

### Backend (backend-api)

| File | Change |
|------|--------|
| `src/api/v1/modules/clinic/clinic.controller.ts` | Pass `treatmentCourseId`, `treatmentDayId`, `selectedVialSessionId` from request body to `injectionTokenService.generateToken`. |

### Frontend (bpa_web)

| File | Change |
|------|--------|
| `src/lib/displayFormatters.ts` | Added ENUM_LABELS for USED, INTERNAL, EXTERNAL, OUTSIDE (injection/medicine). |
| `src/types/clinicMedicineControl.ts` | **New.** Shared types: InjectionToken, TokenContext, VialSessionListItem, MedicationAdministration, RecordDosePayload, etc. |
| `lib/api.ts` | `staffClinicVialSessionsList` now accepts `variantId`, `take`, `skip` and returns `{ list, total }`; added `staffClinicDoseByVisit(branchId, visitId)`. |
| `app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/active-vials/page.jsx` | Use `staffClinicVialSessionsList` return shape `.list` for table data. |
| `app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-tokens/page.tsx` | **Full rewrite.** Page header, subtitle, stat cards, structured generate form (visit verify + variant dropdown from policies), filter toolbar (status, token code, date range), enterprise table with StatusBadge and View/Cancel, token detail drawer (context + link to visit), cancel confirmation modal, loading/empty/error states, permissions. |
| `app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-room/page.tsx` | **Full rewrite.** Guided 4-step workflow (validate → summary → source/vial → record), PageHeader/breadcrumbs, step badges, patient/medicine summary cards, vial session dropdown (active vials for variant), safety warnings for expired/used token, emergency bypass as controlled modal (reason + patient/variant/visit/dose/unit), dose history drawer (dose/visit API), permissions and confirmations. |

---

## Summary of what was completed

### 1. Injection Tokens page

- **Page header:** Title, subtitle, breadcrumbs, back link to Medicine Control.
- **Stat cards:** Pending count, Used count (from current list), Total.
- **Structured token generation:** Visit ID + “Verify” (loads visit and shows patient/pet); medicine variant from policies dropdown; expected dose, unit, expires (hours), medicine source; generate button.
- **Visit-based and prescription-aware:** Generate uses visitId (verified via visit get). Optional prescriptionId/orderId/treatmentCourseId/treatmentDayId/selectedVialSessionId are supported by backend and can be added to the form later.
- **Searchable selectors:** Variant from medicine policies list (dropdown). Visit is ID + verify (no visit search API in scope).
- **Filter/search toolbar:** Status, token code, from date, to date, Refresh.
- **Enterprise data table:** Token code, visit, variant, dose, status (StatusBadge), created, expires, actions (View, Cancel for PENDING).
- **Token details drawer:** Opened from View; shows status, visit + patient/pet from context, medicine, expected dose, treatment course/day, selected vial session, created/expires, link to visit.
- **Cancel:** Confirmation modal with “Keep” / “Cancel token” (no raw confirm).
- **Loading, empty, error:** LoadingState, EmptyState with icon/title/description/action, inline error alert.
- **Permissions:** Access gated by PERMS; generate/validate/cancel/View by permission.

### 2. Injection Room page

- **Guided multi-step workflow:** Step 1 validate token → Step 2 patient & medicine summary → Step 3 source/vial → Step 4 record dose. Step badges and Next/Back.
- **Step 1:** Token code input, Validate, optional “Emergency bypass (no token)”; validation error and success handling.
- **Step 2:** Summary cards (visit + patient/pet, medicine + expected dose, token status + treatment course); “View dose history for this visit”; Next to step 3.
- **Step 3:** Pre-selected vial from token context if present; dropdown of active vial sessions for variant (from vial-sessions with variantId); Next to step 4.
- **Step 4:** Prescribed dose, administered dose, unit, route, medicine source; Back, Record dose, Start over.
- **Safety warnings:** Alert when token is expired or status not PENDING (cannot use for recording).
- **Emergency bypass:** Modal with reason (required), patient ID, variant ID, visit ID (optional), dose, unit; “Record dose (bypass)”; permission-gated.
- **Dose history:** “View dose history for this visit” opens drawer with list from dose/visit API.
- **Permissions:** Access and bypass gated; dangerous action (bypass) requires reason and confirmation in modal.

### 3. Backend alignment

- **Controller:** Generate token accepts and forwards `treatmentCourseId`, `treatmentDayId`, `selectedVialSessionId`.
- **Vial sessions:** Already supported `variantId` and `{ list, total }`; frontend now uses them.
- **Dose by visit:** Frontend uses existing GET dose/visit/:visitId for history drawer.
- No breaking changes to existing medicine-control flows.

### 4. UI standard

- Reused PageHeader, StatCard, DetailDrawer, EmptyState, LoadingState, StatusBadge from dashboard.
- No raw JSON in UI; labels and humanizeEnum where applicable.
- Cards, badges, tables, drawers, modals, filter toolbar; dense but clear layout.

---

## Remaining gaps

1. **Injection Tokens**
   - **Prescription/order in generate form:** Backend supports prescriptionId, orderId; UI does not yet offer prescription or order selector (visit-based flow only).
   - **Treatment course / day / selected vial in generate:** Backend accepts them; UI could add selectors when treatment-course and vial APIs are wired (e.g. from visit).
   - **Token audit trail:** No dedicated token audit API; drawer shows token + context only. Full audit would require backend audit log by entity.
   - **Pagination:** List uses take=100; no “Load more” or server-side pagination UI.

2. **Injection Room**
   - **Queue / “today’s injections” tabs:** Backend does not expose a dedicated “injection room queue” or “today’s injections” list; dose history is per visit. A queue endpoint could be added later.
   - **Bypass audit field in backend:** Bypass reason is collected in the modal but not sent to the API (backend does not have a reason field on record dose). Consider adding an optional `emergencyBypassReason` to the record-dose payload and storing it in audit.
   - **Remaining ml check before submit:** No client-side check that administered dose ≤ vial remaining; backend already enforces.

3. **Shared**
   - **Visit search for token generation:** No typeahead/search for visits; staff enter visit ID and verify.
   - **Room enforcement:** Room is not shown or enforced in injection room flow.

---

## Test checklist

### Injection Tokens

- [ ] Load page with permission: list loads, stat cards show.
- [ ] Generate token: verify visit (valid/invalid), select variant, enter dose, submit; token appears in list and validate box.
- [ ] Validate token: valid code shows success and token details; invalid/expired shows error.
- [ ] Filters: status, token code, from/to date; list and total update.
- [ ] View token: drawer shows token, context, visit link.
- [ ] Cancel token: modal opens; confirm cancels and list updates; “Keep” closes.
- [ ] No permission: AccessDenied for user without any of the required permissions.
- [ ] Empty state: filters that return no tokens show EmptyState and Refresh.
- [ ] Error state: e.g. invalid branch or API error shows alert and toast.

### Injection Room

- [ ] Step 1: Validate valid token → step 2; invalid/expired token shows error and warning.
- [ ] Step 2: Summary cards show visit, patient/pet, medicine, token status; “View dose history” opens drawer.
- [ ] Step 3: Active vials for variant load; pre-selected vial shown when present; select vial and Next.
- [ ] Step 4: Enter administered dose and Record; success resets workflow.
- [ ] Emergency bypass: button opens modal; reason + patient/variant/dose required; Record dose (bypass) submits; permission required.
- [ ] Expired/used token: warning shown; user can still proceed to steps 2–4 but should not submit (backend will reject if token consumed).
- [ ] Dose history drawer: opens with list for visit or “No doses” when empty.
- [ ] Start over: resets to step 1 and clears token state.
- [ ] No permission: AccessDenied when user lacks medicine.dose.record (and relevant) permissions.

### Backend

- [ ] Generate token with treatmentCourseId/treatmentDayId/selectedVialSessionId (e.g. via API client) and confirm stored.
- [ ] List vial-sessions with variantId returns only that variant’s sessions.
- [ ] Record dose (normal and emergency bypass) still works for existing flows (dispense, treatment course, etc.).

---

**End of implementation summary.**
