# Doctor Module Audit and Implementation Plan

**Date:** 2026-03-14  
**Scope:** Doctor panel (frontend `bpa_web` app/doctor, backend `/api/v1/doctor/*` and clinic EMR/prescription/billing).  
**Target workflow:** Appointment → Open Visit → Review History → Examination → Diagnosis → Tests → Prescription → Treatment Plan → Billing + Token → Injection → Follow-up → Visit Complete.

---

## A. DOCTOR MODULE COMPLETION SUMMARY

| Stage | Status | Notes |
|-------|--------|--------|
| Appointment | PARTIAL | List, filter, stats, detail exist. No "today's queue" as single source; dashboard has queue widget. |
| Open Visit | **MISSING** | No "Open Visit" from appointment. Visit created only when staff starts queue (startService). Start-consult does not create visit; addNote/createFollowUp fail if no visit. |
| Review History | PARTIAL | getPatientHistory returns visits, notes, prescriptions, vaccinations, allergies, labRequisitions. Timeline UI shows only date, treatmentCode, followUpNotes—no diagnosis/prescription summary. |
| Examination | PARTIAL | Vitals displayed (from intake + visit.vitals). No doctor API to add vitals. SOAP is single free-text "Add Note"; no structured S/O/A/P form on doctor UI. |
| Diagnosis | PARTIAL | Narrative only (SOAP assessment in contentJson). No structured diagnosis entity or tags. Reporting readiness low. |
| Tests | BACKEND-ONLY | LabRequisition exists; clinic can create. No doctor API to create lab requisition; no test panel UI or "doctor reviewed" in doctor flow. |
| Prescription | BACKEND-ONLY | Create/finalize under clinic (staff) routes only. Doctor has listPrescriptions only. No doctor UI to create/edit/finalize from visit. |
| Treatment Plan | PARTIAL | TreatmentCourse exists; no doctor UI for in-clinic vs take-home separation or injection/procedure plan from doctor panel. |
| Billing + Token | MISSING | Doctor getVisit does not include prescriptions, orders, or injectionTokens. No billing-summary or token-status API for doctor. No UI. |
| Injection | MISSING | Doctor cannot see token status or dose administered from panel. |
| Follow-up | PARTIAL | createFollowUp exists (appointment-scoped); works only if visit exists. FollowUpComposer on appointment detail. No follow-up from visit page. |
| Visit Complete | PARTIAL | completeAppointment sets appointment COMPLETED; no visit status update to COMPLETED, no validation, no "Complete Visit" on visit page. |

---

## B. CURRENT WORKING FEATURES

- **Doctor dashboard:** KPI cards, today schedule, live queue, active patient, quick actions (links), follow-up/surgery/prescription draft widgets, earnings, reminders, notifications, branch switcher, socket refresh.
- **Appointments list:** Filter (date, branch, status, priority, type, search), stats tabs (all/waiting/upcoming/in_consult/completed/emergency/package/pending), table + cards, pagination, call / start consult / complete from list.
- **Appointment detail:** Patient snapshot (owner, pet, weight, age, chief complaint), clinical alerts (allergies, health disorders, emergency, repeat), visit timeline (previous visits + vaccinations), quick actions (call, start consult, complete, confirm, reschedule, cancel), add note (single text → SOAP note with contentJson.note), follow-up composer (date, notes, create appointment), activity events. All require appointment.visit for note/follow-up (visit created only when staff starts queue).
- **Visit detail (read-only):** Overview, doctor summary (intake, treatment code, previous visits), vitals table, clinical notes (SOAP display), lab requisitions list. No prescriptions, billing, tokens, complete, or edit actions. No link from appointment to this page.
- **Backend:** getAppointmentDetail (includes visit, prescriptions, notes, vitals, labRequisitions); getVisitById (vitals, notes, attachments, labRequisitions; **no** prescriptions or injectionTokens); getPatientHistory (visits with notes/prescriptions/vitals, pet allergies/vaccinations, labRequisitions); addNote (appointment → visit note); createFollowUp (visit.followUpDate/Notes + optional new appointment); listPrescriptions, listVisits, listFollowUps, listCases; consultation templates (list only).

---

## C. MISSING / WEAK AREAS

1. **Visit creation on start-consult** so doctor can work without staff starting queue first; link appointment to visit and return visitId.
2. **"Open Visit" entry point** from appointment detail → single visit workspace (e.g. `/doctor/visits/[visitId]`).
3. **Single Doctor Treatment Workspace** (tabbed: History, Vitals, SOAP, Tests, Prescription, Plan, Billing, Token, Follow-up, Complete) instead of split appointment vs visit pages.
4. **Doctor visit payload** extended with prescriptions, orders summary, injectionTokens for billing/token visibility.
5. **Doctor prescription create/finalize** (visit-scoped) and UI in workspace.
6. **Doctor lab requisition create** and test status / doctor-reviewed in workspace.
7. **Structured SOAP form** (S/O/A/P) and visit-scoped add note; optional vitals add by doctor.
8. **Billing summary API for doctor** (read-only) and **token status** in getVisit or separate endpoint.
9. **Visit complete** (visit status COMPLETED, completedAt) with optional validation and UI on visit page.
10. **Clinical templates** applied in SOAP (templates exist; not used in doctor SOAP form).
11. **Allergy/duplicate/overdose** checks on prescription (backend + UI).
12. **Timeline enrichment** with diagnosis/prescription summary per visit (data present in history; UI does not show it).

---

## D. UX / CLINICAL SAFETY GAPS

- **Allergy alerts:** Shown in ClinicalAlerts (pet.allergies) on appointment; not shown when adding prescription in doctor flow (no prescription UI).
- **Duplicate medicine warning:** Not implemented.
- **Overdose warning:** Not implemented.
- **Missing history summary:** Timeline does not show diagnosis or prescription summary per visit (only treatmentCode, followUpNotes).
- **Missing treatment templates:** ConsultationTemplate list exists; not applied in doctor SOAP or treatment plan.
- **Missing billing/token visibility:** Doctor cannot see if consultation/tests/meds/injection are billed or if token is generated.
- **Missing visit-complete validation:** No check for finalized prescription, follow-up set, or pending tasks before marking complete.
- **Add note / follow-up fail silently** when visit does not exist (start-consult does not create visit).

---

## E. FILES / MODULES INVOLVED

**Frontend (bpa_web):**
- `app/doctor/(larkon)/dashboard/page.tsx` — dashboard
- `app/doctor/(larkon)/appointments/page.tsx` — list
- `app/doctor/(larkon)/appointments/[id]/page.tsx` — appointment detail
- `app/doctor/(larkon)/visits/[id]/page.tsx` — visit detail (read-only)
- `app/doctor/(larkon)/appointments/_components/*` — PatientSnapshotCard, ClinicalAlerts, ClinicalHistoryTimeline, QuickActionBar, FollowUpComposer, etc.
- `lib/api.ts` — doctorGet*, doctorStartConsult, doctorAddNote, doctorCreateFollowUp, doctorGetVisit, etc.

**Backend (backend-api):**
- `src/api/v1/modules/doctor/doctor.routes.ts` — routes
- `src/api/v1/modules/doctor/doctor.controller.ts` — handlers
- `src/api/v1/modules/doctor/doctor.service.ts` — startConsultAppointment, getVisitById, getAppointmentById, addDoctorNote, createFollowUp, getPatientHistory
- `src/api/v1/modules/clinic/emr.service.ts` — createVisit, updateVisit, addVitalRecord
- `src/api/v1/modules/clinic/queue.service.ts` — startService (creates visit)
- `src/api/v1/modules/clinic/clinic.routes.ts` — visit/prescription/billing (staff)
- Prisma: Appointment, Visit, ClinicalNote, VitalRecord, Prescription, PrescriptionItem, LabRequisition, InjectionToken, etc.

---

## F. IMPLEMENTATION PLAN

### Phase 1 — Critical workflow blockers (safe, dependency-ready)

| Task | Files | Dependencies | Risk | Test |
|------|--------|--------------|------|------|
| 1.1 Create visit on start-consult when appointment has no visit | doctor.service.ts | emrService.createVisit | Low | Start consult → appointment.visit populated; addNote works |
| 1.2 Return visit (and visitId) from start-consult response | doctor.controller.ts, doctor.service.ts | 1.1 | Low | Response includes visit.id |
| 1.3 Add "Open Visit" on appointment detail when IN_CONSULT and visit exists; link to /doctor/visits/[visitId] | appointments/[id]/page.tsx | 1.1, 1.2 | Low | Button visible, navigates to visit |
| 1.4 After start-consult, refetch appointment and show Open Visit (or auto-redirect) | appointments/[id]/page.tsx | 1.2, 1.3 | Low | After Start Consult, Open Visit appears |
| 1.5 Extend getVisitById to include prescriptions and injectionTokens (workspace payload) | doctor.service.ts | None | Low | Visit API returns prescriptions, injectionTokens |
| 1.6 Visit page: add link back to appointment; show prescriptions section when data present | visits/[id]/page.tsx | 1.5 | Low | Visit page shows prescriptions; Back to Appointment when appointmentId present |

### Phase 2 — Core clinical usability

- Visit-scoped SOAP note API (POST /doctor/visits/:id/notes) with S/O/A/P.
- Structured SOAP form on visit page (or workspace).
- Doctor add vitals (reuse emr.addVitalRecord behind doctor route).
- Doctor create lab requisition (visit-scoped).
- Doctor prescription create/finalize (visit-scoped API + UI).
- Billing summary endpoint for doctor (read-only).
- Timeline: show diagnosis/prescription summary from history data.

### Phase 3 — Enterprise safety and reporting

- Allergy/duplicate/overdose checks on prescription.
- Visit complete (PATCH visit status COMPLETED) with validation.
- Diagnosis tags or structured diagnosis (optional model).
- Templates applied in SOAP.

### Phase 4 — Polish and analytics

- Single tabbed workspace (optional consolidation).
- Productivity analytics.
- Auditability and performance.

---

## G. PHASE 1 IMPLEMENTATION (COMPLETED)

### Files changed

| File | Change |
|------|--------|
| `backend-api/src/api/v1/modules/doctor/doctor.service.ts` | startConsultAppointment: after IN_CONSULT transition, if appointment has no visit, create one via emrService.createVisit; return getAppointmentById so response includes visit. getVisitById: include prescriptions (with items) and injectionTokens (id, tokenCode, status, expectedDose, unit, usedAt, createdAt). |
| `bpa_web/app/doctor/(larkon)/appointments/[id]/page.tsx` | "Open Visit" button when status === IN_CONSULT and a?.visit?.id; after start-consult, redirect to /doctor/visits/[visit.id] when response has visit.id. |
| `bpa_web/app/doctor/(larkon)/visits/[id]/page.tsx` | Back to "Appointment" when visit.appointmentId; prescriptions section; injection tokens section; empty state text updated. |
| `backend-api/docs/DOCTOR_MODULE_AUDIT_AND_PLAN.md` | This audit and plan. |

### Why each change

- **Create visit on start-consult:** addNote and createFollowUp require appointment.visit; visit was only created when staff started the queue. Creating the visit when the doctor starts the consult lets the doctor work without staff starting the ticket first. Idempotent: if a visit already exists (e.g. staff started service), we do not create a second one (Visit has unique appointmentId).
- **Return full appointment from start-consult:** Frontend needs visit.id to show "Open Visit" and to redirect; returning getAppointmentById gives the full appointment including visit.
- **Open Visit CTA + redirect:** Reduces page switching; doctor goes straight to the visit workspace after starting the consultation.
- **getVisitById includes prescriptions and injectionTokens:** Doctor can see prescriptions and token status on the visit page without new endpoints; enables billing/token visibility (read-only) for Phase 2.
- **Visit page: Back to Appointment, prescriptions, tokens:** Single workspace feel; doctor can return to appointment context and see prescriptions/tokens when present.

### Migrations

None. No schema changes.

### Manual testing steps

1. **Start consult creates visit and redirects**
   - Log in as doctor at http://localhost:3107/doctor/ (or your Next.js doctor app port).
   - Go to Appointments, open an appointment that is in CALLED (or first call the patient then start consult).
   - Click "Start Consultation". Expect: toast "Consultation started", then redirect to `/doctor/visits/[visitId]`.
   - Visit page should load with Overview, Summary (if intake/treatmentCode), and no errors.

2. **Open Visit button**
   - From Appointments list, open an appointment that is already IN_CONSULT (or start consult and use browser Back to stay on appointment detail).
   - Confirm "Open Visit" button is visible and links to `/doctor/visits/[visitId]`. Click it and confirm visit page loads.

3. **Visit page: Back to Appointment and data**
   - On a visit that was opened from an appointment, confirm "← Appointment" and "Appointments" links; "← Appointment" goes to `/doctor/appointments/[appointmentId]`.
   - If the visit has prescriptions (e.g. created by staff), confirm "Prescriptions" section shows status and items.
   - If the visit has injection tokens, confirm "Injection tokens" section shows token code, status, dose, usedAt.

4. **Add note and follow-up work after start-consult**
   - From appointment detail, start consultation (or open an appointment that already has a visit).
   - Add a note (text + Save Note). Expect success (no "visit not found" or null response).
   - Set follow-up date and submit. Expect success.
   - Open the visit page and confirm the note appears under Clinical notes.
