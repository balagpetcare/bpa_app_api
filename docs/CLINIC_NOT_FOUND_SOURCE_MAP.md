# Clinic "Not Found" Errors — Source Map and Fixes

## Purpose

Trace the **exact** sources of visible "Appointment not found" and "Patient not found" (or 404) in the running app, and document fixes.

---

## 1. "Appointment not found"

### 1.1 Hardcoded in UI (intake page only)

| Field | Value |
|-------|--------|
| **Exact file** | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/intake/[appointmentId]/page.jsx` |
| **Line** | 423 |
| **Component** | Intake page (default export) |
| **Route** | `/staff/branch/:branchId/clinic/intake/:appointmentId` |
| **Surface** | Full page (not modal/drawer) |
| **Primary entity** | Appointment (route param `appointmentId`) |
| **Condition** | `error` is set when appointment fetch fails (e.g. API 404). Rendered as `{error \|\| "Appointment not found."}` |

So the **only** place that renders the literal string "Appointment not found." in the codebase is the intake page when the appointment load fails.

### 1.2 Shown in Assign Doctor / Collect Payment modals (API message)

| Field | Value |
|-------|--------|
| **Exact file** | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx` |
| **Components** | `AssignDoctorModal` (title: "Assign doctor — appointment #N"), `PayNowModal` (title: "Collect payment — #N") |
| **Route** | Appointments list page: `/staff/branch/:branchId/clinic/appointments` |
| **Surface** | Modal (opened from row actions) |
| **Primary entity** | Appointment (from list row; passed as prop) |
| **Condition** | Modal calls API (`staffClinicAppointmentAssignDoctor` / `staffClinicAppointmentCollectPayment`). Backend returns 404 with body message **"Appointment not found"** (or "Appointment or pet not found"). Modal displays `e?.message` in an alert: `{error && <div className="alert alert-danger">…{error}</div>}`. So the **visible** "Appointment not found" in these modals is the **API error message**, not a hardcoded string in the modal. |

**Backend sources of that message:**  
`backend-api/src/api/v1/modules/clinic/clinic.controller.ts` (404 handlers), `appointmentGuards.ts` (`AppointmentNotFoundError("Appointment not found")`), `intake.service.ts` (`throw new Error("Appointment not found")`).

### 1.3 Fix applied (Assign / Collect payment modals)

- **Problem type:** Component-level (modal displays API error message).
- **Change:** When the modal’s `error` contains "Appointment not found" (or "Appointment or pet not found"), the modal now shows a **friendly recovery message** and a **"Refresh list"** button instead of the raw API text.
- **Files changed:**  
  `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx`
  - `AssignDoctorModal`: added `onRefreshList` prop; when `isAppointmentNotFound`, show: *"This appointment could not be found (it may have been removed or is not available in this branch). Close and refresh the list to see current data."* + "Refresh list" button.
  - `PayNowModal`: same pattern.
  - Parent passes `onRefreshList={loadAppointments}` to both modals.

Intake page already shows "Appointment not found." only when the appointment **fetch** fails; no change there.

---

## 2. "Patient not found" / patient 404

### 2.1 Page-level "Patient not found" (in-page copy)

| File | Component / page | Route | Condition |
|------|------------------|--------|-----------|
| `bpa_web/app/staff/.../clinic/patients/[petId]/page.jsx` | Staff patient detail page | `/staff/branch/:branchId/clinic/patients/:petId` | Renders `{error \|\| "Patient not found."}` when patient fetch fails (e.g. API 404). |
| `bpa_web/app/staff/.../clinic/patients/[petId]/edit/page.jsx` | Staff patient edit page | `.../patients/:petId/edit` | Sets `setError("Patient not found.")` on fetch failure. |
| `bpa_web/app/clinic/(larkon)/patients/[petId]/page.jsx` | Clinic (larkon) patient page | `/clinic/patients/:petId` | Renders `{error \|\| "Patient not found."}` on fetch failure. |

So "Patient not found." is **page-level** text when the **API** returns failure for that patient (e.g. 404 or not in branch).

### 2.2 Next.js route 404 vs page-level

- **Next.js route 404:** Browser shows Next.js 404 page (e.g. "404 \| This page could not be found"). Means no matching `app/...` route for the URL (e.g. wrong path, basePath, or route group).
- **Page-level "Patient not found":** The patient route **matches** and the page renders; the page then fetches patient by `petId` and shows "Patient not found." when the API fails.

To tell them apart: note the URL and whether you see the app layout (sidebar, branch header) and the **exact** text "Patient not found." (page-level) vs a generic Next.js 404 (route-level).

### 2.3 Links to patient pages

- Staff: `patients/${petId}` or `patients/${p.id}` under branch clinic (e.g. `.../clinic/patients/123`). No mismatch found in code; if 404 persists, check middleware, basePath, and that the app is using the `(larkon)` route group as expected.

---

## 3. Other surfaces

- **AppointmentDetailDrawer** (`src/components/clinic/AppointmentDetailDrawer.jsx`): When appointment is null (e.g. fetch failed), it shows **"No data"**, not "Appointment not found."
- No other components in `app` or `src` render the string "Appointment not found" or "Patient not found" in the UI.

---

## 4. Summary: problem type by source

| Visible error | Source | Type | Fix |
|---------------|--------|------|-----|
| "Appointment not found" on **intake** page | Intake page, line 423 | Component-level (appointment fetch failed) | Already correct: only on appointment fetch failure. |
| "Appointment not found" in **Assign doctor** modal | Appointments page – AssignDoctorModal displays API `e?.message` | Component-level (API 404 message) | Friendly message + "Refresh list" in modal. |
| "Appointment not found" in **Collect payment** modal | Appointments page – PayNowModal displays API `e?.message` | Component-level (API 404 message) | Friendly message + "Refresh list" in modal. |
| "Patient not found" on patient URLs | Staff/clinic patient detail or edit pages | Page-level (API failure for petId) | No code change; distinguish route 404 vs API failure per above. |

---

## 5. Exact files changed (this pass)

1. **`bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx`**
   - `AssignDoctorModal`: added `onRefreshList`; when error is "Appointment not found" (or similar), show recovery message and "Refresh list" button.
   - `PayNowModal`: same.
   - Parent: pass `onRefreshList={loadAppointments}` to both modals.

---

## 6. Test steps (to confirm remaining live errors are gone)

1. **Assign doctor modal**
   - Go to Staff → Branch → Clinic → Appointments.
   - For an appointment that can 404 (e.g. wrong branch or deleted), trigger Assign doctor.
   - If API returns "Appointment not found", you should see the **friendly message** and "Refresh list" button, not only the raw "Appointment not found" text. Click "Refresh list" and confirm the list reloads.

2. **Collect payment modal**
   - Same page; open Collect payment for an appointment that may 404.
   - Same expectation: friendly message + "Refresh list" when API returns "Appointment not found".

3. **Intake page**
   - Open `/staff/branch/:branchId/clinic/intake/:appointmentId` for a non-existent or invalid appointment.
   - You should see "Appointment not found." only when the **appointment** fetch fails (not for intake-only failure).

4. **Patient 404**
   - If you see a generic Next.js 404 on a patient URL: check URL matches `.../clinic/patients/:petId` (or edit), basePath, and middleware.
   - If you see the app layout and "Patient not found.": that’s the patient page; the API returned failure for that `petId` (e.g. not in branch or deleted).
