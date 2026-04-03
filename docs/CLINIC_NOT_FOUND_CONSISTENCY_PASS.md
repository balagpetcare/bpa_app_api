# Clinic Not-Found Consistency and Hardening Pass

## Summary

Final consistency pass for not-found and error handling across the **appointment → treatment** workflow. Standardizes primary vs secondary fetch rules, adds Retry and friendly copy, and documents UX rules for future pages.

---

## 1. Remaining raw backend error surfaces (audit)

Surfaces that still show **raw** `e?.message` (or similar) in the clinic workflow. These are acceptable where the failure is **secondary** (action failed but primary entity is visible) or **operational** (e.g. list load, search). Primary-entity failures are now standardized.

| Location | Surface | Type | Raw message? | Note |
|----------|---------|------|--------------|------|
| **Staff appointments page** | List load failure | Page banner | `e?.message \|\| "Failed to load appointments"` | OK: list is primary for this page; could add Retry. |
| **Staff appointments page** | Row actions (check-in, cancel, no-show, reschedule, search, export) | Toast or page error | `e?.message` + fallback | OK: action feedback; some already have friendly overrides (e.g. snapshot-only). |
| **Staff appointments page** | CompleteIntakeModal (promote/owner mismatch/duplicate) | Modal alert | Friendly overrides + `e?.message` fallback | OK: already has specific copy for owner/pet cases. |
| **Staff appointments page** | RescheduleModal | Modal | `e?.message` | OK: secondary action. |
| **Staff visit page** | Prescription create/update/finalize, complete visit | In-page alert | `e?.message` | OK: **secondary** (visit stays visible); comment added. |
| **Staff intake page** | Link owner, save notes | Alert | `e?.message` | OK: primary is appointment; these are actions. |
| **Staff intake page** | Intake data load failure | Scoped warning + Retry | `intakeLoadError` (raw) in warning text | OK: **secondary**; "Retry intake" already. |
| **Staff patient list** | Load failure | Alert | `e?.message` | OK: list primary; could add Retry in future. |
| **Staff patient edit** | Update failed | In-form alert | `err?.message` | OK: form submit feedback. |
| **Staff register page** | Owner create / registration | Form error | `e?.message` | OK: form feedback. |
| **Staff billing page** | Visit lookup / create invoice | Alert or toast | `e?.message` | OK: lookup/form. |
| **Staff prescription print** | Load failure | Alert | `(e as Error)?.message` + "Prescription not found." | Primary for that page; could use PRIMARY_NOT_FOUND.prescription + Retry in future. |
| **Clinic (larkon) visit page** | Load / actions | Alert | `(e && e.message)` | Different app surface; same pattern could be applied. |
| **Clinic (larkon) patient [petId]** | Load failure | Page | `e?.message \|\| "Failed to load patient"` | Could use PRIMARY_NOT_FOUND.patient + Retry. |
| **Doctor visit page** | Secondary (history, billing, actions) | Various | `e?.message` in toasts/catch | OK: primary is visit; already fixed primary not-found. |
| **Doctor appointments page** | List/action errors | Alert | `e?.message` | OK. |

**Conclusion:** Primary-entity not-found (appointment, visit, patient) is now standardized. Remaining raw messages are either **secondary** (page stays visible, scoped error + optional Retry) or **action feedback** (form submit, row action). No change required for those unless we want to add Retry everywhere.

---

## 2. Exact files changed (this pass)

| File | Changes |
|------|--------|
| **bpa_web/lib/clinicNotFoundHelpers.js** | **New.** Constants `PRIMARY_NOT_FOUND`, helpers `isAppointmentNotFoundMessage`, `isVisitNotFoundMessage`, `isPatientNotFoundMessage`, and JSDoc rules for primary vs secondary fetch. |
| **bpa_web/app/staff/.../clinic/visits/[visitId]/page.jsx** | Primary failure: use `PRIMARY_NOT_FOUND.visit`, add `loadVisit` callback and **Retry** + Back to Visits. Secondary error comment. |
| **bpa_web/app/staff/.../clinic/intake/[appointmentId]/page.jsx** | Use `PRIMARY_NOT_FOUND.appointment` on appointment fetch failure; add **Retry** + Back to Appointments when `!appointment`. |
| **bpa_web/app/staff/.../clinic/patients/[petId]/page.jsx** | Use `PRIMARY_NOT_FOUND.patient`, extract `loadPatient` with cancel ref; add **Retry** + Back to list. |
| **bpa_web/app/staff/.../clinic/patients/[petId]/edit/page.jsx** | Use `PRIMARY_NOT_FOUND.patient` on load failure; add `loadPatient` and **Retry** + Back to list when `error && !patient`. |
| **bpa_web/src/components/clinic/AppointmentDetailDrawer.jsx** | Copy when `!a`: "No data" → **"Appointment could not be loaded."** |
| **bpa_web/app/staff/.../clinic/appointments/page.jsx** | **SlipPrintModal:** On fetch failure show friendly "Slip could not be loaded..." + **Retry** (retryKey to re-run effect); no raw `e?.message`. |
| **bpa_web/app/doctor/(larkon)/visits/[id]/page.tsx** | Primary failure: use `PRIMARY_NOT_FOUND.visit`, add **Retry** button calling `loadVisit()`. |

---

## 3. What was standardized

- **Primary entity missing:** All appointment, visit, and patient **detail** pages now:
  - Show a **consistent** not-found message (from `PRIMARY_NOT_FOUND` or equivalent).
  - Offer **Retry** and **Back** (or "Back to list") so the user can recover without guessing the URL.
- **Stale modal target (Assign Doctor / Collect Payment):** Already done earlier: friendly message + "Refresh list" when API returns "Appointment not found."
- **Slip modal:** Replaced raw error with friendly copy + Retry.
- **Drawer:** "No data" → "Appointment could not be loaded."
- **Secondary failures:** Visit page documents that in-page error is secondary (visit remains visible). Intake already had scoped intake error + "Retry intake."
- **Patient missing in appointment workflow (intake):** Already clear: "Owner & pet not linked" with Link/Register actions; no generic not-found.

---

## 4. Final UX rules

Use these for any new or updated clinic workflow screen:

| Scenario | Rule |
|----------|------|
| **Appointment missing** | Show "Appointment not found." (or "Appointment could not be loaded." in drawer). Offer **Retry** and **Back to Appointments**. Do not show raw API message as main copy. |
| **Visit missing** | Show "Visit not found." Offer **Retry** and **Back to Visits**. |
| **Patient missing** | Show "Patient not found." Offer **Retry** and **Back to list**. |
| **Secondary data failure** | Keep **primary entity** visible. Show scoped error (e.g. alert-warning for intake load failure). Offer **Retry** for that data only. Do not clear or replace the primary entity. |
| **Stale modal target** | When an action (e.g. Assign doctor, Collect payment) fails because the entity was removed or unavailable: show a **friendly recovery** message and **Refresh list** (or Retry). Do not show only raw "Appointment not found." |
| **Patient missing from appointment (intake)** | Show **"Owner & pet not linked"** with actions: Link owner & pet (Complete intake), Register owner & pet. Do not show generic "Patient not found." or "Appointment not found." for this case. |
| **Route 404 vs page/API not found** | **Route 404:** Next.js no matching page (generic 404). **Page-level not found:** Our page rendered; API returned 404; we show "X not found." + Retry/Back. Use layout and exact copy to tell them apart. |

**Primary vs secondary fetch (from `clinicNotFoundHelpers.js`):**

- **Primary entity** = the thing the URL and page are for (e.g. appointment for `/intake/[appointmentId]`, visit for `/visits/[visitId]`, patient for `/patients/[petId]`). If its fetch fails → true not-found state + Retry + Back.
- **Secondary** = data that depends on the primary (e.g. intake data for an appointment, prescriptions for a visit). If secondary fetch fails → keep page, show scoped error + Retry for that data only.

---

## 5. Test checklist (appointment → treatment flow)

Use this to confirm not-found and recovery behavior end-to-end.

1. **Appointments list**
   - Open staff clinic appointments. If list fails to load, you see an error banner (raw message still possible); optional: add Retry later.
   - **Assign doctor:** Open for a valid appointment; assign → success. For an appointment that returns 404 (e.g. deleted), you see **friendly message** + "Refresh list."
   - **Collect payment:** Same as Assign doctor for 404 case.
   - **Slip (print):** Open slip for an appointment; if slip fetch fails, you see **"Slip could not be loaded..."** + **Retry** (no raw message).
   - **Drawer:** Click a row to open detail drawer; if appointment fetch fails, drawer shows **"Appointment could not be loaded."** (not "No data").

2. **Intake**
   - Open intake with **invalid** `appointmentId`. You see **"Appointment not found."** + **Retry** + Back to Appointments.
   - Open intake with **valid** appointment but **no patient linked**. You see **"Owner & pet not linked"** and Link/Register actions (no "Appointment not found.").
   - With valid appointment, if **intake data** fails to load: **scoped warning** + "Retry intake"; appointment and page stay visible.

3. **Visit (staff)**
   - Open visit with **invalid** `visitId` or ID that 404s. You see **"Visit not found."** + **Retry** + Back to Visits.
   - With **valid** visit, if prescription create/update/complete fails: **in-page alert** with message; visit and rest of page stay visible.

4. **Visit (doctor)**
   - Open doctor visit with invalid id. You see **"Visit not found."** + **Retry** + Back to appointments.

5. **Patient (staff)**
   - Open patient detail with **invalid** `petId` or 404. You see **"Patient not found."** + **Retry** + Back to list.
   - Open patient **edit** with invalid/404. Same: **"Patient not found."** + **Retry** + Back to list.

6. **Route vs page 404**
   - Hit a **non-existent** clinic route (e.g. typo in URL). You get **Next.js 404** (no app layout or "X not found." copy).
   - Hit a **valid** patient URL that API returns 404 for. You get **app layout** + **"Patient not found."** + Retry/Back (page-level).

---

## 6. Helper usage (future pages)

- Import: `import { PRIMARY_NOT_FOUND, isAppointmentNotFoundMessage } from "@/lib/clinicNotFoundHelpers";`
- On **primary** fetch failure: `setError(PRIMARY_NOT_FOUND.appointment)` (or `.visit`, `.patient`, `.prescription`). Show message + Retry + Back.
- In **modals** that call APIs which may return "Appointment not found": use `isAppointmentNotFoundMessage(error)` to show the friendly recovery block + "Refresh list" instead of raw `error`.
