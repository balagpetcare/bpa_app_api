# Checkpoint 1: Staff Clinic Appointments — Inventory & Analysis (NO CODE CHANGES)

**Date:** 2025-03  
**Scope:** Clinic V2 appointment routes, controllers, services, Prisma models; status transitions; queue/token handling; branch/org isolation.

---

## 1. Clinic V2 appointment routes and handlers

**Base path:** `/api/v1/clinic` (mount in `src/api/v1/routes.ts`).  
All routes use `authenticateToken` and `requireClinicPermission`; `branchId` comes from `req.params.branchId`.

| Method | Path | Permission | Controller handler | Service |
|--------|------|------------|--------------------|---------|
| GET | `/branches/:branchId/slots` | read / manage | getSlots | appointment.service.getAvailableSlots |
| GET | `/branches/:branchId/doctors` | read / manage | getDoctors | (inline in controller) |
| GET | `/branches/:branchId/services` | read / manage | getClinicServices | servicesService.getServices |
| GET | `/branches/:branchId/appointments` | read / manage | listAppointments | appointment.service.listAppointments |
| GET | `/branches/:branchId/appointments/:appointmentId` | read / manage | getAppointmentById | appointment.service.getAppointmentById |
| POST | `/branches/:branchId/appointments` | manage | createAppointment | appointment.service.createAppointment |
| POST | `/branches/:branchId/appointments/:appointmentId/check-in` | manage / queue.manage | checkInAppointment | queue.service.checkInAndIssueTicket → appointment.service.checkInAppointment + issueTicket |
| POST | `/branches/:branchId/appointments/:appointmentId/cancel` | manage | cancelAppointment | appointment.service.cancelAppointment |
| POST | `/branches/:branchId/appointments/:appointmentId/reschedule` | manage | rescheduleAppointment | appointment.service.rescheduleAppointment |
| POST | `/branches/:branchId/appointments/:appointmentId/no-show` | manage | markNoShow | appointment.service.markNoShow |

**Files:**

- Routes: `src/api/v1/modules/clinic/clinic.routes.ts`
- Controller: `src/api/v1/modules/clinic/clinic.controller.ts`
- Appointment logic: `src/api/v1/modules/clinic/appointment.service.ts`
- Queue/token: `src/api/v1/modules/clinic/queue.service.ts`
- Middleware: `src/api/v1/modules/clinic/clinic.middleware.ts`
- Responses: `src/api/v1/modules/clinic/clinic.responses.ts`
- Audit: `src/api/v1/modules/clinic/clinic.audit.ts` → `middlewares/auditWriter.ts` (writes to `AuditLog`)

**Prisma models (appointment + queue):**

- `Appointment` (orgId, branchId, patientId, petId, doctorId, serviceId, scheduledStartAt/EndAt, status, …)
- `AppointmentEvent` (appointmentId, eventType, byUserId, meta, createdAt)
- `QueueSession` (orgId, branchId, date, type, status, lastTokenSeq)
- `QueueTicket` (orgId, branchId, queueSessionId, tokenNo, appointmentId, patientId, petId, doctorId, status, …)
- `QueueEvent` (ticketId, eventType, byUserId, meta, createdAt)

---

## 2. Status enums and mutation endpoints

**AppointmentStatus (Prisma enum):**  
BOOKED, CONFIRMED, CHECKED_IN, IN_QUEUE, CALLED, IN_CONSULT, COMPLETED, CANCELLED, NO_SHOW.

**Mutations and where status changes:**

| Mutation | Service function | Current status check | New status / effect |
|----------|------------------|----------------------|----------------------|
| Create | createAppointment | — | BOOKED |
| Check-in | checkInAppointment | CHECKIN_FROM_STATUSES = BOOKED, CONFIRMED | CHECKED_IN |
| Cancel | cancelAppointment | CANCELLABLE_STATUSES = BOOKED, CONFIRMED | CANCELLED |
| No-show | markNoShow | NO_SHOW_STATUSES = BOOKED, CONFIRMED | NO_SHOW |
| Reschedule | rescheduleAppointment | CANCELLABLE_STATUSES (BOOKED, CONFIRMED) | Old → CANCELLED; new appointment → BOOKED |

**Constants in code:**

- `ACTIVE_APPOINTMENT_STATUSES`: BOOKED, CONFIRMED, CHECKED_IN, IN_QUEUE, CALLED, IN_CONSULT (used for double-booking and slot exclusion).
- Cancel allows only BOOKED, CONFIRMED (not CHECKED_IN). Doc says CHECKED_IN can be cancelled; code does not allow it (discrepancy).

**Invalid transitions currently possible:**

- No single place that defines “allowed next status.” Each function has its own list (CANCELLABLE_STATUSES, NO_SHOW_STATUSES, CHECKIN_FROM_STATUSES).
- CONFIRMED is allowed in code but there is no “confirm” action; only BOOKED → CONFIRMED is undocumented from API.
- Transitions like CHECKED_IN → IN_QUEUE, IN_QUEUE → CALLED, CALLED → IN_CONSULT, IN_CONSULT → COMPLETED are not implemented in appointment.service; they would be driven by queue/visit flows. So invalid transitions are mostly prevented by “no endpoint for that transition,” but not by a shared state machine (e.g. CHECKED_IN → CANCELLED could be added and would be inconsistent with current CANCELLABLE_STATUSES).

---

## 3. Queue / token handling

**Flow:**

- Check-in: controller calls `queueService.checkInAndIssueTicket(orgId, branchId, appointmentId, userId)`.
- `checkInAndIssueTicket`: finds appointment by **id only** (no branchId), then calls `appointmentService.checkInAppointment(appointmentId, userId)`, then `issueTicket(…)` with that appointment’s data and the **request’s** orgId/branchId.

**Token generation (`issueTicket`):**

- Runs in a single `prisma.$transaction`.
- Get or create `QueueSession` by (branchId, date, type).
- `seq = session.lastTokenSeq + 1`; update session `lastTokenSeq = seq`; `tokenNo = "A-" + padStart(seq, 3)`; create `QueueTicket` with that tokenNo.
- Unique constraint: `@@unique([branchId, queueSessionId, tokenNo])`.

**Race risk:**

- Two concurrent check-ins for the same branch/date: both can read the same `lastTokenSeq`, both compute same `seq`, both update session to same value, both create ticket with same tokenNo. Second insert hits unique constraint and transaction fails. There is **no retry**; caller sees 500. So: token uniqueness is enforced by DB, but there is no retry-on-conflict, so concurrent check-ins can fail one request.

**Existing schema:**

- `QueueSession`: (branchId, date, type) unique; has lastTokenSeq.
- `QueueTicket`: (branchId, queueSessionId, tokenNo) unique. No separate “ClinicQueueToken” model; QueueTicket is the token.

**Appointment ↔ queue:**

- Check-in sets appointment to CHECKED_IN and creates a QueueTicket linked to that appointment. Queue actions (call next, start, complete) update ticket/visit only; they do not currently update appointment status to IN_QUEUE / CALLED / IN_CONSULT / COMPLETED. So appointment can stay CHECKED_IN while ticket moves through CALLED → IN_SERVICE → DONE.

---

## 4. Branch / org isolation

**Middleware:**

- `requireClinicPermission` resolves branch by id, checks it is CLINIC type and clinicEnabled, and that the user has the required permission for **that** branch. Sets `req.clinicBranchId`, `req.clinicBranch` (id, orgId, name).

**Per-endpoint:**

- **listAppointments:** `branchId` from `req.clinicBranchId` → service `listAppointments(branchId, filters)`. Where clause includes `branchId`. **OK.**
- **getAppointmentById:** controller passes `branchId = req.clinicBranchId` → service `getAppointmentById(appointmentId, branchId)`. Where clause includes `branchId`. **OK.**
- **createAppointment:** controller passes `branch.orgId`, `Number(branchId)` from req. Service creates with that orgId/branchId. **OK.** (DoctorId is not validated to belong to that branch; could harden.)
- **cancelAppointment:** controller passes only `appointmentId` (from params), `reason`, `userId`. Service uses `findUnique({ where: { id: appointmentId } })` and updates. **Gap:** an appointment from another branch can be cancelled if the user knows its id.
- **rescheduleAppointment:** same: only `appointmentId` and body. Service finds by id only. **Gap:** same cross-branch reschedule risk.
- **markNoShow:** same: only `appointmentId`, `userId`. Service finds by id only. **Gap:** same.
- **checkInAppointment:** controller calls `checkInAndIssueTicket(branch.orgId, Number(branchId), appointmentId, userId)`. Queue service finds appointment by id only; then updates that appointment and creates a ticket for the **URL** branch. **Gap:** (1) can check-in an appointment from another branch; (2) ticket would be created for the URL branch, not necessarily the appointment’s branch.

So **branch isolation is missing** for: cancel, reschedule, no-show, and check-in. All four must ensure the appointment’s `branchId` (and optionally `orgId`) matches `req.clinicBranchId` (and req.clinicBranch.orgId).

---

## 5. Audit trail (current)

- **AppointmentEvent:** create, cancel, reschedule, no-show, and check-in all create an `AppointmentEvent` row (eventType, byUserId, meta). Index: (appointmentId). No orgId/branchId on the table (can join via Appointment).
- **AuditLog (global):** `writeClinicAudit` → `writeAudit` → `prisma.auditLog.create` (actorId, action, entityType, entityId, before, after, ip, userAgent). Used from controller for APPOINTMENT_CREATED, APPOINTMENT_CHECKED_IN, APPOINTMENT_CANCELLED, APPOINTMENT_RESCHEDULED, APPOINTMENT_NO_SHOW.
- **GET events:** There is **no** endpoint `GET .../appointments/:id/events`. Events exist in DB but are not exposed by API.

---

## 6. Pagination and indexes

- **listAppointments:** `take: filters.limit ?? 100`, `skip: filters.offset ?? 0`. No hard cap (e.g. limit 50); no page validation.
- **Appointment indexes:**  
  `@@index([orgId, branchId])`, `@@index([branchId, status])`, `@@index([patientId])`, `@@index([scheduledStartAt])`, `@@unique([doctorId, scheduledStartAt, scheduledEndAt])`.  
  No composite (branchId, scheduledStartAt) or (branchId, status, scheduledStartAt) or (doctorId, scheduledStartAt) for list-by-date/status/doctor queries.

---

## 7. Findings summary

| # | Finding | Severity |
|---|---------|----------|
| 1 | Cancel / reschedule / no-show / check-in do not verify appointment.branchId === req.clinicBranchId; cross-branch mutation possible. | **High** |
| 2 | No centralized state machine; allowed transitions are scattered; invalid transitions not consistently rejected with 409. | Medium |
| 3 | Token generation: unique constraint prevents duplicate tokenNo but no retry on conflict; concurrent check-ins can cause one to fail with 500. | Medium |
| 4 | Appointment status is not updated when queue ticket moves (CALLED, IN_SERVICE, DONE); appointment can remain CHECKED_IN. | Low (product may be intentional) |
| 5 | No GET .../appointments/:id/events; timeline not exposed to frontend. | Low |
| 6 | listAppointments has no hard cap on limit (e.g. 50); no input validation (Zod/Joi) on query/body. | Low |
| 7 | AppointmentEvent exists and is used; no separate ClinicAppointmentEvent table yet; add endpoint and optional branchId/orgId if branch-scoped event lists needed. | Info |
| 8 | Cancel allows only BOOKED, CONFIRMED; doc says CHECKED_IN can be cancelled — align code or doc. | Info |

---

## 8. Proposed minimal-change plan (aligned with your checkpoints)

- **Checkpoint 2 (state machine):** Add a single `AppointmentStateMachine` (e.g. `appointments/stateMachine.ts`) with allowed transitions; refactor mutation handlers to call `transitionAppointmentStatus(…)` (or equivalent). Return 409 with a clear code (e.g. INVALID_STATUS_TRANSITION) for invalid transitions. Keep existing status enums and Appointment model unchanged.
- **Checkpoint 3 (audit trail):** Keep using `AppointmentEvent` for appointment-level events; optionally add orgId/branchId to it (migration) for branch-scoped event lists. Add `GET /api/v1/clinic/branches/:branchId/appointments/:appointmentId/events` (permission: clinic.appointments.read), returning existing AppointmentEvent rows (no PII in meta). Do **not** add a second event table unless you explicitly want a separate “ClinicAppointmentEvent” shape; the plan can use AppointmentEvent + this endpoint.
- **Checkpoint 4 (queue token):** Keep `QueueTicket`; no new model. In `issueTicket`, on unique constraint violation (Prisma code P2002), retry once (re-read session, recompute seq, create ticket). Optionally wrap check-in in a transaction that (1) ensures appointment belongs to branch, (2) transitions appointment to CHECKED_IN, (3) issues ticket; or keep current two-step but add branch check before calling checkInAppointment.
- **Checkpoint 5 (scaling):** Add pagination cap (e.g. limit ≤ 50, offset ≥ 0); add DB indexes (branchId, scheduledStartAt), (doctorId, scheduledStartAt), (branchId, status, scheduledStartAt); validate inputs (Zod or Joi) for list and create.
- **Checkpoint 6 (isolation + tests):** For every mutation that takes appointmentId, resolve appointment by (id, branchId) with branchId from req; return 404 if not in branch. Add tests: cannot read/update another branch’s appointment; invalid transition returns 409; token uniqueness under concurrent check-in (best-effort).
- **Checkpoint 7 (frontend):** Add detail drawer with summary + timeline (call new events endpoint); toast after actions; keep list and create modal as-is.
- **Checkpoint 8 (docs):** Update APPOINTMENTS_STAFF.md with state machine, events endpoint, queue token behaviour, QA checklist.

---

## 9. Conflicts / confirmation

- **Schema:** No change to Appointment or QueueTicket enums/structure required for state machine or events endpoint. Optional: add orgId/branchId to AppointmentEvent for branch-scoped event listing; if we skip that, events are still available per appointment via GET events.
- **V2 API:** All changes are additive or internal (state machine, branch check, retry). Response shapes for list/get/create/cancel/reschedule/no-show/check-in stay the same. New endpoint: GET .../appointments/:id/events. No breaking change to existing staff UI.
- **Permission keys:** Keep clinic.appointments.read and clinic.appointments.manage; no new keys proposed.

**If you confirm**, next step is **Checkpoint 2 (state machine)** with the above minimal-change plan. If you want a separate `ClinicAppointmentEvent` table or different index/constraint choices, say so before implementation.
