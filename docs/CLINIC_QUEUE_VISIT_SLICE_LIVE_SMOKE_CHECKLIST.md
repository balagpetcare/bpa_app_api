# Live smoke — Queue → Visit → Appointment → Settlement → Room

**Purpose:** Minimal operational verification of the hardened clinic slice (aligned with [CLINIC_QUEUE_VISIT_BILLING_SETTLEMENT_E2E_QA.md](./CLINIC_QUEUE_VISIT_BILLING_SETTLEMENT_E2E_QA.md), [DOCTOR_VISIT_COMPLETION_GOVERNANCE.md](./DOCTOR_VISIT_COMPLETION_GOVERNANCE.md), [CLINIC_VISITS_RELEASE_READINESS.md](../../bpa_web/docs/CLINIC_VISITS_RELEASE_READINESS.md)).  
**Time:** ~15–25 minutes with one test patient + one appointment (or walk-in queue ticket with visit).

---

## Prerequisites

| Item | Notes |
|------|--------|
| Staff user | `clinic.queue.manage` (start/complete queue). For visit complete: `clinic.emr.write` and/or `clinic.visits.manage` per routes. |
| Branch | Known `branchId`; optional: branch room assigned on appointment (`appointment.roomId`) to exercise room hooks. |
| Doctor-assigned visit | Settlement ledger is created only when visit `doctorId` points to a **DOCTOR** `clinicStaffProfile` ([`createSettlementLedgerForVisit`](../src/api/v1/modules/clinic/doctorSettlement.service.ts)); otherwise **0 ledger rows is expected**, not a failure. |
| Room side effects | **Only if** linked appointment has `roomId`: `IN_PROGRESS` → room **OCCUPIED**; `COMPLETED` → **CLEANING** ([`roomOccupancy.service.ts`](../src/api/v1/services/roomOccupancy.service.ts)). No `roomId` → no room change (N/A). |

**API base:** `POST /api/v1/clinic/branches/:branchId/queue/tickets/:ticketId/start` and `.../complete` (staff Bearer token + clinic context cookie/header as your env requires).

---

## Checklist (execute in order)

### A — Queue start

| Step | Action | Expected |
|------|--------|----------|
| A1 | Open queue session for today if needed; create or use a ticket in **WAITING** or **CALLED** with linked **appointment** in a consult-eligible state (per your workflow). | Ticket exists. |
| A2 | **Start service** (UI: start from queue row, or `POST .../queue/tickets/:ticketId/start`). | Response **200**; ticket **IN_SERVICE**; `visitId` populated on ticket when a visit is created/reused. |
| A3 | Inspect visit (staff visits detail or `GET .../visits/:visitId`). | Visit **IN_PROGRESS** (or consistent with your `startService` rules); `startedAt` set. |
| A4 | If appointment was **CALLED** / pre-consult, check appointment status. | **IN_CONSULT** after start (via `appointmentService.startConsultAppointment`); invalid transitions may log warn only. |

### B — Queue complete

| Step | Action | Expected |
|------|--------|----------|
| B1 | **Complete service** (UI or `POST .../queue/tickets/:ticketId/complete`). | **200**; ticket **DONE** with `endedAt`. |
| B2 | If completion fails (400): read message. | Unmet policy with **overrides disabled**: ticket should remain **IN_SERVICE** (visit completed **before** ticket DONE). |
| B3 | Re-fetch visit. | **COMPLETED**; `completedAt` set. |
| B4 | `DoctorAuditLog` (DB or internal tools): latest row for this `visitId`. | Action `VISIT_COMPLETED` or `VISIT_COMPLETED_OVERRIDE`; for queue path, `newValue.completionSource` = **`QUEUE_TICKET_DONE`** (staff `changedByRole` **STAFF**). |

### C — Appointment sync

| Step | Action | Expected |
|------|--------|----------|
| C1 | Open appointment used by the ticket/visit. | Status **COMPLETED** when transition from **IN_CONSULT** (or valid path) is allowed. |
| C2 | If already **COMPLETED**, repeat complete is N/A. | No duplicate harmful state; second `completeAppointment` may no-op/fail transition (handled with warn in queue path). |

### D — Settlement idempotency

| Step | Action | Expected |
|------|--------|----------|
| D1 | Count `doctor_settlement_ledger` rows for `visitId` (before/after first completion). | **At most one** row per visit when doctor profile qualifies; **zero** if doctor is not a settling doctor — both valid. |
| D2 | Idempotency: complete visit again **must not** be possible via normal queue path on same ticket (ticket already DONE). Optional: complete same visit via staff **POST .../visits/:visitId/complete** if your product allows (visit already COMPLETED → policy short-circuit). | Ledger count **unchanged** (early return in `createSettlementLedgerForVisit`). |

### E — Room side effects (if enabled)

| Step | Action | Expected |
|------|--------|----------|
| E1 | After **start** (visit **IN_PROGRESS**), check `branch_rooms.operational_status` for `appointments.room_id`. | **OCCUPIED** when `roomId` present. |
| E2 | After **queue complete** (visit **COMPLETED**), same room. | **CLEANING** when `roomId` present. |

### F — Staff / doctor / queue parity (conceptual)

| Path | Canonical completion | Audit distinction |
|------|----------------------|-------------------|
| Staff | `POST /clinic/branches/:branchId/visits/:visitId/complete` → `completeVisitWithPolicy` | `actor: STAFF_CLINIC`, optional override |
| Doctor | `PATCH /doctor/visits/:id/complete` → ownership + `completeVisitWithPolicy` | `changedByRole: DOCTOR` |
| Queue | `POST .../queue/tickets/:ticketId/complete` → `completeVisitWithPolicy` then ticket DONE | `completionSource: QUEUE_TICKET_DONE` |

**Spot-check (optional):** Complete a second visit via **staff** or **doctor** UI with the same branch policy; confirm same eligibility/override rules and single ledger row behavior.

---

## Pass / fail

- **PASS:** A2–A4, B1, B3, C1, D1–D2 as applicable, E only if room assigned and statuses match.  
- **FAIL:** Ticket DONE while visit not COMPLETED; duplicate ledger rows for same visit; room stuck OCCUPIED after COMPLETED when `roomId` was set; queue completion with no audit row when policy required one.

---

## Automation note (CI / agent)

Authenticated `start` / `complete` calls were **not** run from this doc’s authoring environment (tokens and DB fixtures required). Run this checklist in **staging** or a dedicated QA org before production **GO** for the slice.
