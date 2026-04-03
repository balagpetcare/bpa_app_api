# BPA Clinic E2E Flow — Remediation Plan (Critical & High-Priority Gaps)

**Source of truth:** [CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md](./CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md)  
**Scope:** Close all critical and high-priority gaps so the clinic treatment workflow is fully operational.  
**Constraints:** No code or file changes in this document; plan only. Treat “Treatment Order” as TreatmentCourse + TreatmentDay. Preserve existing backend architecture; prefer wiring existing logic.

---

## Gap 1: Billing → Injection Token Handoff

### Objective
Wire treatment billing to injection token generation so that after “Create bill,” the UI can generate token(s) with the new `orderId` (and course/day/visit/patient context) without leaving the page or losing context.

### Backend files to modify
- **`backend-api/src/api/v1/modules/clinic/billing.service.ts`**  
  - No change required to `createTreatmentDayBill` (already returns full order with `id`).  
  - Optional: ensure `getTreatmentBillingSummary` returns `visitId`, `patientId`, `petId` for the course/current day so the frontend can pass them to token generate (verify dailyDueMedicine.getTodayDueMedicines / course includes these; add to summary if missing).
- **`backend-api/src/api/v1/modules/clinic/clinic.controller.ts`**  
  - No change required for `createTreatmentDayBill`; it already returns `r` (order) via `sendClinicSuccess(res, 201, r)`.

### Frontend files to modify
- **`bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/treatment-billing/page.tsx`**  
  - In `handleCreateBill`: capture the return value of `staffClinicTreatmentDayBillCreate` (the order object).  
  - Store `orderId`, and optionally `visitId` (from body or summary), in component state.  
  - After successful create, show a “Generate injection token(s)” section or modal that:  
    - Displays the created order id and (if available) course/currentDay/todayDueItems.  
    - For each due medicine (or single token per bill), call `staffClinicGenerateInjectionToken` with: `orderId`, `visitId`, `variantId`, `expectedDose`, `patientId`, `petId`, `treatmentCourseId`, `treatmentDayId` from summary/course.  
  - Use existing `staffClinicGenerateInjectionToken` and `staffClinicTreatmentBillingSummary`; ensure summary exposes `course.patientId`, `course.visitId` (or equivalent), `course.petId`, `currentDay.id` (treatmentDayId) for token payload.
- **`bpa_web/lib/api.ts`**  
  - No new API; ensure `staffClinicTreatmentDayBillCreate` return type is used (response includes `id`, `orderNumber`, etc.).  
  - Optional: add a small JSDoc that create-bill returns `{ id, ... }` for token generation.

### Prisma schema changes
- None.

### API routes involved
- **Existing (no change):**  
  - `POST /api/v1/clinic/branches/:branchId/treatment-billing/:courseId/create-bill` — already returns order.  
  - `POST /api/v1/clinic/branches/:branchId/medicine-control/injection-token` — already accepts `orderId`, `visitId`, `treatmentCourseId`, `treatmentDayId`, etc.

### Services/controllers involved
- **Existing:** `billing.service.createTreatmentDayBill`, `clinic.controller.createTreatmentDayBill`, `injectionToken.service.generateToken`, `clinic.controller.generateInjectionToken`.  
- **Optional backend:** If summary does not include visit/patient/pet for the course, extend `getTreatmentBillingSummary` or `dailyDueMedicine.getTodayDueMedicines` to include them (for UI to pass to generateToken).

### Permissions involved
- **Existing:** `clinic.billing.write` (create bill), `injection.token.generate` (generate token).  
- Staff performing “Create bill then Generate token” must have both.

### UI pages affected
- **Treatment Billing:** `app/staff/(larkon)/branch/[branchId]/clinic/treatment-billing/page.tsx` — add post-bill token generation (section or modal with one or more “Generate token” actions using orderId and summary context).

### Required state transitions
- **Order:** Created with `paymentStatus` (e.g. PENDING) → after payment completion, token generate requires `paymentStatus: COMPLETED`.  
- **Note:** createTreatmentDayBill creates order only; payment may be completed elsewhere. Token generation already enforces “paid order” (orderId or latest COMPLETED for visit). If treatment-day flow expects “create bill then pay then token,” ensure payment step is done before “Generate token” or document that user must complete payment first. No new state machine; wire existing transitions.

### Acceptance criteria
1. User creates treatment day bill from Treatment Billing page; response includes `orderId` (order.id).  
2. UI shows option to “Generate injection token(s)” after successful create, with order and course/day context.  
3. User can generate at least one token with `orderId` (and visitId, treatmentCourseId, treatmentDayId, variantId, expectedDose, patientId, petId) so that token is tied to the bill.  
4. If payment is not yet COMPLETED, token generate fails with existing backend error (“Order payment is not completed”); user can complete payment and retry.

### Possible regression risks
- Treatment billing page currently clears customerId/treatmentDayId on success; if we keep “Generate token” on same page, do not clear summary/courseId so user can generate tokens.  
- Multiple tokens (one per due medicine): ensure backend allows multiple tokens for same order/visit; no duplicate token check that would block.

---

## Gap 2: Dispense Request → Receive Step (UI + API)

### Objective
Expose the existing “receive dispense request” backend in the frontend so staff can mark an ISSUED/PARTIALLY_ISSUED dispense request as received (injection room or pharmacy handoff).

### Backend files to modify
- **None.**  
  - Route, controller, and service already exist: `POST .../dispense-request/:id/receive`, `receiveDispenseRequest` controller, `dispenseControl.service.receiveDispenseRequest`.

### Frontend files to modify
- **`bpa_web/lib/api.ts`**  
  - Add `staffClinicReceiveDispenseRequest(branchId: string, requestId: number): Promise<any>` that calls `apiPost` to `/api/v1/clinic/branches/${branchId}/medicine-control/dispense-request/${requestId}/receive` with empty body (or optional body if backend later accepts notes).  
  - Return the API response data (updated dispense request).
- **`bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/dispense-requests/page.jsx`**  
  - For each row where `r.status === 'ISSUED' || r.status === 'PARTIALLY_ISSUED'` and `!r.receivedAt` (or equivalent), show a “Receive” button.  
  - On click: call `staffClinicReceiveDispenseRequest(branchId, r.id)`; on success toast and refresh list (reload or update local state); on error show toast.  
  - Disable Receive if already received (`r.receivedAt` truthy) or status not ISSUED/PARTIALLY_ISSUED.

### Prisma schema changes
- None. `DispenseRequest.receivedByUserId` and `receivedAt` already exist.

### API routes involved
- **Existing:** `POST /api/v1/clinic/branches/:branchId/medicine-control/dispense-request/:id/receive` (no change).

### Services/controllers involved
- **Existing:** `dispenseControl.service.receiveDispenseRequest`, `clinic.controller.receiveDispenseRequest`.

### Permissions involved
- **Existing:** `medicine.vial.open` or `medicine.vial.use` (route uses requireClinicPermission("medicine.vial.open", "medicine.vial.use")).  
- Ensure staff who can “receive” (e.g. injection room) have one of these.

### UI pages affected
- **Dispense Requests:** `app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/dispense-requests/page.jsx` — add Receive button and wire to new API helper.

### Required state transitions
- **DispenseRequest:** ISSUED or PARTIALLY_ISSUED → (receive) → same status but `receivedAt` and `receivedByUserId` set. Backend already enforces “only ISSUED/PARTIALLY_ISSUED” and “not already received.”

### Acceptance criteria
1. On Dispense Requests page, for requests with status ISSUED or PARTIALLY_ISSUED and no receivedAt, a “Receive” button is visible.  
2. Clicking Receive calls the receive API; on success the list refreshes and the row shows received (or receivedAt); no second Receive for same request.  
3. Unauthorized users (no medicine.vial.open / medicine.vial.use) do not see or cannot successfully call receive.

### Possible regression risks
- Low: additive UI and one API wrapper; backend unchanged.  
- Ensure list response includes `receivedAt` and `receivedByUserId` (or equivalent) so UI can hide Receive when already received.

---

## Gap 3: Shift Handover UI

### Objective
Provide a staff UI to view the handover summary (active vials, pending tokens, expired vials in window) so shift handover can be performed from the app.

### Backend files to modify
- **None.**  
  - `GET .../medicine-control/handover-summary` and `eodHandover.service.getHandoverSummary` already exist.

### Frontend files to modify
- **`bpa_web/lib/api.ts`**  
  - Add `staffClinicHandoverSummary(branchId: string, params?: { expiredWithinHours?: number }): Promise<HandoverSummary>` that calls `apiGet` to `/api/v1/clinic/branches/${branchId}/medicine-control/handover-summary` with optional query `expiredWithinHours`.  
  - Define or document the response shape (activeVialSessions, pendingTokenCount, pendingTokens, expiredVialsInWindow).
- **New page:** `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/handover/page.tsx` (or `page.jsx`).  
  - Use `useParams` for branchId; use `useBranchContext` for access; require permission `medicine.reconciliation.read` or `medicine.vial.use` (per route).  
  - On load, call `staffClinicHandoverSummary(branchId, { expiredWithinHours: 24 })`.  
  - Display: active vial sessions (id, variant, remainingQty, validUntil); pending token count and list (tokenCode, variant, expectedDose); expired vials in window.  
  - Follow existing WowDash / branch layout: BranchHeader, back link to medicine-control, cards or tables for the three sections.  
  - Optional: refresh button and optional `expiredWithinHours` selector (e.g. 24 / 48).
- **`bpa_web/src/lib/branchSidebarConfig.ts`**  
  - Under Medicine Control group, add an item: e.g. `{ key: "medicine-handover", label: "Handover", icon: "ri:exchange-line", href: (id) => "/staff/branch/" + id + "/clinic/medicine-control/handover", requiredPerm: "medicine.reconciliation.read", anyPerms: ["medicine.vial.use"] }` so staff can open Handover from the sidebar.

### Prisma schema changes
- None.

### API routes involved
- **Existing:** `GET /api/v1/clinic/branches/:branchId/medicine-control/handover-summary`.

### Services/controllers involved
- **Existing:** `eodHandover.service.getHandoverSummary`, `clinic.controller.getHandoverSummary`.

### Permissions involved
- **Existing:** `medicine.reconciliation.read` or `medicine.vial.use` (route: requireClinicPermission("medicine.vial.use", "medicine.reconciliation.read")).

### UI pages affected
- **New:** Handover page under medicine-control.  
- **Sidebar:** Medicine Control group gains “Handover” link.

### Required state transitions
- None (read-only). Handover summary is a snapshot for human handoff.

### Acceptance criteria
1. Staff with permission can open “Handover” from Medicine Control (sidebar or dashboard link).  
2. Page loads and shows active vial sessions, pending tokens count and list, and expired vials in the chosen window.  
3. Data matches backend handover-summary response; refresh updates the snapshot.

### Possible regression risks
- Low: read-only; new page and one API wrapper.  
- Sidebar: ensure featureFlag for clinic and permission set are consistent with other medicine-control items.

---

## Gap 4: End-of-Day (EOD) Close UI

### Objective
Provide a staff UI to check EOD status (blockers) and perform EOD close so the day can be formally closed from the app.

### Backend files to modify
- **None for EOD status/close endpoints.**  
  - `GET .../medicine-control/eod-status` and `POST .../medicine-control/eod-close` already exist.  
  - Persisting day close is covered in Gap 5 (backend change there).

### Frontend files to modify
- **`bpa_web/lib/api.ts`**  
  - Add `staffClinicEodStatus(branchId: string, date?: string): Promise<EodStatus>` — `apiGet` to `/api/v1/clinic/branches/${branchId}/medicine-control/eod-status` with optional `date` query.  
  - Add `staffClinicEodClose(branchId: string, body?: { date?: string }): Promise<{ closed: boolean; date: string }>` — `apiPost` to `/api/v1/clinic/branches/${branchId}/medicine-control/eod-close` with optional body.
- **New page:** `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/eod-close/page.tsx` (or `page.jsx`).  
  - Use branchId from params; require `medicine.reconciliation.run` or `medicine.reconciliation.acknowledge` (per eod-close route).  
  - On load (and optional date picker change), call `staffClinicEodStatus(branchId, date)`.  
  - Display: date, canClose, blockers list, pendingTokenCount, activeVialSessionCount, reconciliationDone, reconciliationAcknowledged, reconciliationHasMismatch.  
  - Show “Close day” button only when `canClose === true`; on click call `staffClinicEodClose(branchId, { date })`; on success show success message and optionally refresh status or show “Day closed” state; on error show blockers or error message.  
  - When canClose is false, list blockers clearly and link to Reconciliation page if needed.
- **`bpa_web/src/lib/branchSidebarConfig.ts`**  
  - Add EOD Close to Medicine Control: e.g. `{ key: "medicine-eod-close", label: "EOD Close", icon: "ri:lock-line", href: (id) => "/staff/branch/" + id + "/clinic/medicine-control/eod-close", requiredPerm: "medicine.reconciliation.run", anyPerms: ["medicine.reconciliation.acknowledge"] }`.

### Prisma schema changes
- None for UI-only part. Persistence in Gap 5.

### API routes involved
- **Existing:** `GET .../medicine-control/eod-status`, `POST .../medicine-control/eod-close`.

### Services/controllers involved
- **Existing:** `eodHandover.service.getEodStatus`, `eodHandover.service` (eodClose uses getEodStatus in controller); `clinic.controller.eodClose`, `clinic.controller.getEodStatus`.

### Permissions involved
- **Existing:** `medicine.reconciliation.read` (eod-status), `medicine.reconciliation.run` or `medicine.reconciliation.acknowledge` (eod-close).

### UI pages affected
- **New:** EOD Close page under medicine-control.  
- **Sidebar:** Medicine Control group gains “EOD Close” link.

### Required state transitions
- **Business:** User can close day only when canClose is true (no pending tokens for day, no active vials opened that day, reconciliation run, mismatch acknowledged).  
  Backend already enforces this; UI only exposes the action.

### Acceptance criteria
1. Staff with permission can open “EOD Close” from Medicine Control.  
2. Page shows current (or selected) date, canClose, and list of blockers.  
3. “Close day” is enabled only when canClose is true; clicking it calls eod-close API and shows success or error.  
4. When day is closed (success), UI reflects that (e.g. “Day closed” message); after Gap 5, this can also reflect persisted record.

### Possible regression risks
- Low: UI and API wrappers only.  
- Ensure eod-close is not called twice for same date without user intent (button disable after success or explicit “re-open” if that is ever added).

---

## Gap 5: Persisting Day Close Records

### Objective
Persist a “day closed” record when EOD close succeeds so there is an audit trail and optional re-open prevention or reporting.

### Backend files to modify
- **`backend-api/prisma/schema.prisma`**  
  - Add model `MedicineControlDayClose` (or `ClinicDayClose`): e.g. `id`, `branchId`, `closeDate` (Date), `closedByUserId`, `closedAt` (DateTime), optional `note` or `blockersResolved` (Json).  
  - Unique on `(branchId, closeDate)` so one close per branch per date.  
  - Relations: Branch, User (closedBy).  
  - Add to Branch and User relations as needed.
- **`backend-api/prisma/migrations/`**  
  - New migration: create table `medicine_control_day_closes` (or chosen name).
- **`backend-api/src/api/v1/modules/clinic/eodHandover.service.ts`**  
  - Add function `recordDayClose(branchId: number, date: Date | string, closedByUserId: number, note?: string | null): Promise<DayCloseRecord>`.  
  - Upsert or create row in MedicineControlDayClose for (branchId, closeDate); set closedByUserId, closedAt (now), optional note.  
  - Return the created/updated record.
- **`backend-api/src/api/v1/modules/clinic/clinic.controller.ts`**  
  - In `eodClose`: after `getEodStatus` and when `status.canClose` is true, before `sendClinicSuccess`, call `eodHandoverService.recordDayClose(branchId, status.date, req.user.id, req.body?.note)`.  
  - On success, include in response e.g. `dayCloseId` or `dayClose` in the payload; on recordDayClose failure, either fail the request or still return 200 with closed: true and log the error (prefer failing so client knows close was not recorded).
- **`backend-api/src/api/v1/modules/clinic/eodHandover.service.ts`**  
  - Optional: add `getDayClose(branchId: number, date: string): Promise<DayClose | null>` for UI to show “Closed by X at Y” on EOD page.

### Frontend files to modify
- **`bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/eod-close/page.tsx`** (from Gap 4).  
  - If backend returns `dayClose` or `dayCloseId` in eod-close response, display “Closed by … at …” after successful close.  
  - Optional: add GET day-close-by-date API and show last close info for selected date.
- **`bpa_web/lib/api.ts`**  
  - No change required if response shape is extended with dayClose; optional: add `staffClinicDayCloseGet(branchId, date)` if a dedicated GET endpoint is added for “get close record for date.”

### Prisma schema changes
- **New model:** `MedicineControlDayClose` (or equivalent name) with fields above; unique `(branchId, closeDate)`; FKs to Branch and User.

### API routes involved
- **Existing:** `POST .../medicine-control/eod-close` — response extended to include `dayClose` or `dayCloseId` after persistence.  
- **Optional:** `GET .../medicine-control/day-close?date=YYYY-MM-DD` to return the close record for a date (for UI to show “already closed by …”).

### Services/controllers involved
- **New:** `eodHandover.service.recordDayClose` (and optionally `getDayClose`).  
- **Modified:** `clinic.controller.eodClose` — call recordDayClose when canClose.

### Permissions involved
- Same as eod-close: `medicine.reconciliation.run`, `medicine.reconciliation.acknowledge`.

### UI pages affected
- EOD Close page (from Gap 4) — show persisted close info when available.

### Required state transitions
- **New:** “Day not closed” → (eod-close with canClose) → “Day closed” with a DB row.  
- Optional: prevent double close (recordDayClose upsert or unique constraint; if row exists for (branchId, date), either return existing or fail).

### Acceptance criteria
1. When EOD close succeeds, a row exists in MedicineControlDayClose for that branch and date with closedByUserId and closedAt.  
2. Response of eod-close includes reference to the record (e.g. dayCloseId or dayClose).  
3. UI can show “Day closed by [user] at [time]” for that date (from response or optional GET).

### Possible regression risks
- Migration: ensure no conflict with existing tables; safe additive migration.  
- If recordDayClose fails (e.g. DB error), decide whether eodClose returns 500 or still 200; recommend 500 so operator retries and record is created.

---

## Gap 6: Prescription Create/Finalize UI from Visit Page

### Objective
**SUPERSEDED (prescription security hardening):** Staff must **not** author prescriptions from the visit page. Authoring is **doctor-only** (doctor panel + clinic routes with `ClinicStaffProfile.staffType === DOCTOR`). Staff visit UI stays **read + print**; dispense uses `medicine.dispense.issue` via pharmacy flows. See `docs/CLINIC_PRESCRIPTION_SECURITY_AUDIT_REPORT.md`.

### Backend files to modify
- **None** for staff Rx authoring (intentionally removed from product).

### Frontend files to modify
- **Doctor workspace:** `bpa_web/app/doctor/(larkon)/visits/[id]/page.tsx` — create / edit draft / finalize via `doctorCreateVisitPrescription`, `doctorUpdatePrescription`, `doctorFinalizePrescription`.
- **Staff visit:** remain list + print links only (`clinic.prescription.read`).

### Prisma schema changes
- None.

### API routes involved
- **Doctor:** `POST /api/v1/doctor/visits/:id/prescriptions`, `PATCH`/`POST finalize` on `/api/v1/doctor/prescriptions/:id`.
- **Clinic (vets):** `POST .../clinic/branches/:branchId/visits/:visitId/prescriptions` (+ vet middleware); dispense `POST .../dispense` with `medicine.dispense.issue`.

### Permissions involved
- **Authoring:** `clinic.prescription.create` | `.edit` | `.finalize` **plus** veterinarian middleware; `clinic.prescription.write` is **retired** from clinic routes (registry/seed label only). Vets receive keys via **CLINIC_DOCTOR** template overrides — run `npm run migrate:prescription-write-overrides` if old overrides used `write` only.
- **List/print:** `clinic.prescription.read`.
- **Dispense:** `medicine.dispense.issue` (not `clinic.prescription.write`).

### Required state transitions
- **Prescription:** DRAFT → FINALIZED → DISPENSED (unchanged).

### Acceptance criteria (superseded for Rx authoring)

Doctor-only authoring: **doctor visit workspace** satisfies create/edit/finalize; staff visit page remains read/print. Dispense remains pharmacy / `medicine.dispense.issue`. See `docs/CLINIC_PRESCRIPTION_WRITE_MIGRATION.md`.

### Possible regression risks

- Vets with **only** legacy `clinic.prescription.write` in `permissionOverrides` must run the migration script or receive `create`/`edit`/`finalize` before clinic API authoring works.

---

# Implementation Phases

## Phase 1 — Low-risk, no backend schema change
- **Gap 2:** Dispense Receive UI + API wrapper (frontend only; backend already exists).  
- **Gap 3:** Handover UI + API wrapper (frontend only).  
- **Gap 4:** EOD Close UI + API wrappers (frontend only).

**Deliverables:** Receive button on Dispense Requests; Handover page and sidebar link; EOD Close page and sidebar link.  
**Dependency order:** None between these; can be parallel.  
**Safe order:** 2 → 3 → 4 (or 3 → 4 → 2).

---

## Phase 2 — Billing → Token and Prescription UI
- **Gap 1:** Billing → Token handoff on Treatment Billing page (frontend-driven; optional backend tweak to summary if visit/patient not present).  
- **Gap 6:** Prescription create/finalize/dispense on Visit page (frontend only).

**Deliverables:** Post-bill “Generate token(s)” on treatment-billing; prescription create/finalize/dispense on visit detail.  
**Dependency order:** None between Gap 1 and Gap 6.  
**Safe order:** 6 first (simpler), then 1; or 1 first if treatment flow is higher priority.

---

## Phase 3 — Persist Day Close
- **Gap 5:** Day close persistence (Prisma model + migration, eodHandover.service.recordDayClose, controller eodClose update, optional GET day-close).

**Deliverables:** MedicineControlDayClose table; eod-close creates record; EOD Close page can show “Closed by … at …”.  
**Dependency order:** Depends on Gap 4 (EOD Close UI) being present so that “close” is actually invoked from UI.  
**Safe order:** After Phase 1 (Gap 4) is done; then add migration, service, controller, and small frontend display update.

---

# Dependency Order (Summary)

1. **No dependency:** Gap 2, 3, 4, 6 (and Gap 1 except optional summary tweak).  
2. **Gap 5** depends on **Gap 4** (EOD Close UI) so that close is triggered and persistence is exercised.  
3. **Gap 1** may optionally depend on **getTreatmentBillingSummary** exposing visitId/patientId/petId if not already (verify once; may already be on course).

---

# Safe Implementation Order

1. **Phase 1a:** Gap 2 (Receive) — API wrapper + Receive button.  
2. **Phase 1b:** Gap 3 (Handover) — API wrapper + Handover page + sidebar.  
3. **Phase 1c:** Gap 4 (EOD Close UI) — API wrappers + EOD Close page + sidebar.  
4. **Phase 2a:** Gap 6 (Prescription UI) — Visit page create/finalize/dispense.  
5. **Phase 2b:** Gap 1 (Billing → Token) — Capture order from create-bill; add “Generate token(s)” flow on treatment-billing.  
6. **Phase 3:** Gap 5 (Day close persistence) — Schema + migration, recordDayClose, controller update, EOD page display.

---

# Release Readiness Checklist

Before marking the clinic E2E remediation as release-ready:

- [ ] **Gap 1:** Treatment billing returns order; UI generates token(s) with orderId and context after create bill; payment-completion handling documented or enforced.  
- [ ] **Gap 2:** staffClinicReceiveDispenseRequest in api.ts; Receive button on Dispense Requests for ISSUED/PARTIALLY_ISSUED without receivedAt.  
- [ ] **Gap 3:** staffClinicHandoverSummary in api.ts; Handover page renders summary; sidebar link under Medicine Control.  
- [ ] **Gap 4:** staffClinicEodStatus and staffClinicEodClose in api.ts; EOD Close page shows status and blockers; Close day button when canClose; sidebar link.  
- [ ] **Gap 5:** MedicineControlDayClose (or equivalent) model and migration; recordDayClose called on eodClose success; EOD page shows closed-by/closed-at when available.  
- [ ] **Gap 6:** Visit page Prescriptions card has Create, Finalize, and (optional) Mark dispensed with create dispense request; api.ts has create/finalize/dispense helpers.  
- [ ] Permissions: All modified or new pages gated by existing permissions; no new permissions required (per plan).  
- [ ] Regression: Existing flows (dispense approve/issue, token generate from Injection Tokens page, reconciliation, visit view) still work.  
- [ ] Docs: Update CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md or a separate “Remediation completed” note with dates and references to this plan.
