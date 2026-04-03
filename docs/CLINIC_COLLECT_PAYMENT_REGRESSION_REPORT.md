# Regression check: requireAppointmentInBranch fix

**Context:** The guard was fixed to always merge `orgId` and `branchId` into the select so branch validation works when callers pass a custom select (e.g. collect-payment with `{ id, paymentStatus }`).

**Date:** After guard fix.

---

## Actions tested (unit tests)

| # | Action | Test | Result |
|---|--------|------|--------|
| 1 | **Collect Payment** (appointment #8, branch 5 style) | Guard with `select: { id, paymentStatus }` and matching row → returns appointment | **PASS** |
| 2 | **Assign Doctor** | Guard with `select: { id, doctorId, status }` and matching row → returns appointment | **PASS** |
| 3 | Other appointment actions using guard | Default select (no custom) → merged select includes orgId/branchId, returns appointment | **PASS** |
| 4 | **Wrong-branch appointment** | Row with different branchId/orgId → throws AppointmentNotFoundError (404) | **PASS** |
| 5 | **Missing appointment id** | findUnique returns null → throws AppointmentNotFoundError (404) | **PASS** |
| 6 | **Caller compatibility** | Returned object has requested fields + orgId/branchId; caller using only paymentStatus (or doctorId, status, etc.) does not break | **PASS** |

All 7 tests in `src/api/v1/modules/clinic/appointments/appointmentGuards.test.ts` passed.

---

## All callers of requireAppointmentInBranch (verified no breakage)

| Caller (appointment.service.ts) | Select used | Uses returned fields | Extra keys (orgId, branchId) safe? |
|---------------------------------|-------------|----------------------|-------------------------------------|
| promoteAppointment | id, status, doctorId | apt.status, (data) | Yes |
| cancelAppointment | id, status | apt.status | Yes |
| confirmAppointment | id, status, roomId | apt.status, apt.roomId | Yes |
| rescheduleAppointment | id, status, orgId, branchId, … | old.* (already had orgId/branchId) | Yes (no change) |
| markNoShow | id, status | apt.status | Yes |
| checkInAppointment | id, status, patientId, petId, doctorId | apt.status, apt.patientId, apt.petId | Yes |
| assignDoctor | id, doctorId, status | apt.doctorId | Yes |
| collectAppointmentPayment | id, paymentStatus | apt.paymentStatus | Yes |

No caller relies on the returned object having *only* the requested keys; they all use specific fields. Adding `orgId` and `branchId` does not break any of them.

---

## Live API checks (optional)

If the API and DB are up and you have a valid session:

1. **Collect Payment for appointment #8 on branch 5**  
   `POST /api/v1/clinic/branches/5/appointments/8/collect-payment` with body `{ "amount": 100, "method": "CASH" }`  
   → Expected: 200 and payment recorded (or 400 if already PAID/WAIVED).

2. **Assign Doctor for a valid appointment on the correct branch**  
   `POST /api/v1/clinic/branches/:branchId/appointments/:appointmentId/assign-doctor` with body `{ "doctorId": <valid> }`  
   → Expected: 200 when appointment is in that branch.

3. **Wrong branch**  
   Use an appointment that belongs to branch A and call with branch B in the URL.  
   → Expected: 404, "Appointment not found or not available in this branch."

4. **Missing appointment id**  
   Use a non-existent appointment id.  
   → Expected: 404.

---

## Summary

- **Exact actions tested (unit):** Guard with collect-payment-style select, assign-doctor-style select, default select; missing id; wrong branch; wrong org; caller compatibility.
- **Pass/fail:** All 7 regression tests **PASS**.
- **Remaining caller that fails:** None; all callers verified.
- **Additional backend or frontend fix needed:** No. The guard fix is sufficient; no further code changes required.
