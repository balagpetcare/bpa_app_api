# Staff/Branch Doctor Details – Gap Analysis & Implementation Plan

**Target page:** `/staff/branch/:branchId/clinic/doctors/:doctorId?tab=...`  
**Date:** 2025-03-11

---

## 1. Current Implemented State

| Area | Status | Notes |
|------|--------|--------|
| Page & URL | COMPLETE | `?tab=` sync, 10 tabs, refreshTrigger, branch/member scoped |
| Overview tab | COMPLETE | Readiness, summaries, quick links |
| Credentials tab | COMPLETE | Documents, verification, expiry |
| Services tab | COMPLETE | Assign/unassign, delete mapping, toasts, permission |
| Packages tab | COMPLETE | Assign/remove, delete mapping |
| Schedule tab | PARTIAL | Templates full CRUD; **exceptions read-only** |
| Fees tab | COMPLETE | Propose, overrides, settlement |
| Performance tab | PARTIAL | KPIs, 7/30/90 days; **no utilization, no custom from/to** |
| Leave tab | PARTIAL | Add leave, list; **no affected-appointments count, no cancel/approve** |
| Approvals tab | PARTIAL | **Read-only** history; no approve/reject from staff |
| Audit tab | PARTIAL | Table; **no actor display name** |
| DoctorProfileHeader | PARTIAL | Back to list only; **no quick actions** |
| Backend getDoctorSchedule | COMPLETE | Returns templates + exceptions |
| Backend schedule exception CRUD | MISSING | No create/update/delete for DoctorScheduleException |
| Backend approval decide | OWNER ONLY | Owner has PUT /owner/approval-requests/:id/decide; no staff branch-scoped decide |
| Backend getDoctorAuditLog | COMPLETE | Returns items; **no actor display name** |
| Backend doctor status (activate/suspend) | MISSING | No dedicated API to set ClinicStaffProfile.status |
| Backend leave affected count | MISSING | getDoctorLeave does not return affectedAppointmentsCount |
| Permissions | COMPLETE | clinic.doctors.view, clinic.schedule.manage, etc. used |

---

## 2. Remaining Gaps (Classification)

- **Schedule exceptions:** PARTIAL → need full CRUD (create/edit/delete) in backend + Schedule tab UI; audit; conflict validation optional.
- **Approval history actions:** PARTIAL → need staff-scoped decide endpoint (approvals.manage) + ApprovalsTab approve/reject + confirmation + remark for reject.
- **Audit actor:** PARTIAL → include actor display name in getDoctorAuditLog (batch User/profile lookup); AuditTimelinePanel Actor column.
- **DoctorProfileHeader quick actions:** MISSING → Edit profile, Activate, Suspend, Reactivate, Assign Services, Edit Schedule, Add Leave, Change Fee, View Credentials; need status update API.
- **Performance:** PARTIAL → utilization rate (approximation from templates + appointments); custom date range (from/to); keep existing KPIs.
- **Leave impact:** PARTIAL → affected appointments count per leave; show warning; optional cancel leave (and approve if staff allowed).

---

## 3. Risks

- **Approval decide:** Reusing same `clinicApprovalRequest.decide()` from staff route is safe; must validate request.branchId matches staff’s branch and permission `approvals.manage`.
- **Doctor status (activate/suspend):** Changing ClinicStaffProfile.status affects booking; must audit and optionally enforce “only ACTIVE/INACTIVE” to avoid invalid values.
- **Schedule exception overlap:** Validation against weekly template and existing appointments improves UX but is non-trivial; can ship CRUD first and add conflict check as enhancement.
- **Leave cancel/approve:** Cancel may require business rule (e.g. only PENDING); Approve is often owner-only—wire only if policy allows staff to approve DOCTOR_LEAVE.

---

## 4. Best Implementation Plan

1. **Backend – Schedule exceptions**  
   Add: `createDoctorScheduleException`, `updateDoctorScheduleException`, `deleteDoctorScheduleException` in staffDoctorManagement.service; controller + routes; audit on create/update/delete; branch + doctor validation.

2. **Backend – Staff approval decide**  
   Add: PUT `/branches/:branchId/approval-requests/:requestId/decide` (body: `decision`, `rejectReason?`); require `approvals.manage`; ensure request.branchId === branchId and status === PENDING; call existing `decide()`.

3. **Backend – Audit actor**  
   In `getDoctorAuditLog`, after fetching items, batch-load User profile displayName by `changedByUserId`; attach `changedByDisplayName` to each item (no schema change).

4. **Backend – Doctor status**  
   Add: PATCH `/branches/:branchId/doctors/:memberId/status` (body: `status: "ACTIVE" | "INACTIVE"`); update ClinicStaffProfile.status; audit; validate branch + member.

5. **Backend – Leave affected count**  
   In `getDoctorLeave`, for each leave resolve doctor’s memberId (from profile), count Appointment in branch for that doctor in leave date range (status not CANCELLED); add `affectedAppointmentsCount` to each leave item. Optional: leave cancel (update status to CANCELLED for PENDING) if allowed.

6. **Backend – Performance**  
   In `getDoctorPerformance`, optional: compute approximate “expected slots” from templates × days; utilization = completed / expected (or keep simple completion rate). Accept `from`/`to` (already does).

7. **Frontend – Schedule tab**  
   Exceptions: Add Create/Edit/Delete modals; call new exception APIs; permission `clinic.schedule.manage`; refetch on success; empty/loading/error states.

8. **Frontend – Approvals tab**  
   For PENDING items: Approve/Reject buttons; confirmation; reject reason if required; call staff decide API; refresh list on success.

9. **Frontend – Audit tab**  
   AuditTimelinePanel: add Actor column; use `changedByDisplayName ?? changedByUserId ?? "—"`.

10. **Frontend – DoctorProfileHeader**  
    Pass `onTabChange`, `permissions`, `profile`; add quick action buttons (Activate/Suspend/Reactivate via status API; others switch tab); permission- and status-aware.

11. **Frontend – Performance tab**  
    Add custom date range (from/to); display utilization if API returns it; keep existing KPIs.

12. **Frontend – Leave tab**  
    Show `affectedAppointmentsCount` per leave; warning when > 0; optional Cancel (and Approve) if APIs exist and permission allows.

---

## 5. Files to Change

### Backend (backend-api)

- `src/api/v1/services/staffDoctorManagement.service.ts` – exception CRUD, getDoctorAuditLog actor, getDoctorLeave affected count, getDoctorPerformance utilization (optional), updateDoctorStatus.
- `src/api/v1/modules/clinic/staffDoctorManagement.controller.ts` – exception handlers, status handler, (decide may live in clinic.controller or new handler).
- `src/api/v1/modules/clinic/clinic.routes.ts` – routes for exception CRUD, status PATCH, staff approval decide.
- `src/api/v1/services/clinicApprovalRequest.service.ts` – no change (reuse decide).
- Optional: `src/api/v1/modules/clinic/clinic.controller.ts` – staff decide handler if not in staffDoctorManagement.

### Frontend (bpa_web)

- `app/staff/(larkon)/branch/[branchId]/clinic/doctors/[doctorId]/page.tsx` – pass onTabChange, permissions to header; ensure ApprovalsTab gets onRefresh.
- `src/components/clinic/doctors/DoctorProfileHeader.tsx` – quick actions (tabs + status API).
- `src/components/clinic/doctors/tabs/ScheduleTab.tsx` – exception CRUD UI.
- `src/components/clinic/doctors/tabs/ApprovalsTab.tsx` – approve/reject, confirm, remark.
- `src/components/clinic/doctors/AuditTimelinePanel.tsx` – Actor column.
- `src/components/clinic/doctors/tabs/PerformanceTab.tsx` – custom from/to, utilization.
- `src/components/clinic/doctors/tabs/LeaveTab.tsx` – affected count, warning, optional cancel.
- `lib/api.ts` – staffDoctorExceptionCreate/Put/Delete, staffDoctorStatusUpdate, staffApprovalDecide (staff-scoped).

---

## 6. Migration / API Impact

- **No Prisma migration** for these items (DoctorScheduleException, DoctorAuditLog, DoctorLeaveRequest, ClinicStaffProfile already exist).
- **New endpoints:** schedule exception create/update/delete; doctor status PATCH; staff approval-requests/:id/decide. Existing clients unaffected.
- **Response shape changes:** getDoctorAuditLog items gain `changedByDisplayName`; getDoctorLeave items gain `affectedAppointmentsCount`; getDoctorPerformance may gain `utilizationRate`. Frontend can remain backward-compatible by optional chaining.

---

## 7. Implementation Checklist (pre-coding)

- [x] Schedule exception CRUD backend
- [x] Schedule exception CRUD frontend (Schedule tab)
- [x] Staff approval decide endpoint + ApprovalsTab actions
- [x] Audit actor display name (API + AuditTimelinePanel)
- [x] Doctor status API + DoctorProfileHeader quick actions
- [x] Performance utilization + custom date range
- [x] Leave affected count + warning; optional cancel

---

## 8. Implemented (Summary)

- **Schedule exceptions:** Backend `createDoctorScheduleException`, `updateDoctorScheduleException`, `deleteDoctorScheduleException` with audit; routes POST/PUT/DELETE under `/doctors/:memberId/schedule/exceptions`; Schedule tab full CRUD modals, table with Edit/Delete, permission `clinic.schedule.manage`.
- **Approval actions:** Staff PUT `/branches/:branchId/approval-requests/:requestId/decide` (body: `decision`, `rejectReason?`), permission `approvals.manage`; ApprovalsTab Approve/Reject for PENDING, confirmation, reject reason modal, refresh on success.
- **Audit actor:** `getDoctorAuditLog` enriches items with `changedByDisplayName` via batch User/profile lookup; AuditTimelinePanel shows Actor column (display name or `#userId`).
- **Doctor status:** PATCH `/branches/:branchId/doctors/:memberId/status` (body: `status: ACTIVE | INACTIVE`), permission `clinic.doctors.manage`; DoctorProfileHeader quick actions: Assign services, Edit schedule, Add leave, Change fee, View credentials, Activate/Suspend with refresh.
- **Performance:** Backend returns `utilizationRate` (completed/total); Performance tab has custom date range (from/to) toggle and Utilization card.
- **Leave impact:** `getDoctorLeave` returns `affectedAppointmentsCount` per leave; Leave tab shows column and warning when any leave has affected appointments.
