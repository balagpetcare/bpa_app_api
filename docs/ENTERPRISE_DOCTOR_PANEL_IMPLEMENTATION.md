# Enterprise Doctor Panel – Implementation Summary

This document summarizes the implementation of the Enterprise Doctor Panel architecture (onboarding fix, no-clinic handling, Doctor Request workflow, and UI updates).

## 1. Onboarding redirect fix

- **Schema**: `DoctorVerification.onboardingCompleted` (Boolean, default false) added in migration `20260311120000_add_doctor_onboarding_completed`. Existing VERIFIED doctors are backfilled to `onboardingCompleted = true`.
- **Backend**: `GET /api/v1/doctor/me` now returns `onboardingCompleted` and `displayName`. `POST /api/v1/doctor/onboarding/complete` (no branch) sets profile-level onboarding completed. Admin approval of doctor verification also sets `onboardingCompleted = true`.
- **Frontend**: `app/doctor/layout.jsx` redirect logic no longer uses per-branch `onboardingStatus`. Redirect to `/doctor/verification` only when `onboardingCompleted === false`. Per-clinic onboarding does not trigger redirect.

## 2. Doctor without clinic (no error)

- **Backend**: Unchanged; `getMe` and `getDashboardSummary` already support zero branches when the user has DoctorVerification.
- **Frontend**: Dashboard shows a "No Clinic Connected" card when `branches.length === 0`, with link to invitations. Clinic-only widgets (KPI, schedule, queue, patients, follow-ups, cases, prescriptions, earnings, performance, My Clinics) are hidden when there is no clinic. Profile, Documents, Availability, and Invitations remain available.

## 3. Doctor Request workflow

- **Schema**: New model `DoctorRequest` (doctorUserId, branchId, type, payload, status, approvedByUserId, approvedAt, rejectionNote) and enums `DoctorRequestType`, `DoctorRequestStatus`. Migration `20260311130000_add_doctor_requests`.
- **Doctor API**: `GET /api/v1/doctor/requests`, `POST /api/v1/doctor/requests` (branchId, type, payload). Service: `doctorRequest.service.ts` (listForDoctor, create, listForBranch, approve, reject). On approve, VISIT_FEE_CHANGE updates `ClinicStaffProfile.defaultConsultationFee`, APPOINTMENT_CANCEL calls appointment.service.cancelAppointment, LEAVE_CLINIC sets profile status INACTIVE.
- **Owner/Clinic API**: `GET /api/v1/owner/clinic/branches/:branchId/doctor-requests`, `POST .../doctor-requests/:requestId/approve`, `POST .../doctor-requests/:requestId/reject`. Handlers in `ownerClinic.controller.ts`.

## 4. UI

- **Owner**: New page `app/owner/(larkon)/clinic/[branchId]/doctor-requests/page.tsx` listing requests with Approve/Reject. Link from clinic doctors page ("Doctor requests").
- **Doctor**: New "Clinics" menu item and page `app/doctor/(larkon)/clinics/page.tsx` (active clinics + invitations widget). `doctorListRequests` and `doctorCreateRequest` in `lib/api.ts` for future use.

## 5. Optional / not done

- **DoctorClinicMembership** table: Not added; pending invitations come from `/me/invitations`, active clinics from `getMe.branches`.
- **Notifications** for request approved/rejected: Can be added later via doctorNotification.service.
- **requireClinicMembership** middleware: Clinic-scoped doctor endpoints already return empty or 403 when the doctor has no branch membership; no new middleware added.

## Touch points

| Area        | Files |
|------------|--------|
| Schema     | prisma/schema.prisma, migrations 20260311120000, 20260311130000 |
| Doctor API | doctor.controller.ts, doctor.service.ts, doctor.routes.ts, doctorRequest.service.ts |
| Owner API  | owner.routes.ts, ownerClinic.controller.ts |
| Doctor UI  | app/doctor/layout.jsx, app/doctor/(larkon)/dashboard/page.tsx, app/doctor/(larkon)/clinics/page.tsx, permissionMenu.ts, lib/api.ts |
| Owner UI   | app/owner/(larkon)/clinic/[branchId]/doctor-requests/page.tsx, app/owner/(larkon)/clinic/[branchId]/doctors/page.tsx |
