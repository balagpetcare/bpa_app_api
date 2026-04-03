# Clinic Appointment Workflow — Master System Audit

**Date:** 2026-03-19
**Scope:** Full-system end-to-end audit of the clinic appointment workflow
**Method:** Evidence-based trace across frontend (bpa_web), backend (backend-api), state machine, API routes, queue service, doctor service, appointment service, and all related UI pages
**Canonical Flow Audited:**

```
BOOKED/CONFIRMED → CHECK_IN → CHECKED_IN
CHECKED_IN → ENQUEUE → IN_QUEUE
IN_QUEUE → CALL → CALLED
CALLED → START_CONSULT → IN_CONSULT
IN_CONSULT → COMPLETE → COMPLETED
```

---

## 1. Executive Verdict

| Question | Answer |
|----------|--------|
| **Is the canonical appointment workflow fully operational end-to-end?** | **No.** Critical backend bugs prevent correct state transitions; several UI/UX gaps exist. |
| **Overall status** | **BROKEN** (callNext CALL transition silently fails; several state machine bypasses) |
| **Confidence** | **High** — based on direct code inspection of every service, controller, route, and page |
| **Biggest single issue** | `callNext` passes `[]` to `doctorService.callAppointment`, which causes `ensureOwnAppointment` to return `null`, silently dropping the IN_QUEUE → CALLED transition |

---

## 2. State Machine Definition (Source of Truth)

**File:** `backend-api/src/api/v1/modules/clinic/appointments/appointmentStateMachine.ts`

```
TRANSITIONS:
  CREATE:        [] → BOOKED
  DRAFT_CREATE:  [] → DRAFT
  PRE_BOOK:      [] → PRE_BOOKED
  PROMOTE:       [DRAFT, PRE_BOOKED] → BOOKED
  CONFIRM:       [BOOKED] → CONFIRMED
  CHECK_IN:      [BOOKED, CONFIRMED] → CHECKED_IN
  ENQUEUE:       [CHECKED_IN] → IN_QUEUE
  CALL:          [IN_QUEUE] → CALLED
  START_CONSULT: [CALLED] → IN_CONSULT
  COMPLETE:      [IN_CONSULT] → COMPLETED
  CANCEL:        [BOOKED, CONFIRMED, DRAFT, PRE_BOOKED] → CANCELLED
  NO_SHOW:       [BOOKED, CONFIRMED, DRAFT, PRE_BOOKED] → NO_SHOW
  RESCHEDULE:    [BOOKED, CONFIRMED] → CANCELLED (old); new → BOOKED
```

**Queue Ticket States (separate):**
```
WAITING → CALLED → IN_SERVICE → DONE
WAITING/CALLED → SKIPPED
```

---

## 3. Workflow Trace — Step-by-Step Audit

### Step 1: Booking / Confirmation

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend** | `appointment.service.createAppointment` → BOOKED; `confirmAppointment` → CONFIRMED | ✅ |
| **Frontend (staff)** | CreateAppointmentWizard, QuickAppointmentModal, CreateAppointmentModal all create appointments | ✅ |
| **Frontend (doctor)** | Doctor can confirm via QuickActionBar | ✅ |
| **State machine** | `CREATE: [] → BOOKED`, `CONFIRM: [BOOKED] → CONFIRMED` | ✅ |

### Step 2: Check-In

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend** | `appointment.service.checkInAppointment` uses `assertTransition(apt.status, "CHECK_IN")` | ✅ |
| **Backend** | `queue.service.checkInAndIssueTicket` calls checkIn then issues ticket | ✅ |
| **Guard** | Blocks check-in when patientId or petId is null (snapshot-only) | ✅ |
| **Frontend (staff appointments)** | Check-in button shown for BOOKED/CONFIRMED with patient+pet linked | ✅ |
| **Frontend (queue console)** | TodaysAppointments tab shows Check In for BOOKED/CONFIRMED | ✅ |
| **State machine** | `CHECK_IN: [BOOKED, CONFIRMED] → CHECKED_IN` | ✅ |

### Step 3: Intake

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend** | `staffClinicIntakeGet`, `staffClinicIntakeUpsert` — intake data CRUD only | ✅ |
| **Frontend** | Intake page at `/staff/branch/[branchId]/clinic/intake/[appointmentId]` | ✅ |
| **State machine** | Intake does NOT trigger any state transition. It is a data-entry step only. | ⚠️ BY DESIGN |
| **Gap** | No "intake complete → auto check-in" flow. Staff must manually check-in after intake. | ⚠️ UX |
| **Route** | Single source of truth for appointmentId is route param, query is fallback | ✅ |
| **Error handling** | Appointment and intake decoupled; intake failure doesn't clear appointment | ✅ |

### Step 4: Enqueue / Queue Ticket Creation

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend** | `appointment.service.enqueueAppointment` uses `assertTransition(apt.status, "ENQUEUE")` | ✅ |
| **Backend** | ENQUEUE is called ONLY inside `queue.service.callNext` — not exposed independently | ⚠️ DESIGN GAP |
| **No dedicated endpoint** | No `POST /enqueue` endpoint or API; staff cannot explicitly enqueue | ❌ GAP |
| **State machine** | `ENQUEUE: [CHECKED_IN] → IN_QUEUE` | ✅ |
| **Impact** | IN_QUEUE status is ephemeral — immediately transitions to CALLED inside callNext. Staff never sees IN_QUEUE in practice. | ⚠️ |

### Step 5: Call (IN_QUEUE → CALLED)

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend (queue.service.callNext)** | Queue ticket updated to CALLED ✅. Then attempts appointment ENQUEUE + CALL. | — |
| **🔴 CRITICAL BUG** | `callNext` line 404 calls `doctorService.callAppointment(next.appointmentId, userId, [])` with **empty array `[]`** for `doctorBranchMemberIds`. | ❌ **BROKEN** |
| **Root cause** | `ensureOwnAppointment` (doctor.service.ts:244-245) returns `null` when `doctorBranchMemberIds.length === 0`. `transitionAppointmentStatus` returns `null` → no transition. | ❌ |
| **Result** | After `callNext`: queue ticket = CALLED, appointment = **IN_QUEUE** (not CALLED). CALL transition silently fails. | ❌ |
| **Impact** | Doctor sees appointment as IN_QUEUE. `handleStartConsult` auto-calls from IN_QUEUE which sends `doctorCallAppointment` (doctor route, uses real doctorBranchMemberIds). If doctor is assigned, this works. If doctor is not assigned (Any Doctor), CALL also fails → 409. | ❌ |
| **Frontend (doctor QuickActionBar)** | Shows "Call Patient" for `["IN_QUEUE", "CHECKED_IN"]` — CHECKED_IN is invalid for CALL action | ❌ UI BUG |

### Step 6: Doctor Start Consult (CALLED → IN_CONSULT)

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend** | `doctor.service.startConsultAppointment` uses `assertTransition(apt.status, "START_CONSULT")` — requires CALLED | ✅ |
| **Backend** | Creates visit if none exists | ✅ |
| **Frontend (doctor detail page)** | `handleStartConsult` auto-calls from IN_QUEUE before start-consult | ✅ (workaround) |
| **Frontend** | `canStartTreatment` correctly limits to `["IN_QUEUE", "CALLED"]` | ✅ |
| **Gap** | If auto-call from IN_QUEUE fails (e.g., unassigned doctor), start-consult also fails → 409 with message "Appointment must be called from queue first" | ⚠️ |
| **Dual visit creation** | Both `queue.service.startService` AND `doctor.service.startConsultAppointment` can create visits. Risk of duplicate visit if both paths triggered. | ⚠️ |

### Step 7: Treatment / Consultation Progress

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend** | Visit exists with status IN_PROGRESS; notes, prescriptions, vitals, attachments available | ✅ |
| **Frontend (staff visit page)** | Visit detail loads with prescriptions and billing; create/finalize prescription available | ✅ |
| **Frontend (doctor visit page)** | Doctor visit page at `/doctor/visits/[id]` — notes, prescriptions, vitals | ✅ |

### Step 8: Completion

| Aspect | Finding | Status |
|--------|---------|--------|
| **Backend (doctor.service)** | `completeAppointment` uses `assertTransition(apt.status, "COMPLETE")` — requires IN_CONSULT | ✅ |
| **🟡 BUG: queue.service.completeService** | Directly sets `appointment.status = "COMPLETED"` (line 547-552) **without assertTransition** | ❌ BYPASS |
| **🟡 BUG: no appointment event** | `completeService` does NOT create an AppointmentEvent for the COMPLETED transition | ❌ AUDIT GAP |
| **Impact** | Queue complete can set appointment to COMPLETED from ANY status — if appointment was stuck at IN_QUEUE/CALLED (due to Bug #1), it would skip IN_CONSULT entirely. | ❌ |
| **Visit completion** | `completeService` also sets `visit.status = "COMPLETED"` and creates settlement ledger | ✅ |

### Step 9: Visit / Case / Billing Alignment

| Aspect | Finding | Status |
|--------|---------|--------|
| **Visit creation** | Created by `queue.service.startService` or `doctor.service.startConsultAppointment` | ✅ |
| **Billing** | `staffClinicBillingSummary`, `createInvoiceFromVisit` for visit billing | ✅ |
| **Treatment billing** | Treatment course/day billing separate but functional | ✅ |
| **Case** | Doctor cases at `/doctor/cases` | ✅ |
| **Gap** | No safeguard against duplicate visit creation (both queue and doctor paths) | ⚠️ |

### Step 10: Panel Consistency

| Panel | Workflow Coverage | Gaps |
|-------|-------------------|------|
| **Staff appointments** | Booking, confirm, check-in, cancel, no-show, reschedule, intake, assign doctor, collect payment | No post-check-in actions (no call, start, complete from appointments page) |
| **Staff queue console** | Session management, today's appointments, check-in, walk-in, call next, skip, start, complete, assign, priority | Most complete for queue operations ✅ |
| **Doctor appointments list** | List, filter, call, start-consult, complete, confirm, reschedule, cancel | Call shows for CHECKED_IN (invalid); auto-call workaround from IN_QUEUE |
| **Doctor appointment detail** | Call, start treatment, complete, notes, follow-up, history | Same Call/Start bugs as list |
| **Staff visit detail** | Visit info, prescriptions, billing | No "complete visit" from staff side |

---

## 4. Complete Gap List

### 🔴 CRITICAL (Workflow-Breaking)

| # | Gap | Location | Root Cause | Impact |
|---|-----|----------|------------|--------|
| **C1** | `callNext` CALL transition silently fails | `queue.service.ts:404` | Passes `[]` as `doctorBranchMemberIds` to `doctorService.callAppointment`; `ensureOwnAppointment` returns `null` for empty array | Appointment stays at IN_QUEUE while queue ticket is CALLED. Entire queue-to-consult flow is broken for the appointment entity. |
| **C2** | `completeService` bypasses state machine | `queue.service.ts:547-552` | Directly sets `status: "COMPLETED"` without `assertTransition` | Appointment can be set to COMPLETED from any status, skipping IN_CONSULT. No audit event created. |
| **C3** | `startService` appointment sync bypasses state machine | `queue.service.ts:494-507` | Directly sets `status: "IN_CONSULT"` without `assertTransition` | Can set IN_CONSULT from IN_QUEUE (skipping CALLED) if C1 has left appointment at IN_QUEUE |

### 🟠 HIGH (Causes 409s / Broken UI Actions)

| # | Gap | Location | Root Cause | Impact |
|---|-----|----------|------------|--------|
| **H1** | QuickActionBar shows "Call Patient" for CHECKED_IN | `QuickActionBar.tsx:82` | `["IN_QUEUE", "CHECKED_IN"].includes(statusUpper)` | Doctor clicking Call on CHECKED_IN → 409 error (CALL requires IN_QUEUE) |
| **H2** | `skipTicket` only accepts CALLED status | `queue.service.ts:424` | `if (ticket.status !== "CALLED") throw` | Frontend shows Skip for WAITING tickets but backend rejects → 400 error |
| **H3** | Walk-in appointment bypasses state machine | `queue.service.ts:157-173` | Walk-in created directly as `status: "CHECKED_IN"` | No CREATE/BOOKED/CHECK_IN events; audit trail incomplete for walk-ins |
| **H4** | No explicit ENQUEUE endpoint | Backend + Frontend | ENQUEUE only inside callNext | Staff cannot put appointment IN_QUEUE without immediately calling. No separate enqueue step. |
| **H5** | Doctor Call fails for "Any Doctor" appointments | `doctor.service.ts:244-249` | `ensureOwnAppointment` requires `doctorId IN doctorBranchMemberIds` | If appointment has no specific doctor assigned (isAnyDoctor), doctor CALL fails |

### 🟡 MEDIUM (UX / Data Integrity)

| # | Gap | Location | Root Cause | Impact |
|---|-----|----------|------------|--------|
| **M1** | No post-check-in actions on staff appointments page | `appointments/page.jsx` | Only pre-queue actions shown | Staff must switch to queue console for CHECKED_IN/IN_QUEUE/CALLED/IN_CONSULT appointments |
| **M2** | No "Complete Visit" from staff side | `visits/[visitId]/page.jsx` | Visit page doesn't expose complete action | Only doctor or queue complete can end a visit |
| **M3** | Dual visit creation risk | `queue.service.startService` + `doctor.service.startConsultAppointment` | Both create visits independently | If queue starts service (creates visit) then doctor starts consult, could create duplicate visit |
| **M4** | `completeService` creates no AppointmentEvent | `queue.service.ts:547-552` | Missing `appointmentEvent.create` | Audit trail missing COMPLETED event for queue-completed appointments |
| **M5** | Intake doesn't trigger state transition | Intake page (by design) | Intake is data-only | Staff may fill intake and expect check-in to happen automatically |
| **M6** | No appointment timeline integration on queue page | Queue console | Queue shows ticket status, not appointment events | Staff can't see full appointment history from queue |
| **M7** | Doctor reschedule/cancel uses `prompt()`/`confirm()` | `QuickActionBar.tsx:51-68` | Raw browser dialogs | Not enterprise-grade UX |

### 🔵 LOW (Polish / Optional)

| # | Gap | Location | Impact |
|---|-----|----------|--------|
| **L1** | No real-time sync between queue and appointments pages | Frontend | Staff must manually refresh |
| **L2** | Walk-in appointments skip BOOKED/CONFIRMED events | Backend | Audit trail starts at CHECKED_IN |
| **L3** | No "re-open" or "undo" for completed appointments | Backend + Frontend | Terminal state with no recovery |
| **L4** | Doctor appointment list doesn't show queue token number | Doctor appointments page | No cross-reference to queue position |

---

## 5. Root Cause Analysis

### Root Cause 1: Queue service uses wrong API for appointment transitions
The queue service needs to sync appointment status but incorrectly uses `doctorService.callAppointment` (which requires doctor ownership) instead of `appointmentService` functions directly. The `enqueueAppointment` step correctly uses `appointmentService`, but the CALL step incorrectly delegates to `doctorService`.

**Fix**: Queue service should use `appointmentService` for all appointment status transitions, or a new internal function that doesn't require doctor ownership.

### Root Cause 2: Raw DB updates bypass state machine
`queue.service.completeService` and `startService` directly call `prisma.appointment.update({ data: { status: X } })` instead of routing through `appointmentService` functions that use `assertTransition`. This allows invalid transitions and creates audit trail gaps.

**Fix**: All appointment status mutations must go through `appointmentService` functions that use `assertTransition`.

### Root Cause 3: Two parallel state machines without proper sync
Queue ticket states (WAITING→CALLED→IN_SERVICE→DONE) and appointment states (CHECKED_IN→IN_QUEUE→CALLED→IN_CONSULT→COMPLETED) are separate but must stay synchronized. The sync code is partial and buggy.

**Fix**: Establish a single "sync" service that handles both ticket and appointment state transitions atomically.

### Root Cause 4: Frontend allows actions that backend rejects
QuickActionBar shows "Call Patient" for CHECKED_IN, but backend requires IN_QUEUE. Frontend helpers (`appointmentStatusHelpers.js`) don't cover queue-phase actions.

**Fix**: Extend `appointmentStatusHelpers.js` with `canCall`, `canStartConsult`, `canComplete` helpers that mirror the backend state machine.

---

## 6. Workflow Map — Current vs. Canonical

### Current (Broken) Flow
```
STAFF: Book/Confirm → Check-In → [ticket: WAITING]
                                    ↓
STAFF: Queue → Call Next → [ticket: CALLED] + [apt: IN_QUEUE ❌ should be CALLED]
                                    ↓
DOCTOR: Start Treatment → auto-call from IN_QUEUE (workaround) → CALLED → IN_CONSULT
                                    ↓
QUEUE: Complete Service → [apt: COMPLETED directly, bypasses state machine ❌]
```

### Canonical Target Flow
```
STAFF: Book (BOOKED) → Confirm (CONFIRMED) → Check-In (CHECKED_IN) + [ticket: WAITING]
                                                        ↓
STAFF: Queue → Call Next → [apt: CHECKED_IN→IN_QUEUE→CALLED ✅] + [ticket: CALLED ✅]
                                                        ↓
DOCTOR: Start Treatment → [CALLED→IN_CONSULT ✅] + Visit created
                                                        ↓
DOCTOR/QUEUE: Complete → [IN_CONSULT→COMPLETED ✅] + Visit completed
```

---

## 7. Page-by-Page Action Matrix

### Staff Appointments Page
**File**: `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx`

| Appointment Status | Available Actions | Missing Actions | Notes |
|-------------------|-------------------|-----------------|-------|
| DRAFT | Complete intake | — | ✅ |
| PRE_BOOKED | Complete intake | — | ✅ |
| BOOKED | Confirm, Check-in (if patient linked), Intake, Cancel, No-show, Reschedule, Assign Dr, Pay, Slip | — | Check-in disabled without patient ✅ |
| CONFIRMED | Check-in (if patient linked), Intake, Cancel, No-show, Reschedule, Assign Dr, Pay, Slip | — | ✅ |
| CHECKED_IN | Intake, Slip | Call, View Queue Ticket | No queue actions ⚠️ |
| IN_QUEUE | Intake, Slip | Call, View Queue Ticket | No queue actions ⚠️ |
| CALLED | Intake, Slip | Start Service, View Queue Ticket | No queue actions ⚠️ |
| IN_CONSULT | Intake, Slip | Open Visit, Complete | No actions ⚠️ |
| COMPLETED | Slip | View Visit | Read-only ✅ |

### Staff Queue Console
**File**: `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/queue/page.jsx`

| Ticket Status | Available Actions | Missing Actions | Notes |
|---------------|-------------------|-----------------|-------|
| WAITING | Skip ❌ (backend rejects), Start, Assign Doctor, Set Priority | Call individual ticket | Skip broken for WAITING (backend only allows CALLED) |
| CALLED | Start, Recall, No-show, Cancel | — | ✅ |
| IN_SERVICE | Complete, Open Visit | — | ✅ |
| DONE | View | — | ✅ |

### Doctor Appointments List
**File**: `bpa_web/app/doctor/(larkon)/appointments/page.tsx`

| Appointment Status | Available Actions | Issues |
|-------------------|-------------------|--------|
| BOOKED | Confirm, Reschedule, Cancel | ✅ |
| CONFIRMED | Reschedule, Cancel | ✅ |
| CHECKED_IN | Call Patient ❌ | CALL requires IN_QUEUE, not CHECKED_IN |
| IN_QUEUE | Call Patient, Start Consultation | ✅ (auto-call + start works as workaround) |
| CALLED | Start Consultation | ✅ |
| IN_CONSULT | Complete Visit, Open Visit | ✅ |

### Doctor Appointment Detail
**File**: `bpa_web/app/doctor/(larkon)/appointments/[id]/page.tsx`

| Appointment Status | Available Actions | Issues |
|-------------------|-------------------|--------|
| IN_QUEUE | Start Treatment (auto-calls first) | ✅ (workaround) |
| CALLED | Start Treatment | ✅ |
| IN_CONSULT | Open Visit link | ✅ |

---

## 8. API / Service Repair Plan

### Phase 1: Fix Critical Backend Bugs (MUST DO FIRST)

#### Fix C1: callNext CALL transition
**File**: `backend-api/src/api/v1/modules/clinic/queue.service.ts`
**Change**: Replace `doctorService.callAppointment(next.appointmentId, userId, [])` with direct `appointmentService` call that uses `assertTransition` for CALL action.

**Option A (Recommended)**: Add `callAppointment` function to `appointment.service.ts`:
```typescript
async function callAppointment(appointmentId: number, userId: number, context: { orgId: number; branchId: number }) {
  const apt = await requireAppointmentInBranch({ appointmentId, orgId: context.orgId, branchId: context.branchId, select: { id: true, status: true } });
  assertTransition(apt.status, "CALL");
  const updated = await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "CALLED" } });
  await prisma.appointmentEvent.create({ data: { appointmentId, eventType: "CALLED", byUserId: userId, meta: {} } });
  return updated;
}
```

Then in `queue.service.callNext`, replace lines 394-408:
```typescript
if (updatedApt?.status === "IN_QUEUE") {
  try {
    await appointmentService.callAppointment(next.appointmentId, userId, context);
  } catch (e) {
    console.warn(`[queue.callNext] CALL failed for appointment ${next.appointmentId}:`, e?.message);
  }
}
```

#### Fix C2: completeService must use state machine
**File**: `backend-api/src/api/v1/modules/clinic/queue.service.ts`
**Change**: Replace direct `prisma.appointment.update` (lines 547-552) with `appointmentService` call:
```typescript
if (ticket.appointmentId) {
  try {
    await appointmentService.completeAppointment(ticket.appointmentId, userId, { orgId: ticket.orgId, branchId: ticket.branchId });
  } catch (e) {
    console.warn(`[queue.completeService] COMPLETE failed for appointment ${ticket.appointmentId}:`, e?.message);
  }
}
```
Requires adding `completeAppointment` to `appointment.service.ts` (or reuse existing if present).

#### Fix C3: startService must use state machine
**File**: `backend-api/src/api/v1/modules/clinic/queue.service.ts`
**Change**: Replace direct `prisma.appointment.update` (lines 494-507) with `appointmentService` call:
```typescript
if (ticket.appointmentId) {
  try {
    await appointmentService.startConsultAppointment(ticket.appointmentId, userId, { orgId: ticket.orgId, branchId: ticket.branchId });
  } catch (e) {
    console.warn(`[queue.startService] START_CONSULT failed for appointment ${ticket.appointmentId}:`, e?.message);
  }
}
```
Requires adding `startConsultAppointment` to `appointment.service.ts`.

### Phase 2: Fix High-Priority Bugs

#### Fix H1: QuickActionBar Call button for CHECKED_IN
**File**: `bpa_web/app/doctor/(larkon)/appointments/_components/QuickActionBar.tsx`
**Change**: Line 82 — change `["IN_QUEUE", "CHECKED_IN"]` to `["IN_QUEUE"]` only.

#### Fix H2: skipTicket allow WAITING
**File**: `backend-api/src/api/v1/modules/clinic/queue.service.ts`
**Change**: Line 424 — change `if (ticket.status !== "CALLED")` to `if (!["CALLED", "WAITING"].includes(ticket.status))`.

#### Fix H3: Walk-in appointment audit trail
**File**: `backend-api/src/api/v1/modules/clinic/queue.service.ts`
**Change**: After creating walk-in appointment, add CHECKED_IN event (already has CREATED event, add CHECK_IN event).

#### Fix H4: Add standalone ENQUEUE endpoint
**Files**: `appointment.service.ts`, `clinic.controller.ts`, `clinic.routes.ts`
**Change**: Expose `POST /branches/:branchId/appointments/:appointmentId/enqueue` that calls `appointmentService.enqueueAppointment`.

### Phase 3: Fix Medium Bugs

#### Fix M1: Add post-check-in actions to staff appointments page
**File**: `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx`
**Change**: Add "View Queue" link for CHECKED_IN/IN_QUEUE/CALLED/IN_CONSULT appointments; add "Open Visit" for appointments with visitId.

#### Fix M2: Add "Complete Visit" to staff visit page
**File**: `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/visits/[visitId]/page.jsx`
**Change**: Add "Complete Visit" button when visit status is IN_PROGRESS and user has permission.

#### Fix M3: Guard against duplicate visits
**File**: `doctor.service.startConsultAppointment` and `queue.service.startService`
**Change**: Check for existing visit before creating. Both already have partial checks (`!apt.visit` in doctor service); ensure queue service also checks.

#### Fix M4: Add AppointmentEvent for queue complete
**Change**: Handled by Fix C2 — routing through appointmentService will auto-create events.

### Phase 4: Frontend Status Helpers Extension

**File**: `bpa_web/lib/appointmentStatusHelpers.js`

Add:
```javascript
const CALL_FROM = ["IN_QUEUE"];
const START_CONSULT_FROM = ["CALLED"];
const COMPLETE_FROM = ["IN_CONSULT"];

export function canCall(status) { return CALL_FROM.includes(normalize(status)); }
export function canStartConsult(status) { return START_CONSULT_FROM.includes(normalize(status)); }
export function canComplete(status) { return COMPLETE_FROM.includes(normalize(status)); }
```

---

## 9. UI/UX Redesign Recommendations

### A. Staff Appointments Page
1. Add status-aware action groups: pre-queue (book/confirm/check-in), in-queue (call/start/complete), post-visit (view)
2. Show queue token number inline when appointment has a linked ticket
3. Add "Open Visit" action when `visitId` is present
4. Color-code rows by workflow phase (pre-queue = neutral, in-queue = blue, in-consult = green, completed = gray)

### B. Queue Console
1. Fix Skip for WAITING tickets (currently broken)
2. Add individual "Call" action per ticket (not just "Call Next")
3. Show appointment status alongside ticket status for cross-reference
4. Add real-time WebSocket refresh (backend already emits `emitQueueRealtime`)

### C. Doctor Appointments
1. Remove "Call Patient" for CHECKED_IN (only show for IN_QUEUE)
2. Add "Intake Status" column showing whether intake is complete
3. Replace `prompt()`/`confirm()` in QuickActionBar with proper modals
4. Show clear workflow state: "Waiting in Queue", "Called - Ready", "In Consultation"

### D. Cross-Panel Consistency
1. Standardize status labels: CHECKED_IN → "Checked In", IN_QUEUE → "In Queue", CALLED → "Called", IN_CONSULT → "In Consultation"
2. Standardize status badge colors across all panels (StatusBadge.tsx already handles this ✅)
3. Add cross-page navigation: appointments → queue → visit seamlessly

---

## 10. Implementation Phases (Exact Order)

### Phase 1: Critical Backend Fixes (DO FIRST — Blocks everything)
**Scope**: Fix C1, C2, C3
**Risk**: Medium (modifying queue.service internals)
**Files**:
- `backend-api/src/api/v1/modules/clinic/appointment.service.ts` — add `callAppointment`, `startConsultAppointment`, `completeAppointment` functions
- `backend-api/src/api/v1/modules/clinic/queue.service.ts` — replace raw DB updates with appointmentService calls
**Estimate**: Small change, ~50 lines
**Rollback**: Revert queue.service changes

### Phase 2: High-Priority Frontend Fixes
**Scope**: Fix H1, H2
**Risk**: Low (UI-only for H1; small backend for H2)
**Files**:
- `bpa_web/app/doctor/(larkon)/appointments/_components/QuickActionBar.tsx` — remove CHECKED_IN from Call button
- `backend-api/src/api/v1/modules/clinic/queue.service.ts` — allow skipTicket from WAITING
**Estimate**: ~5 lines total

### Phase 3: Walk-In Audit Trail + ENQUEUE Endpoint
**Scope**: Fix H3, H4
**Risk**: Low (additive)
**Files**:
- `backend-api/src/api/v1/modules/clinic/queue.service.ts` — add CHECK_IN event for walk-in
- `backend-api/src/api/v1/modules/clinic/clinic.controller.ts` — add enqueue controller
- `backend-api/src/api/v1/modules/clinic/clinic.routes.ts` — add enqueue route
**Estimate**: ~40 lines

### Phase 4: Frontend Enhancement
**Scope**: Fix M1, M2, M3, Phase 4 helpers
**Risk**: Low (UI additions)
**Files**:
- `bpa_web/lib/appointmentStatusHelpers.js` — add canCall, canStartConsult, canComplete
- `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx` — add post-check-in actions
- `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/visits/[visitId]/page.jsx` — add complete visit
**Estimate**: ~60 lines

### Phase 5: UX Polish
**Scope**: Replace prompt/confirm dialogs, cross-page navigation, real-time refresh
**Risk**: Low
**Estimate**: Medium effort

---

## 11. Validation Checklist

### After Phase 1

- [ ] `callNext` transitions appointment CHECKED_IN → IN_QUEUE → CALLED (verify with DB query)
- [ ] `startService` transitions appointment CALLED → IN_CONSULT via assertTransition
- [ ] `completeService` transitions appointment IN_CONSULT → COMPLETED via assertTransition
- [ ] AppointmentEvents created for all transitions (IN_QUEUE, CALLED, IN_CONSULT, COMPLETED)
- [ ] Invalid transitions throw 409 (e.g., complete from CHECKED_IN)

### After Phase 2

- [ ] Doctor QuickActionBar does NOT show "Call Patient" for CHECKED_IN
- [ ] `skipTicket` works for both WAITING and CALLED tickets
- [ ] No 400/409 errors from valid UI actions

### After Phase 3

- [ ] Walk-in appointments have CREATED and CHECKED_IN events in audit trail
- [ ] Staff can enqueue a CHECKED_IN appointment explicitly

### After Phase 4

- [ ] Staff appointments page shows "View Queue" for in-queue appointments
- [ ] Staff appointments page shows "Open Visit" for appointments with visits
- [ ] Staff can complete visit from visit detail page
- [ ] `canCall`, `canStartConsult`, `canComplete` helpers return correct values

### E2E Workflow Test

- [ ] Book appointment → Confirm → Check-In → Queue (callNext) → Doctor Start Treatment → Complete
- [ ] Walk-in → Queue → Call → Start → Complete
- [ ] Verify appointment status matches queue ticket status at every step
- [ ] Verify AppointmentEvent trail is complete for every transition
- [ ] Verify Visit is created once (not duplicated)

---

## 12. Risk / Rollback Notes

### Phase 1 Risks
- **Risk**: If `appointmentService` functions throw, queue operations may fail where they previously succeeded (with silent bugs)
- **Mitigation**: Wrap in try/catch with warn logging (same pattern already used for ENQUEUE)
- **Rollback**: Revert queue.service.ts to raw DB updates (restores current broken-but-not-crashing behavior)

### Phase 2 Risks
- **Risk**: Removing CHECKED_IN from Call button may confuse doctors who are used to clicking it
- **Mitigation**: Update error message to guide them: "Patient must be called from queue first"

### General
- **No schema changes** needed for any phase
- **No new permissions** required
- **No new API routes** needed for Phases 1-2 (Phase 3 adds one route)
- **All fixes are backward-compatible** — no client-breaking changes

---

## 13. Problem Classification

| Problem | Level | Phase |
|---------|-------|-------|
| C1: callNext CALL silent failure | **Architecture** | 1 |
| C2: completeService bypasses state machine | **Architecture** | 1 |
| C3: startService bypasses state machine | **Architecture** | 1 |
| H1: QuickActionBar CHECKED_IN Call | **UI** | 2 |
| H2: skipTicket WAITING rejection | **Backend** | 2 |
| H3: Walk-in audit trail | **Backend** | 3 |
| H4: No ENQUEUE endpoint | **Architecture** | 3 |
| H5: Any Doctor CALL failure | **Architecture** | 1 (side effect of C1 fix) |
| M1: No post-check-in staff actions | **UI** | 4 |
| M2: No staff complete visit | **UI** | 4 |
| M3: Dual visit creation | **Backend** | 4 |
| M4: Missing COMPLETED event | **Backend** | 1 (side effect of C2 fix) |
| M5: Intake no state transition | **UX/Design** | Future |
| M6: No timeline on queue | **UI** | 5 |
| M7: Raw prompt/confirm dialogs | **UI** | 5 |

---

## 14. Related Documents

| Document | Location | Relationship |
|----------|----------|-------------|
| State machine definition | `backend-api/src/api/v1/modules/clinic/appointments/appointmentStateMachine.ts` | Source of truth |
| Previous E2E audit | `backend-api/docs/CLINIC_E2E_FLOW_IMPLEMENTATION_AUDIT.md` | Treatment/billing flow (not queue) |
| Production hardening | `backend-api/docs/CLINIC_APPOINTMENT_TO_TREATMENT_PRODUCTION_HARDENING.md` | UX hardening (not state machine) |
| Queue status sync fix | `bpa_web/docs/CLINIC_QUEUE_APPOINTMENT_STATUS_SYNC_FIX.md` | Documented the fix that introduced Bug C1 |
| Queue console redesign | `bpa_web/docs/CLINIC_QUEUE_CONSOLE_REDESIGN.md` | Queue console UI spec |
| Intake workflow fix | `bpa_web/docs/APPOINTMENT_INTAKE_WORKFLOW_FIX.md` | Fixed invalid PROMOTE action |
| Intake return flow fix | `bpa_web/docs/CLINIC_INTAKE_RETURN_FLOW_FIX.md` | Register→intake redirect |
| Doctor page redesign | `bpa_web/docs/DOCTOR_APPOINTMENTS_PAGE_REDESIGN.md` | Doctor filters/layout |
| E2E remediation plan | `backend-api/docs/CLINIC_E2E_REMEDIATION_PLAN.md` | Billing/token/handover gaps |
| Status helpers | `bpa_web/lib/appointmentStatusHelpers.js` | Frontend state mirror |

---

*Master audit completed 2026-03-19. This document is the authoritative source for the clinic appointment workflow state.*

---

## 15. Implementation Log — 2026-03-19

All phases 1–5 of the repair plan were implemented in the same session as the audit.

### Phase 1: Critical Backend Fixes ✅ COMPLETE

| Fix | File | Change |
|-----|------|--------|
| **C1** | `appointment.service.ts` | Added `callAppointment(id, userId, context)` — state-machine-compliant IN_QUEUE→CALLED with `assertTransition` + AppointmentEvent |
| **C1** | `queue.service.ts` | Replaced `doctorService.callAppointment(id, userId, [])` with `appointmentService.callAppointment(id, userId, context)` in `callNext` |
| **C2** | `appointment.service.ts` | Added `completeAppointment(id, userId, context)` — state-machine-compliant IN_CONSULT→COMPLETED with `assertTransition` + AppointmentEvent |
| **C2** | `queue.service.ts` | Replaced raw `prisma.appointment.update({ status: "COMPLETED" })` in `completeService` with `appointmentService.completeAppointment(...)` |
| **C3** | `appointment.service.ts` | Added `startConsultAppointment(id, userId, context)` — state-machine-compliant CALLED→IN_CONSULT with `assertTransition` + AppointmentEvent |
| **C3** | `queue.service.ts` | Replaced raw `prisma.appointment.update({ status: "IN_CONSULT" })` in `startService` with `appointmentService.startConsultAppointment(...)` |
| **H5** | (resolved by C1) | `callAppointment` in `appointment.service` does not require doctor ownership — fixes Any Doctor appointments |
| **M4** | (resolved by C2) | `appointmentService.completeAppointment` creates COMPLETED AppointmentEvent — audit trail now complete |

### Phase 2: High-Priority Frontend Fixes ✅ COMPLETE

| Fix | File | Change |
|-----|------|--------|
| **H2** | `queue.service.ts` | `skipTicket` now accepts both `"CALLED"` and `"WAITING"` statuses |
| **H1** | `QuickActionBar.tsx` | Removed `"CHECKED_IN"` from Call Patient condition — now only shows for `"IN_QUEUE"` |
| **H1 UX** | `QuickActionBar.tsx` | Added guidance badge for CHECKED_IN: "Waiting — call from Queue Console" |

### Phase 3: Walk-In Audit Trail + ENQUEUE Endpoint ✅ COMPLETE

| Fix | File | Change |
|-----|------|--------|
| **H3** | `queue.service.ts` | Walk-in appointments now create both `CREATED` and `CHECKED_IN` AppointmentEvents in the same transaction |
| **H4** | `appointment.service.ts` | `enqueueAppointment` already existed — no change needed |
| **H4** | `clinic.controller.ts` | Added `exports.enqueueAppointment` controller handler |
| **H4** | `clinic.routes.ts` | Added `POST /branches/:branchId/appointments/:appointmentId/enqueue` route |
| **H4** | `bpa_web/lib/api.ts` | Added `staffClinicAppointmentEnqueue(branchId, appointmentId)` frontend wrapper |

### Phase 4: Frontend Enhancement ✅ COMPLETE

| Fix | File | Change |
|-----|------|--------|
| **Phase 4** | `bpa_web/lib/appointmentStatusHelpers.js` | Added `canEnqueue`, `canCall`, `canStartConsult`, `canComplete`, `isInActiveQueue`, `canOpenVisit` helpers mirroring backend state machine |
| **M1** | `staff/appointments/page.jsx` | Added "Add to Queue" button (canEnqueue), "Queue ↗" link (isInActiveQueue), "Visit ↗" link (canOpenVisit + visitId) |
| **M2** | `staff/visits/[visitId]/page.jsx` | Already had `handleCompleteVisit` + "Complete visit" button — confirmed present, no change needed |
| **M3** | `queue.service.ts` | `startService` now checks for existing visit linked to appointment before creating a new one — prevents duplicate visits |

### Phase 5: UX Polish ✅ COMPLETE

| Fix | File | Change |
|-----|------|--------|
| **M7** | `QuickActionBar.tsx` | Replaced `prompt()` (reschedule) and `confirm()` (cancel) browser dialogs with inline React state forms — date/time inputs for reschedule, text input for cancel reason |

### Deferred Items

| # | Item | Reason |
|---|------|--------|
| M5 | Intake → auto-check-in | By design — intake is data-only; auto-transition would break workflows where intake is filled before arrival |
| M6 | Appointment timeline on queue page | Phase 5 polish — requires additional API integration |
| L1 | Real-time sync on appointments page | WebSocket integration — separate task |
| L3 | Re-open/undo for completed appointments | Business rule decision needed |
| L4 | Queue token on doctor appointment list | Enhancement — separate task |

### Files Modified

**Backend (`backend-api`)**:
- `src/api/v1/modules/clinic/appointment.service.ts` — added 3 new functions + exports
- `src/api/v1/modules/clinic/queue.service.ts` — C1+C2+C3 fixes, H2 skipTicket, H3 walk-in event, M3 duplicate guard
- `src/api/v1/modules/clinic/clinic.controller.ts` — added `enqueueAppointment` handler
- `src/api/v1/modules/clinic/clinic.routes.ts` — added `/enqueue` route

**Frontend (`bpa_web`)**:
- `lib/api.ts` — added `staffClinicAppointmentEnqueue`
- `lib/appointmentStatusHelpers.js` — added 6 new helpers
- `app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx` — M1 post-check-in actions
- `app/doctor/(larkon)/appointments/_components/QuickActionBar.tsx` — H1 fix + M7 inline forms

---

## 16. Hardening Pass — 2026-03-19 (Pass 2)

Full validation pass across the entire workflow: state machine, all five status transitions, all pages, all roles, button visibility, event accuracy.

### Scope Validated

| Area | Status |
|------|--------|
| State machine (`appointmentStateMachine.ts`) | ✅ Canonical, correct for all transitions |
| `appointment.service.ts` — `checkInAppointment` | ✅ Correct: `assertTransition` + event |
| `appointment.service.ts` — `enqueueAppointment` | ✅ Correct: `assertTransition` + event |
| `appointment.service.ts` — `callAppointment` | ✅ Correct: `assertTransition` + event |
| `appointment.service.ts` — `startConsultAppointment` | ✅ Correct: `assertTransition` + event |
| `appointment.service.ts` — `completeAppointment` | ✅ Correct: `assertTransition` + event |
| `queue.service.ts` — `callNext` (CHECKED_IN → IN_QUEUE → CALLED) | ✅ State-machine-compliant (Phase 1) |
| `queue.service.ts` — `startService` (CALLED → IN_CONSULT) | ✅ State-machine-compliant (Phase 1) |
| `queue.service.ts` — `completeService` (IN_CONSULT → COMPLETED) | ✅ State-machine-compliant (Phase 1) |
| `queue.service.ts` — `skipTicket` (WAITING + CALLED allowed) | ✅ Fixed (Phase 2) |
| `queue.service.ts` — `issueTicket` walk-in audit trail | ✅ CREATED + CHECKED_IN events (Phase 3) |
| `queue.service.ts` — `startService` duplicate visit guard | ✅ Guards via appointmentId lookup (Phase 4) |
| `doctor.service.ts` — `callAppointment` | ✅ Uses `assertTransition` (own implementation, doctor-scoped) |
| `doctor.service.ts` — `startConsultAppointment` | ✅ Uses `assertTransition` + duplicate visit guard |
| `doctor.service.ts` — `completeAppointment` | ✅ Uses `assertTransition` |
| `doctor.service.ts` — `completeVisit` | ✅ **Fixed this pass** (was raw update; now uses `aptSvc.completeAppointment`) |
| `appointmentStatusHelpers.js` | ✅ All helpers mirror backend state machine |
| `QuickActionBar.tsx` | ✅ CHECKED_IN removed from Call; inline forms for cancel/reschedule |
| Staff appointments page — post-check-in actions | ✅ Add to Queue, Queue link, Visit link |
| Staff queue console — `QueueTicketsTable` Start button | ✅ **Fixed this pass** (was WAITING\|CALLED; now CALLED only) |
| Staff queue console — per-ticket "Call This Patient" | ✅ **Fixed this pass** (removed; was ignoring ticketId) |
| Staff queue console — IN_SERVICE "Open Visit" link | ✅ **Fixed this pass** (now links to visit detail page when visitId available) |
| Staff intake page — post-intake actions | ✅ **Fixed this pass** (Add to Queue button + appointment status badge) |
| Doctor appointment detail page | ✅ Correct handlers; auto-ENQUEUE path before START_CONSULT |
| Staff visits page — "Complete Visit" button | ✅ Pre-existing, confirmed present |
| `clinic.routes.ts` — `/enqueue` route | ✅ Present and permission-guarded |
| Role-based action safety | ✅ All endpoints require appropriate clinic permissions |

### Findings and Fixes

| # | Severity | Finding | Root Cause | Fix Applied |
|---|----------|---------|-----------|------------|
| **V1** | Critical | `doctor.service.ts:completeVisit` used raw `prisma.appointment.update({ status: "COMPLETED" })` — bypasses `assertTransition`, allows completion from any state | Legacy code pre-dating state machine | Replaced with `aptSvc.completeAppointment(...)` call; catches `INVALID_STATUS_TRANSITION` gracefully if queue path completed first |
| **V2** | Medium | `QueueTicketsTable` "Start" button appeared for both `WAITING` and `CALLED` tickets | Incorrect condition `status === "WAITING" \|\| status === "CALLED"` | Changed to `status === "CALLED"` only — matches backend `startService` guard |
| **V3** | Medium | `QueueTicketsTable` "Call This Patient" per-ticket secondary action ignored the `ticketId` and called `callNext` (next highest priority) instead | No per-ticket call endpoint; frontend called `callNext` for any ticket | Removed misleading "Call This Patient" action from WAITING secondary menu; canonical "Call Next" button at top remains |
| **V4** | Medium | `QueueTicketsTable` IN_SERVICE "Open Visit" linked to `/intake/:appointmentId` (pre-consult data entry page) instead of visit detail | Stale link before visit routing was established | Changed to `/visits/:visitId` when `ticket.visitId` exists; falls back to `/intake/` otherwise |
| **V5** | Medium | Staff intake page had no "Add to Queue" action; after saving intake for a CHECKED_IN appointment, staff had no next-step affordance | Intake page was data-only with no workflow continuation | Added "Add to Queue" (`canEnqueue`) button in action bar, appointment status badge in header, `handleEnqueue` handler |

### Files Modified in This Pass

**Backend (`backend-api`)**:
- `src/api/v1/modules/doctor/doctor.service.ts` — V1: `completeVisit` now uses `aptSvc.completeAppointment` with `InvalidTransitionError` guard

**Frontend (`bpa_web`)**:
- `app/staff/(larkon)/branch/[branchId]/clinic/queue/_components/QueueTicketsTable.jsx` — V2 Start button fix, V3 remove misleading Call action, V4 Open Visit → visit detail
- `app/staff/(larkon)/branch/[branchId]/clinic/intake/[appointmentId]/page.jsx` — V5 Add to Queue button + appointment status badge

### Remaining Known Issues (Deferred)

| # | Item | Reason |
|---|------|--------|
| V-defer-1 | `QueueTicketsTable` — `prompt()`/`confirm()` dialogs for Assign Doctor, Set Priority, Cancel | Pre-existing; separate UX polish task |
| V-defer-2 | No per-ticket "Call" endpoint | Would require new backend route; current "Call Next" workflow is correct |
| V-defer-3 | `handleNoShowTicket`/`handleCancelTicket` on queue console both map to `skipTicket` | Queue-level no-show tracking; appointment NO_SHOW must be done from Appointments tab |
