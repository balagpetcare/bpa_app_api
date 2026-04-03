# BPA Clinic Appointment-to-Treatment — Final Production Hardening

## Scope

End-to-end workflow: **Appointments → Assign Doctor → Collect Payment → Intake → Link/Register Patient → Check-in / Visit → Treatment → Billing / Prescription / Print / Follow-up**

This document records the final audit, fixes, source map, and test checklist after the production-hardening pass.

---

## PHASE 1 — SOURCE MAP (workflow screens and components)

| Screen / component | Route / location | Primary entity | Params (route / query) | APIs | Primary vs secondary | UX standard |
|-------------------|------------------|----------------|-------------------------|------|----------------------|-------------|
| Staff appointments list | `/staff/branch/[branchId]/clinic/appointments` | List (appointments) | branchId | list, search, check-in, cancel, no-show, reschedule, assign, collect, slip | List load = primary; row actions = feedback | List error banner; modals use friendly recovery |
| AssignDoctorModal | (in appointments page) | Appointment (from row) | — | staffClinicAppointmentAssignDoctor | Stale = friendly + Refresh list | ✅ |
| PayNowModal | (in appointments page) | Appointment (from row) | — | staffClinicAppointmentCollectPayment | Stale = friendly + Refresh list | ✅ |
| SlipPrintModal | (in appointments page) | Slip by appointmentId | — | staffClinicAppointmentSlip / PaymentSlip | Fetch fail = friendly + Retry | ✅ |
| AppointmentDetailDrawer | (in appointments page) | Appointment (fetched by id) | — | staffClinicAppointmentGet | Null = "Appointment could not be loaded." | ✅ |
| RescheduleModal | (in appointments page) | Appointment (from row) | — | staffClinicAppointmentReschedule | Action error = raw message (secondary) | OK |
| CompleteIntakeModal | (in appointments page) | Appointment (from row) | — | promote, register, link | Owner/pet friendly overrides | ✅ |
| Staff intake page | `/staff/branch/[branchId]/clinic/intake/[appointmentId]` | Appointment | appointmentId (route primary); query: returnTo, registered, ownerId, petId | get appointment, get/upsert intake, promote | Appointment primary; intake secondary | ✅ Retry + Back; patient-missing = link/register |
| Clinic (larkon) intake | `/clinic/intake/[appointmentId]` | — | appointmentId, ?branchId | (redirect only) | Redirect to staff intake | OK |
| Staff visit page | `/staff/branch/[branchId]/clinic/visits/[visitId]` | Visit | visitId | get visit, prescriptions, billing | Visit primary; prescriptions/billing secondary | ✅ Retry + Back; secondary error comment |
| Clinic (larkon) visit | `/clinic/visits/[visitId]?branchId=` | Visit | visitId, branchId (query) | get visit, payment status, templates, vitals, notes, etc. | Visit primary | ✅ Retry + Back (fixed this pass) |
| Doctor visit page | `/doctor/visits/[id]` | Visit | id | doctorGetVisit | Visit primary | ✅ Retry + Back |
| Staff patient detail | `/staff/branch/[branchId]/clinic/patients/[petId]` | Patient (pet) | petId | staffClinicPatientGet | Patient primary | ✅ Retry + Back |
| Staff patient edit | `/staff/branch/[branchId]/clinic/patients/[petId]/edit` | Patient (pet) | petId | get, update | Patient primary | ✅ Retry + Back |
| Clinic (larkon) patient | `/clinic/patients/[petId]?branchId=` | Patient (pet) | petId, branchId (query) | staffClinicPatientGet | Patient primary | ✅ Retry + Back (fixed this pass) |
| Staff register patient | `/staff/branch/[branchId]/clinic/patients/register` | — | returnTo, appointmentId, phone, displayName, petName | create owner, register pet, promote | Form; returnTo to intake | OK |
| Prescription print | `/staff/branch/[branchId]/clinic/prescriptions/[prescriptionId]/print` | Prescription | prescriptionId | staffClinicPrescriptionGet | Prescription primary | ✅ Retry + Back (fixed this pass) |
| Doctor appointment detail | `/doctor/appointments/[id]` | Appointment | id | doctorGetAppointmentDetail | Appointment primary | ✅ Retry + Back (fixed this pass) |

---

## PHASE 2 — ROOT CAUSES FOUND IN THIS PASS

1. **Clinic (larkon) visit page**  
   - Missing `paymentStatus` state (setPaymentStatus was used but state not declared) → would throw at runtime.  
   - Primary not-found: raw "Failed to load visit" / "Visit not found." with no Retry.  
   - **Fix:** Added `useState` for `paymentStatus`, `useCallback` for `loadVisit`, `PRIMARY_NOT_FOUND.visit` on catch, Retry + Back in not-found block.

2. **Prescription print page**  
   - Primary not-found showed raw API message or "Prescription not found." with no Retry.  
   - **Fix:** Use `PRIMARY_NOT_FOUND.prescription` on catch, add Retry + Back and BranchHeader in not-found block.

3. **Doctor appointment [id] page**  
   - Fetch failure showed raw `e?.message` and Back only (no Retry).  
   - **Fix:** Use `PRIMARY_NOT_FOUND.appointment` on catch, add Retry + Back in error block.

4. **Clinic (larkon) patient [petId] page**  
   - Primary not-found had no Retry and used raw/fallback copy.  
   - **Fix:** `loadPatient` with `PRIMARY_NOT_FOUND.patient` on catch, Retry + Back in not-found block.

---

## PHASE 3 — FILES CHANGED (this pass)

| File | Change |
|------|--------|
| `bpa_web/app/clinic/(larkon)/visits/[visitId]/page.jsx` | Added `paymentStatus` state; `loadVisit` as `useCallback`; `PRIMARY_NOT_FOUND.visit` on catch; not-found block: Retry + Back. |
| `bpa_web/app/staff/.../clinic/prescriptions/[prescriptionId]/print/page.tsx` | Import `PRIMARY_NOT_FOUND`; load catch sets `PRIMARY_NOT_FOUND.prescription`; not-found block: BranchHeader + Retry + Back. |
| `bpa_web/app/doctor/(larkon)/appointments/[id]/page.tsx` | Import `PRIMARY_NOT_FOUND`; load catch sets `PRIMARY_NOT_FOUND.appointment`; error block: Retry + Back. |
| `bpa_web/app/clinic/(larkon)/patients/[petId]/page.jsx` | Import `PRIMARY_NOT_FOUND`; `loadPatient` useCallback with catch → `PRIMARY_NOT_FOUND.patient`; not-found block: Retry + Back. |

---

## ROUTES / HREFS / HELPERS

- **Helpers:** All primary not-found flows use `lib/clinicNotFoundHelpers.js`: `PRIMARY_NOT_FOUND` (appointment, visit, patient, prescription) and optional `isAppointmentNotFoundMessage` for modals.
- **Routes:** No route or href changes in this pass. Existing links (intake, register returnTo, patients, visits, prescription print) already use correct path shapes.
- **Register redirect:** `returnTo` + `registered=1&ownerId=&petId=&appointmentId=` → staff intake; when no returnTo, redirect to `patients/${patient.id}` (pet id) — correct.

---

## WHAT IS FULLY STANDARDIZED

- **Primary entity missing (appointment, visit, patient, prescription):** Standard copy from `PRIMARY_NOT_FOUND` (or equivalent), **Retry** and **Back/List** on every detail page in this workflow (staff + clinic larkon + doctor where applicable).
- **Stale modal target (Assign Doctor, Collect Payment):** Friendly recovery message + "Refresh list" (no raw backend "Appointment not found" as main UX).
- **Slip modal:** Friendly "Slip could not be loaded..." + Retry.
- **Drawer:** "Appointment could not be loaded." when appointment null.
- **Intake:** Appointment primary; intake secondary with scoped "Retry intake"; patient-missing = "Owner & pet not linked" + Link/Register (no generic not-found).
- **Visit (staff + clinic larkon):** Visit primary; secondary failures (e.g. prescription) keep visit visible with in-page error only.

---

## WHAT REMAINS INTENTIONALLY RAW (AND WHY)

- **List load failures** (appointments, patients): Page-level error banner with `e?.message` or fallback; no Retry in this pass (could be added later). Acceptable for list-primary screens.
- **Row action errors** (check-in, cancel, no-show, reschedule, search, export): Shown as page error or toast; actionable message (e.g. snapshot-only check-in) already overridden where needed.
- **Form submit errors** (intake save, patient update, register, create invoice): Raw or fallback message for validation/API failure; form context makes this acceptable.
- **Secondary action errors on visit** (add prescription, finalize, complete visit): In-page alert with `e?.message`; visit stays visible. Kept as-is for clarity of which action failed.
- **Doctor panel** other than visit/detail: Appointments list and appointment detail now standardized; other doctor screens unchanged.

---

## PHASE 4 — END-TO-END TEST CHECKLIST

Use this to verify the workflow is production-safe.

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Appointment exists → Assign doctor | Assign works; success closes modal and refreshes list. |
| 2 | Appointment stale/deleted → Assign doctor | Friendly recovery message + "Refresh list"; no raw "Appointment not found" only. |
| 3 | Appointment exists → Collect payment | Payment works; success closes modal and refreshes list. |
| 4 | Appointment stale/deleted → Collect payment | Same as #2. |
| 5 | Appointment exists → Intake | Intake loads; appointment visible; intake form usable. |
| 6 | Intake secondary (intake data) failure | Appointment still visible; scoped "Intake data could not be loaded" + "Retry intake". |
| 7 | Intake with no linked patient | "Owner & pet not linked" + Link/Register actions; no "Appointment not found." |
| 8 | Register/select/link from intake → return | returnTo to same intake URL with registered=1&ownerId=&petId=&appointmentId=; intake stays. |
| 9 | Check-in from list/queue | Check-in succeeds or shows snapshot-only message; list refreshes. |
| 10 | Invalid visitId (staff or clinic visit) | "Visit not found." + Retry + Back to Visits. |
| 11 | Visit page secondary failure (e.g. prescription) | Visit remains visible; in-page error for the action only. |
| 12 | Patient detail/edit valid ID | Loads; Retry + Back on failure. |
| 13 | Valid patient route + API 404 | Page-level "Patient not found." + Retry + Back (not framework 404). |
| 14 | Wrong/made-up route | Next.js 404 (framework). |
| 15 | Print slip / prescription failure | Friendly recovery (slip: "Slip could not be loaded" + Retry; prescription: "Prescription not found." + Retry + Back). |
| 16 | Wrong branch / no permission | AccessDenied or branch not found; message accurate. |
| 17 | Modal open then list refresh | Modal stays open with same row data; if user then triggers action on stale entity, friendly recovery. |

---

## REMAINING LOW-PRIORITY FOLLOW-UPS

- **Appointments list load failure:** Add a "Retry" button next to the error banner.
- **Patients list load failure:** Same.
- **Doctor appointments list:** Already has error display; optional Retry for consistency.
- **Clinic (larkon) visit:** Payment status state was missing and is now added; no other known bugs in that page.

---

## DELIVERABLES SUMMARY

1. **Still missing before this pass:** Clinic visit paymentStatus state; Retry + standardized copy on clinic visit, prescription print, doctor appointment detail, clinic patient detail.
2. **Root causes:** See Phase 2.
3. **Files changed:** See Phase 3 (4 files).
4. **Routes/hrefs/helpers:** No route changes; helpers already in place and reused.
5. **Standardized:** All primary not-found and stale-modal flows in the appointment-to-treatment workflow.
6. **Intentionally raw:** List/row/form/secondary action errors as documented.
7. **Final test checklist:** Phase 4 table (17 scenarios).
8. **Low-priority follow-ups:** Retry on list load failures; optional doctor list Retry.
