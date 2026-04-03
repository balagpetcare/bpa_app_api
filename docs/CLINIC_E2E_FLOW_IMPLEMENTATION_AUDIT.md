# BPA Clinic End-to-End Flow — Implementation Audit Report

**Date:** 2026-03-14  
**Scope:** Backend (backend-api), Frontend (bpa_web), DB (Prisma), permissions, handoffs, controls, edge cases  
**Flow audited:** Doctor Prescribes → Treatment Order → Billing → Injection Token → Pharmacy Verify & Dispense → Injection Room Receives → Token Checked → Vial Selected/Activated → Dose Administered → mL Consumption Posted → Audit Log → EOD Reconciliation → Incident if Needed → Shift Handover / Day Close  

**Method:** Evidence-based trace of UI → API → service → DB → permission → audit; no assumptions.  

---

## 1. Executive Verdict

| Question | Answer |
|----------|--------|
| **Is this end-to-end flow operationally complete?** | **No.** Backend supports most steps; several handoffs are not enforced, and key UI/API links are missing or manual. |
| **Overall status** | **PARTIAL** |
| **Confidence level** | **High** (based on direct code and route inspection) |

**Summary:** The system has the entities, services, and routes for prescription → treatment course → billing → token → dispense → vial → dose → reconciliation → incident → handover. Critical gaps: (1) **“Treatment Order”** is implemented as **TreatmentCourse/TreatmentDay**, not a separate order entity; (2) **Billing → Token** is not wired in UI (treatment billing does not trigger or prompt token generation with `orderId`); (3) **Dispense Receive** has no frontend (no Receive button, no API wrapper in bpa_web); (4) **EOD close** does not persist a day-close record; (5) **Handover / Day close** have no dedicated UI (no handover-summary or eod-close pages). Enforcement is partial: token requires paid order at generate time, and dose requires token (or emergency bypass); other transitions are not strictly enforced by state machine.

---

## 2. Step-by-Step Flow Audit Table

| # | Flow Step | Current Status | Evidence Found | Missing Pieces | Risk Level | Recommended Fix |
|---|-----------|-----------------|----------------|----------------|------------|-----------------|
| 1 | **Doctor Prescribes** | **PARTIAL** | Prescription create/finalize via **doctor panel** and clinic API for **vets only** (`clinic.prescription.create`/`edit`/`finalize` + DOCTOR middleware). `clinic.prescription.write` **retired** from clinic authoring routes. Staff visit page **read/print**. | Optional: richer picker in doctor UI. | Medium | See `CLINIC_PRESCRIPTION_WRITE_MIGRATION.md` for deploy. |
| 2 | **Treatment Order Created** | **EXISTS BUT NOT CONNECTED** (interpreted as TreatmentCourse/TreatmentDay) | TreatmentCourse, TreatmentDay, TreatmentDayItem in schema; treatmentCourse.service (create, list, today-due); API routes for treatment-course and treatment-day. | No explicit “Treatment Order” entity; flow docs say “Treatment Order” — implemented as course/day. **No enforced link from Prescription to TreatmentCourse** (optional; course can be created independently). | Low | Document that “Treatment Order” = TreatmentCourse/TreatmentDay; optionally add prescriptionId/correlation if needed. |
| 3 | **Billing Completed** | **COMPLETE** (backend); **PARTIAL** (UI) | Visit billing: createInvoiceFromVisit, getBillingSummaryForVisit, getVisitOrders; treatment billing: createTreatmentDayBill, getTreatmentBillingSummary. Order with paymentStatus COMPLETED. Clinic billing and treatment-billing pages exist. | Treatment billing page does not return or display **orderId** after create bill; no automatic next step to generate token. | Medium | Return orderId from createTreatmentDayBill in API/UI; add “Generate injection token” (with orderId) on treatment billing or clear guidance to Injection Tokens page. |
| 4 | **Injection Token Generated** | **COMPLETE** (backend); **PARTIAL** (UI) | generateToken requires paid order (orderId or latest COMPLETED order for visit); token validity same-day configurable (branchPolicy); API POST .../injection-token; permission injection.token.generate. Injection Tokens page exists; staffClinicGenerateInjectionToken in api.ts. | **Billing → Token handoff not in UI:** user must leave treatment billing and generate token manually; orderId often not passed. | High | Wire token generation to post-billing (e.g. after create bill with orderId); or enforce orderId in generate flow when coming from billing. |
| 5 | **Pharmacy Verifies & Dispenses** | **COMPLETE** (backend); **PARTIAL** (UI) | DispenseRequest: create, approve, issue; dispenseControl.service (approveRequest, issueItems); list/get by branch; prescriptionId and transactionType supported. Dispense Requests page: list, Approve, Issue. | **Receive** not in UI (see step 6). No “Receive” button on dispense requests page; no API wrapper for receive in bpa_web. | Medium | Add Receive action to Dispense Requests page and staffClinicReceiveDispenseRequest in api.ts. |
| 6 | **Injection Room Receives** | **EXISTS BUT NOT CONNECTED** | receiveDispenseRequest in dispenseControl.service; route POST .../dispense-request/:id/receive; permission medicine.vial.open | medicine.vial.use. **No UI and no frontend API wrapper.** Dispense requests page does not show Receive for ISSUED/PARTIALLY_ISSUED. | High | Add receive API to bpa_web; add Receive button on dispense requests (and/or injection room) for issued requests. |
| 7 | **Token Checked** | **COMPLETE** | validateToken (branchId, tokenCode, validatedByUserId); expiry and status enforced; validatedAt/validatedByUserId set. Injection Room page: validate token by code, then proceed to dose. | — | Low | Optional: enforce room at validate (currently room is at dose/vial selection). |
| 8 | **Open Vial Selected / New Vial Activated** | **COMPLETE** | openVial, openVialSession; room type check (INJECTION_ROOM_TYPES); block duplicate open when existing vial has enough; VialSessionEvent OPENED/DOSE_USED; selectedVialSessionId on token. Injection Room: select vial session or open new. | Room mismatch only checked at **recordDose** (token’s selectedVialSession vs. session room). | Low | Consider validating room at token validate if token has selectedVialSession. |
| 9 | **Dose Administered** | **COMPLETE** | recordDose (controller) → doseConsumption.recordAdministration; token validation (getUsableTokenById), room mismatch, vial remaining; MedicationAdministration created; token consumed; TreatmentDayItem → ADMINISTERED. Injection Room page: record dose with token + vial. | — | Low | — |
| 10 | **mL Consumption Posted** | **COMPLETE** | openVial.recordDose: VialSession.remainingQty decremented, VialSessionEvent DOSE_USED; MedicationAdministration.administeredDose. Dispense issue uses ledger.saleFEFOInTx SALE_CLINIC (at issue time). | No separate “ClinicalStockLedger” entry for dose mL (vial session + event is the consumption record). | Low | Document that mL consumption = VialSessionEvent + MedicationAdministration; optional ClinicalStockLedger for dose if required. |
| 11 | **Audit Log Saved** | **PARTIAL** | MedicationAdministration, VialSessionEvent (OPENED, DOSE_USED), InjectionToken status/usedAt/usedBy; DailyReconciliation aggregates. **No single “flow” audit log table**; audit is implicit in these entities. | Dedicated audit log table or event stream for “flow steps” not present; reconciliation uses aggregates. | Medium | Either document audit as MA + VialSessionEvent + token state, or add a ClinicFlowAuditLog if regulatory need. |
| 12 | **EOD Reconciliation Runs** | **COMPLETE** | dailyReconciliation.autoReconcile (tokens, vials, administrations, mismatch); run + list + acknowledge APIs; reconciliation page (run, acknowledge). | — | Low | — |
| 13 | **Incident Raised if Needed** | **PARTIAL** | MedicineIncident; raiseIncident on reconciliation mismatch (REPEATED_VIAL_MISMATCH); exceptionOverride can raise incident. **Only reconciliation mismatch** auto-raises; other mismatch types not mapped to incident types. | Incidents for other scenarios (e.g. dose without token, wrong room) not auto-created; list/assign/resolve UI for incidents not verified in this audit. | Medium | Extend incident raising for other mismatch types; ensure incident list/assign/resolve UI exists. |
| 14 | **Shift Handover / Day Close** | **PARTIAL** | getHandoverSummary (active vials, pending tokens, expired vials); getEodStatus (blockers); eodClose validates blockers and returns { closed: true } but **does not persist a day-close record**. **No UI** for handover-summary or eod-close. | No DayClose or ShiftHandover DB entity; no handover or EOD close pages; no API wrappers in bpa_web for handover-summary, eod-status, eod-close. | High | Add handover and EOD close UI; optionally add DayClose/ShiftHandover record when eodClose succeeds. |

---

## 3. Gap List

### Critical Gaps
- **Billing → Token handoff:** Token generation is not triggered or guided from treatment billing UI; orderId often not passed when generating token (unbilled dose possible if user generates token without orderId on another page — backend blocks if no paid order for visit, but treatment-day flow relies on user passing orderId).
- **Dispense receive not in UI:** Injection room “receive” step exists in backend only; no Receive button or API in frontend — issued dispense can remain “not received” with no operational path to mark received.
- **EOD / Handover not in UI:** No pages or API wrappers for handover-summary, eod-status, eod-close — staff cannot run shift handover or day close from the app.

### High Priority Gaps
- **Prescription create/finalize from visit:** Visit detail shows prescriptions but does not offer create/finalize/dispense actions in the audited UI.
- **Day close not persisted:** eodClose only returns success; no stored “day closed” record for audit or re-open prevention.
- **Receive API missing in bpa_web:** staffClinicReceiveDispenseRequest (or equivalent) not in lib/api.ts.

### Medium Gaps
- **Audit trail:** No single flow audit log; reliance on MedicationAdministration + VialSessionEvent + token state.
- **Incident coverage:** Only reconciliation mismatch auto-raises incident; other failure modes not mapped to incidents.
- **Treatment billing response:** createTreatmentDayBill response not clearly exposing orderId for token generation in UI.

### UX/Operational Gaps
- **Cross-page flow:** User must move between Treatment Billing → Injection Tokens → Injection Room → Dispense Requests without in-app guidance.
- **Prescription → Dispense:** markDispensed can create DispenseRequest but no clear UI path from prescription to dispense request list (e.g. “Create dispense request” from prescription or visit).
- **Reconciliation/EOD in sidebar:** Reconciliation exists; Handover and EOD close not in sidebar or any visible flow.

---

## 4. Traceability Matrix

**Staff Clinic Visits (enterprise hub):** Canonical spec: `bpa_web/docs/CLINIC_VISITS_ENTERPRISE_MODULE_PLAN.md`. Implemented: extended `GET /visits` (filters, row signals: queue, settlement, billing), inclusive `YYYY-MM-DD` range on list/export/summary, whitelisted `status` query, `GET /visits/summary`, `GET /visits/:id/queue-events`, CSV export (escaped cells + formula-safe prefix), `POST /visits/:id/complete` via `completeVisitWithPolicy` (`DoctorAuditLog`, `changedByRole: STAFF`). **Read set** (list, detail, summary, export, eligibility, queue-events, **billing-summary, orders, payment-status**): any of `clinic.emr.read`, `clinic.emr.write`, `clinic.visits.read`, `clinic.visits.manage`. **Complete:** `clinic.emr.write` **or** `clinic.visits.manage`. **Blocked:** `PATCH` with `status: COMPLETED` or body `completedAt`; `POST /visits` with `status: COMPLETED`.

| UI Page | API Route | Backend Service | DB Model | Permission | Audit/Event | Connected Next Step |
|---------|-----------|-----------------|----------|------------|-------------|---------------------|
| Visit detail | GET visits/:id; GET visits/:id/prescriptions; GET billing-summary | getVisitById; listByVisit; getBillingSummaryForVisit | Visit, Prescription | Visit + billing-summary: visits read set. Prescriptions **list**: `clinic.prescription.read`. **Authoring:** doctor API or clinic POST/PATCH with `create`/`edit`/`finalize` (or deprecated `write` OR) **and** veterinarian middleware. | — | Billing (link); Rx list read-only on staff visit; author in doctor panel |
| Doctor / vet Rx | POST doctor/visits/:id/prescriptions; PATCH/POST finalize doctor/prescriptions/:id | doctor.service + prescription.service | Prescription | Doctor session (`getDoctorBranchMemberIds`) | — | Staff print / pharmacy dispense |
| Billing (visit) | GET/POST visits/:id/create-invoice | createInvoiceFromVisit | Order, OrderItem, PosInvoice | clinic.emr.write | — | Token (manual) |
| Treatment Billing | GET treatment-billing/:courseId/summary, POST create-bill | getTreatmentBillingSummary, createTreatmentDayBill | Order, TreatmentDay, TreatmentDayItem | clinic.billing.read/write | — | **Not connected:** Token generate (no orderId in UI) |
| Injection Tokens | POST injection-token, GET injection-tokens, PATCH cancel | injectionTokenService.generateToken, listTokens, cancelToken | InjectionToken | injection.token.generate, list, cancel | Token created/cancelled | Injection Room (validate by code) |
| Dispense Requests | GET dispense-requests, PATCH approve, PATCH issue | listRequests, approveRequest, issueItems | DispenseRequest, DispenseRequestItem | medicine.dispense.* | — | **Missing:** POST receive (no UI) |
| (Missing: Receive) | POST dispense-request/:id/receive | receiveDispenseRequest | DispenseRequest.receivedAt, receivedByUserId | medicine.vial.open | — | Injection room use |
| Injection Room | GET injection-token/validate, POST dose | validateToken, recordDose → doseConsumption.recordAdministration | InjectionToken, MedicationAdministration, VialSession, VialSessionEvent | injection.token.validate, medicine.dose.record | MA + VialSessionEvent | — |
| Active Vials / Open vial | GET vial-sessions, POST vial-session/open, POST dose, PATCH close | openVial, doseConsumption (via recordDose) | VialSession, VialSessionEvent | medicine.vial.* | VialSessionEvent | Dose |
| Reconciliation | POST reconciliation/run, GET list, PATCH acknowledge | autoReconcile, listReconciliations, acknowledgeMismatch | DailyReconciliation | medicine.reconciliation.* | DailyReconciliation row; MedicineIncident on mismatch | EOD / Incident |
| (No UI) | GET handover-summary, GET eod-status, POST eod-close | getHandoverSummary, getEodStatus; eodClose (validation only) | — (no DayClose row) | medicine.reconciliation.read, run, acknowledge | — | — |

---

## 5. Conflict Report

- **“Treatment Order” vs implementation:** Flow says “Treatment Order Created”; codebase uses **TreatmentCourse + TreatmentDay** as the order for scheduled treatment. No separate TreatmentOrder entity. **Interpretation:** Treatment order = treatment course/day; document and keep as-is unless product requires a distinct order type.
- **Order of operations:** Intended flow is Billing → Token. Backend enforces “paid order before token” at generate; UI does not enforce “create bill then generate token” (user can generate token from Injection Tokens page with any paid order for visit). **Conflict:** Operational flow can be “token generated without going through treatment billing page” (e.g. visit billing only); for treatment-day flow, passing orderId is recommended but not enforced in UI.
- **Dispense “receive”:** Workflows doc says “Injection Room Receives”; backend has receiveDispenseRequest but frontend has no way to call it. **Conflict:** Design expects receive; implementation is incomplete on the client.
- **EOD close:** Described as “Day Close”; backend eodClose only checks blockers and returns success — no persistent “day closed” state or record. **Conflict:** No audit trail or re-open control for day close.

---

## 6. Hidden Risks

- **Silent failure:** Dispense issued but never received — no reminder or escalation; reconciliation does not track “issued not received” explicitly.
- **Fraud / misuse:** Emergency bypass allows dose without token; permission injection.token.emergency_bypass required; reason stored. Risk: bypass overuse if not monitored.
- **Stock leakage:** Dispense issue deducts stock (SALE_CLINIC); dose records vial consumption. If receive is never called, stock is already deducted at issue — no double-count, but “received at room” is not recorded.
- **Reconciliation:** Unused tokens and no-token administrations are in mismatchDetails; incident only for REPEATED_VIAL_MISMATCH. Other mismatches (e.g. token/injection count) do not auto-create incident.
- **Cross-branch:** Visit and token are branch-scoped; inventory and billing at treatment branch per docs. No explicit check that “dose at branch A for token at branch B” is blocked (token is branch-scoped; dose uses branchId from request).
- **Manual bypass:** No “offline” or manual stock bypass is implemented; all flows go through API. Manual stock adjustment exists (item-stock/adjust) but is separate from injection flow.
- **Cross-day treatment:** Treatment day is date-bound; tokens can expire (same-day or configurable). Unfinished treatment (e.g. token expired) is visible as pending/expired; no automatic carry-over to next day.

---

## 7. Completion Score

| Metric | Score | Notes |
|--------|-------|--------|
| **Flow completion (steps implemented end-to-end)** | ~65% | 9/14 steps have backend + UI and clear handoff; 3 steps missing UI (receive, handover, EOD close); 2 steps partial (prescription UI, billing→token). |
| **Enforcement (transitions enforced by code)** | ~70% | Billing→token (paid order) and dose (token/variant/visit) enforced; prescription→dispense and dispense→receive not enforced; EOD close not persisted. |
| **Auditability** | ~60% | MedicationAdministration, VialSessionEvent, token state, DailyReconciliation; no single flow audit log; day close not recorded. |
| **Operational readiness** | ~55% | Core path (prescribe → bill → token → dispense → dose → reconcile) is usable with manual navigation; receive, handover, and EOD close not available in UI. |

---

## 8. Final Recommendation

- **Safe to use (with caveats):**  
  - Prescription create/finalize (via API).  
  - Treatment course/day and treatment billing (create bill).  
  - Injection token generate (with paid order / orderId).  
  - Dispense request create, approve, issue.  
  - Injection room: validate token, select/open vial, record dose.  
  - Reconciliation run and acknowledge.  
  Use with clear SOP: generate token after bill with orderId; document that “receive” is not in UI and track issued-but-not-received outside app if needed.

- **Unsafe to release as full E2E flow:**  
  - Relying on “Injection Room Receives” as a required step (no UI).  
  - Relying on shift handover or day close in the app (no UI).  
  - Assuming billing→token is foolproof (no in-app enforcement of orderId from treatment billing).

- **Must fix before production (for full flow):**  
  1. Add **Dispense Receive** in UI (button + API wrapper) and optionally in injection room.  
  2. Add **Handover** and **EOD close** UI (handover-summary, eod-status, eod-close) and consider persisting day close.  
  3. **Wire Billing → Token:** return orderId from createTreatmentDayBill and add “Generate token” (with orderId) on treatment billing or enforced flow.  
  4. **Prescription:** add create/finalize (and optionally dispense) from visit or dedicated page.  
  5. **Document** audit trail (MA + VialSessionEvent + token + reconciliation) and, if required, add flow audit log or day-close record.

---

## 9. Missing End-to-End Links (Plain Language)

1. **Doctor prescribes** → Backend and API exist; **visit page does not let staff create or finalize prescriptions**; prescription list is read-only.  
2. **Treatment order** → Implemented as **treatment course + treatment day**; no separate “order” entity; link from prescription to course is optional.  
3. **Billing completed** → Visit and treatment billing work; **after “create bill” on treatment billing, the app does not guide or pass the new order into token generation**; user must open Injection Tokens and generate token (and may omit orderId).  
4. **Injection token generated** → Backend requires a paid order; **treatment billing screen does not trigger or link to token generation with the new orderId**.  
5. **Pharmacy dispenses** → Approve and Issue exist and are in UI; **“Injection room receives” has an API but no button and no API call from the frontend** — receive step is missing in the app.  
6. **Token checked / Vial selected / Dose administered / mL posted** → Implemented and used from Injection Room page.  
7. **Audit log** → Consists of **MedicationAdministration**, **VialSessionEvent**, and token state; there is **no single “flow” audit table**; acceptable if documented.  
8. **EOD reconciliation** → Run and acknowledge exist in UI and backend; **incident** is raised only for one mismatch type (REPEATED_VIAL_MISMATCH).  
9. **Shift handover / Day close** → Backend returns handover summary and EOD status and allows eod close check; **no UI and no stored “day closed” record** — staff cannot perform handover or day close in the app.

**Overall:** The backbone of the flow (prescription, treatment course, billing, token, dispense, vial, dose, reconciliation) is in place, but **receive**, **handover**, and **EOD close** are not in the frontend, and **billing-to-token** and **prescription create/finalize** are not fully wired in the UI. Fixing these links and adding the missing UI will make the end-to-end flow complete and operable in production.

---

## 10. Related: Queue → Visit → Billing → Settlement (visits chain)

For the **queue / visit completion / settlement** slice (operational front-desk flow), see **[CLINIC_QUEUE_VISIT_BILLING_SETTLEMENT_E2E_QA.md](./CLINIC_QUEUE_VISIT_BILLING_SETTLEMENT_E2E_QA.md)** — documents alignment of `queue.service.completeService` with `emr.completeVisitWithPolicy` and ordering vs ticket `DONE`. **Live steps:** [CLINIC_QUEUE_VISIT_SLICE_LIVE_SMOKE_CHECKLIST.md](./CLINIC_QUEUE_VISIT_SLICE_LIVE_SMOKE_CHECKLIST.md).
