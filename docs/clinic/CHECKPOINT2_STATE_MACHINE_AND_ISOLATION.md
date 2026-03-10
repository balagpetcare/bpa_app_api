# Checkpoint 2: State Machine + Branch Isolation — Summary & QA

## Changed files and why

| File | Change |
|------|--------|
| `src/api/v1/modules/clinic/appointments/appointmentStateMachine.ts` | **New.** Central state machine: `canTransition(fromStatus, action)`, `assertTransition(fromStatus, action)` (throws `InvalidTransitionError` with statusCode 409), allowed transitions for CREATE, CONFIRM, CHECK_IN, CANCEL, NO_SHOW, RESCHEDULE, etc. |
| `src/api/v1/modules/clinic/appointments/appointmentGuards.ts` | **New.** `requireAppointmentInBranch({ appointmentId, orgId, branchId })` — loads appointment, verifies orgId/branchId match; throws `AppointmentNotFoundError` (404) if not found or mismatch. |
| `src/api/v1/modules/clinic/appointment.service.ts` | **Refactor.** All appointmentId-based mutations now take `context: { orgId, branchId }`. Each calls `requireAppointmentInBranch` first, then `assertTransition(currentStatus, action)`, then performs update. Removed local CANCELLABLE_STATUSES / NO_SHOW_STATUSES / CHECKIN_FROM_STATUSES. `checkInAppointment` returns appointment with patientId, petId, doctorId for queue. Reschedule conflict check scoped by branchId. |
| `src/api/v1/modules/clinic/clinic.controller.ts` | **Refactor.** Cancel, reschedule, no-show, check-in pass `{ orgId: branch.orgId, branchId: Number(branchId) }` to service. Catch block: if `e?.statusCode === 404` return 404; if `e?.statusCode === 409` return 409 with INVALID_STATUS_TRANSITION; else 400. |
| `src/api/v1/modules/clinic/queue.service.ts` | **Refactor.** `checkInAndIssueTicket` no longer fetches appointment or checks status; calls `appointmentService.checkInAppointment(appointmentId, userId, { orgId, branchId })` and uses returned appointment for `issueTicket`. |

## QA steps

### Happy path (branch 2)

1. **Create** — POST create appointment for branch 2 → 201, status BOOKED.
2. **Check-in** — POST check-in that appointment → 200, ticket in response.
3. **Cancel** — Create another appointment, POST cancel (do not check-in) → 200.
4. **No-show** — Create another, POST no-show (do not check-in) → 200.
5. **Reschedule** — Create another, POST reschedule with new slot → 201, new appointment BOOKED.

### Invalid transitions (must return 409)

1. **Cancel after check-in** — Create, check-in, then POST cancel same id → **409** with message like "Invalid transition: cannot CANCEL when status is CHECKED_IN".
2. **No-show after check-in** — Same idea → **409**.
3. **Check-in when CANCELLED** — Create, cancel, then POST check-in same id → **409**.

### Cross-branch (must return 404)

1. Create an appointment in **branch A** (note its id).
2. Using a session that has access only to **branch 2**, call:
   - POST `/api/v1/clinic/branches/2/appointments/<id_from_branch_A>/cancel`
   - POST `/api/v1/clinic/branches/2/appointments/<id_from_branch_A>/check-in`
   - POST `/api/v1/clinic/branches/2/appointments/<id_from_branch_A>/no-show`
   - POST `/api/v1/clinic/branches/2/appointments/<id_from_branch_A>/reschedule` with body.
3. Each must return **404** "Appointment not found" (no leak that it exists in another branch).

## cURL examples (localhost:3000, cookie auth)

Replace `BRANCH_ID`, `APPOINTMENT_ID`, and cookie/session as needed.

**Check-in**

```bash
curl -s -X POST "http://localhost:3000/api/v1/clinic/branches/2/appointments/APPOINTMENT_ID/check-in" \
  -H "Content-Type: application/json" \
  -b "your_session_cookie" \
  -d '{}'
```

**Cancel**

```bash
curl -s -X POST "http://localhost:3000/api/v1/clinic/branches/2/appointments/APPOINTMENT_ID/cancel" \
  -H "Content-Type: application/json" \
  -b "your_session_cookie" \
  -d '{"reason":"Patient requested"}'
```

**No-show**

```bash
curl -s -X POST "http://localhost:3000/api/v1/clinic/branches/2/appointments/APPOINTMENT_ID/no-show" \
  -H "Content-Type: application/json" \
  -b "your_session_cookie" \
  -d '{}'
```

**Reschedule**

```bash
curl -s -X POST "http://localhost:3000/api/v1/clinic/branches/2/appointments/APPOINTMENT_ID/reschedule" \
  -H "Content-Type: application/json" \
  -b "your_session_cookie" \
  -d '{"scheduledStartAt":"2026-03-10T10:00:00.000Z","scheduledEndAt":"2026-03-10T10:15:00.000Z"}'
```

For 409: use an appointment that is already CHECKED_IN and call cancel or no-show.  
For 404: use an appointment id that belongs to another branch and call any of the above with branch 2 in the path.

## Security regression checklist

- [x] All appointmentId mutations enforce org+branch match via `requireAppointmentInBranch` (cancel, reschedule, no-show, check-in; check-in path via queue.service → appointment.service.checkInAppointment with context).
- [x] No API response shape changes: success responses unchanged; only new error cases 404/409 with existing `success: false`, `message`, `code`.
- [x] No permission key changes: still `clinic.appointments.read`, `clinic.appointments.manage`, `clinic.queue.manage` where applicable.
- [x] Cross-branch attempt returns 404, not 403, to avoid leaking existence of the appointment in another branch.
