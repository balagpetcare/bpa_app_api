# Collect Payment — "Appointment not found" diagnosis

## Verification result for appointment #8 (DB check)

A direct DB check was run (see script in "Data validation" below). Result:

- **Appointment #8 exists.**  
  `id: 8, branchId: 5, orgId: 1, status: PRE_BOOKED, paymentStatus: UNPAID, patientId: null, petId: null`
- **Branch of appointment:** `{ id: 5, orgId: 1, name: 'Bala G Pet Clinic, Gulshan' }`
- **UI branch 5:** same branch (id 5, orgId 1).
- **Eligible for collect-payment on branch 5?** **true** (data is correct).

So the failure was **not** due to missing appointment or wrong branch/org in the database. The underlying cause was a **backend guard bug**: when the service called `requireAppointmentInBranch` with a custom `select: { id: true, paymentStatus: true }`, the guard did not include `orgId` and `branchId` in the select. The guard then compared `appointment.orgId` and `appointment.branchId` (both `undefined`) to the request context, so the check always failed and it threw "Appointment not found." This is fixed in the guard (see "Changes made" below). No data correction was required.

---

## Summary

When **Collect Payment** for an appointment (e.g. #8) returns:

> "This appointment could not be found (it may have been removed or is not available in this branch)."

the backend has determined that the appointment either **does not exist** or **does not belong to the current branch/org**. The UI message is correct; the underlying cause is one of the two below.

---

## Root cause (exact)

The failure comes from the **backend guard** `requireAppointmentInBranch` in `appointments/appointmentGuards.ts`. It throws **"Appointment not found"** in these cases:

1. **No row** – No appointment exists with the given `appointmentId` (e.g. 8).
2. **Branch/org mismatch** – An appointment with that id exists but `appointment.orgId !== orgId` or `appointment.branchId !== branchId` for the branch in the URL.
3. **(Bug, fixed)** **Custom select omitted orgId/branchId** – When the caller passed `select: { id: true, paymentStatus: true }` (e.g. from `collectAppointmentPayment`), the guard used that select and did not add `orgId`/`branchId`. The fetched row then had `appointment.orgId` and `appointment.branchId` as `undefined`, so the comparison always failed. Fixed by merging the caller’s select with `{ orgId: true, branchId: true }` in the guard.

So for appointment #8 the failure was (3). In general, failures can be:

- **Data:** Appointment 8 is missing, or its `branchId`/`orgId` do not match the branch you’re on (e.g. you’re on branch 5 but appointment 8 belongs to another branch or org), or  
- **Stale list:** The list was loaded when the appointment was in this branch, then the appointment was moved/deleted elsewhere and the list wasn’t refreshed before clicking Pay.

The **list and search APIs are branch-scoped** (they filter by `branchId`), so if you see the row on the current branch’s page, the row was at some point valid for this branch. The only way to get "not found" on collect-payment is: the appointment no longer exists, or it no longer belongs to this branch/org.

---

## Classification

| Possibility              | Meaning |
|--------------------------|--------|
| **Real data issue**      | Appointment 8 missing or has wrong `branchId`/`orgId` in DB. |
| **Branch mismatch**      | Same as above: backend sees appointment 8 with a different branch (or org). |
| **Stale modal state**    | List showed the row from an earlier load; appointment was moved/deleted elsewhere before Pay; no frontend bug, refresh fixes it. |
| **Backend guard issue**  | Not a bug: the guard correctly rejects when appointment is missing or not in branch; the only fix was to return **404** instead of 400 for this case (see below). |

---

## Exact files and functions

### Frontend

- **Page / modal state:**  
  `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx`  
  - Pay button sets `setPayModalApt(a)` where `a` is the row from `(searchResults?.items ?? appointments)`.  
  - Both list and search are called with the page’s `branchId` (from `params.branchId`).
- **API call:**  
  `bpa_web/lib/api.ts` — `staffClinicAppointmentCollectPayment(branchId, appointment.id, { amount, method })`  
  - Sends: `POST /api/v1/clinic/branches/:branchId/appointments/:appointmentId/collect-payment`  
  - Uses the same `branchId` from the route and `appointment.id` from the selected row.
- **Error display:**  
  The modal shows the backend error message; it treats messages containing `"appointment not found"` as not-found and shows the friendly text plus optional "Refresh list".

### Backend

- **Route:**  
  `backend-api/src/api/v1/modules/clinic/clinic.routes.ts`  
  - `POST /branches/:branchId/appointments/:appointmentId/collect-payment`
- **Controller:**  
  `backend-api/src/api/v1/modules/clinic/clinic.controller.ts` — `exports.collectAppointmentPayment`  
  - Reads `req.clinicBranchId`, `req.clinicBranch` (orgId), `req.params.appointmentId`, validates amount/method, calls `appointmentService.collectAppointmentPayment(..., { orgId, branchId })`.  
  - **Previously:** catch always returned **400** with `e?.message`.  
  - **Now:** if `e?.statusCode === 404`, returns **404** with message "Appointment not found or not available in this branch." (see Change 1 below).
- **Service:**  
  `backend-api/src/api/v1/modules/clinic/appointment.service.ts` — `collectAppointmentPayment`  
  - Calls `requireAppointmentInBranch(appointmentId, orgId, branchId)` then updates payment; no extra status/pet checks for collect-payment.
- **Guard:**  
  `backend-api/src/api/v1/modules/clinic/appointments/appointmentGuards.ts` — `requireAppointmentInBranch`  
  - `findUnique` with a **merged select** that always includes `orgId` and `branchId` (so the branch check is valid when callers pass a custom select). If no row or `orgId`/`branchId` mismatch → throws `AppointmentNotFoundError("Appointment not found")` with `statusCode = 404`.

---

## Data validation: how to verify appointment #8

You can run the script `scripts/verify-appointment-8.ts` (or the inline snippet below) in the backend repo to inspect an appointment and branch:

```bash
cd backend-api
npx ts-node scripts/verify-appointment-8.ts
```

Or inline (change `yourBranchId` if needed):

```bash
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const apt = await prisma.appointment.findUnique({ where: { id: 8 }, select: { id: true, branchId: true, orgId: true, status: true, paymentStatus: true, patientId: true, petId: true } });
  console.log('Appointment 8:', apt || 'NOT FOUND');
  if (apt) {
    const branch = await prisma.branch.findUnique({ where: { id: apt.branchId }, select: { id: true, orgId: true, name: true } });
    console.log('Branch of appointment:', branch);
    const yourBranchId = 5;
    const yourBranch = await prisma.branch.findUnique({ where: { id: yourBranchId }, select: { id: true, orgId: true, name: true } });
    console.log('Your branch (e.g. 5):', yourBranch);
    const match = yourBranch && apt.branchId === yourBranch.id && apt.orgId === yourBranch.orgId;
    console.log('Eligible for collect-payment on your branch?', match);
  }
  await prisma.\$disconnect();
}
run();
"
```

Interpretation:

- **Appointment 8: NOT FOUND** → Real data: appointment was deleted or never existed.
- **Appointment exists but `branchId` or `orgId` differs from your branch** → Branch/org mismatch (e.g. appointment belongs to another branch); collect-payment correctly fails for the branch in the URL.
- **Appointment exists, same branchId and orgId** → If you still get "not found", double-check the branch id in the URL when you click Pay (e.g. you might be on branch 5 but the list was from another tab/branch). Refreshing the list and trying again is recommended.

---

## Changes made

### 1. Backend guard: always include orgId/branchId in select (done)

**File:** `backend-api/src/api/v1/modules/clinic/appointments/appointmentGuards.ts`  
**Function:** `requireAppointmentInBranch`

- **Before:** When the caller passed a custom `select` (e.g. `{ id: true, paymentStatus: true }` from `collectAppointmentPayment`), the guard used it as-is. The returned row then lacked `orgId` and `branchId`, so the branch check compared `undefined` to the request context and always threw.
- **After:** The guard merges the caller’s select with `{ orgId: true, branchId: true }` so the branch check always has the required fields. No change to callers; they still receive the fields they asked for plus `orgId` and `branchId`.

This was the **root cause** for appointment #8: the data was correct; the guard incorrectly failed when given a custom select.

### 2. Backend: return 404 for appointment-not-found (done)

**File:** `backend-api/src/api/v1/modules/clinic/clinic.controller.ts`  
**Function:** `collectAppointmentPayment` catch block  

- **Before:** All errors from collect-payment were returned as **400** with `e?.message`.  
- **After:** If `e?.statusCode === 404`, the controller returns **404** with message:  
  `"Appointment not found or not available in this branch."`  
  and error code `APPOINTMENT_NOT_FOUND`.  
- Other errors (e.g. validation, payment already collected) still return 400.

This makes the API semantically correct and keeps the frontend message compatible (the modal already treats "appointment not found" as not-found).

### 3. Frontend

No code change was required. The modal already:

- Uses the same `branchId` from the route and `appointment.id` from the row (list and search are branch-scoped).  
- Shows the backend message and treats "appointment not found" as not-found with a suggestion to close and refresh the list.

If the issue was stale state, refreshing the list and trying again is the right fix.

---

## If the backend message is misleading

The guard intentionally uses the same message for "no row" and "wrong branch" to avoid leaking whether an id exists in another branch. The **controller** now returns a single, clear message for both cases:

- **"Appointment not found or not available in this branch."**

So the backend message is no longer misleading; the frontend can continue to show it or the existing friendly copy.

---

## Quick checklist

- [x] Ran DB verification for appointment 8: exists, branchId 5, orgId 1, eligible for branch 5.  
- [x] Root cause: guard bug (custom select omitted orgId/branchId); fixed in `appointmentGuards.ts`.  
- [x] No data correction required.  
- [x] Backend returns 404 for not-found/wrong-branch; guard fix ensures collect-payment succeeds when data is correct.
