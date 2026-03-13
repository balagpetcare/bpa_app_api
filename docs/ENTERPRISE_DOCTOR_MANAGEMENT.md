# Enterprise Doctor Management

Summary of clinic-level doctor credential review, service assignment with roles, schedule board, and approval flow.

## 1. DoctorCredential (clinic-level credential review)

- **Model**: `DoctorCredential` — branch-scoped; fields: doctorId (BranchMember), branchId, licenseNumber, authority, expiryDate, documentUrl, status (PENDING | UNDER_REVIEW | APPROVED | REJECTED), reviewedBy, reviewedAt.
- **Flow**: Doctor or manager uploads/creates credential (POST `/api/v1/clinic/branches/:branchId/doctors/:memberId/credentials`). Manager can set UNDER_REVIEW or submit for owner approval (POST `.../credentials/:credentialId/submit-approval`), which creates a `ClinicApprovalRequest` with type `DOCTOR_CREDENTIAL`. Owner approves/rejects via existing owner or staff decide endpoint; apply handler updates `DoctorCredential.status` and reviewedBy/reviewedAt.
- **Credentials queue**: `GET .../doctors/credentials-queue` returns platform-level lists (missing, pending, expiringSoon, rejected) plus branch-level lists (credentialsPending, credentialsUnderReview, credentialsApproved, credentialsRejected, credentialsExpiringSoon).

## 2. Service assignment with role

- **Schema**: `DoctorServiceMapping` has optional `role` (SURGEON | CONSULTANT | ASSISTANT). Service matrix and per-doctor services API include `role`; PUT service-matrix and PUT doctors/:memberId/services accept `role`.
- **Approval**: `DOCTOR_SERVICE_PRIVILEGE` apply handler passes `role` into `upsertDoctorServiceMapping`.

## 3. Schedule board

- **API**: `GET .../doctors/schedule-board?from=&to=` returns doctors, templates, exceptions, and **appointments** (branchId, doctorId in memberIds, scheduledStartAt in range, status not CANCELLED). Appointments include id, doctorId, serviceId, scheduledStartAt, scheduledEndAt, status, ownerNameSnapshot, petNameSnapshot, tokenNo.
- **UI**: Staff schedule-board page shows weekly templates and an appointments timeline table.

## 4. Doctor availability

- **Schema**: No new table; `DoctorScheduleTemplate` is used (slotDuration → slotMinutes, maxAppointments → maxSlots).
- **UI**: Staff availability page shows weekly slots (from schedule-board) with slot duration and max appointments, plus leave sections.

## 5. Pending approvals

- **Type**: `DOCTOR_CREDENTIAL` added to `ClinicApprovalRequestType`. Staff pending-approvals queue and owner approval list include it.
- **Apply**: On APPROVED, `applyDoctorCredential` sets DoctorCredential status to APPROVED and reviewedBy/reviewedAt. On REJECTED, decide flow updates DoctorCredential to REJECTED and sets reviewedBy/reviewedAt.

## 6. Role permissions (summary)

- **Owner**: Approve credentials, service assignment, schedule via existing ClinicApprovalRequest decide (owner or staff route).
- **Manager**: clinic.doctors.invite, clinic.doctors.manage_services, clinic.doctors.manage_leave, clinic.doctors.manage_credentials, clinic.schedule.manage; can create DOCTOR_CREDENTIAL approval requests.
- **Doctor**: View/update own schedule via GET/PUT `/api/v1/doctor/clinics/:branchId/my-schedule`; accept appointments via existing appointment flow.

## Touch points

| Area           | Backend | Frontend |
|----------------|--------|----------|
| Credential     | schema DoctorCredential, staffDoctorManagement.service, clinicApprovalRequest.service (apply + reject), clinicApprovalTypes.ts, clinic.routes | credentials/page.tsx, api.ts |
| Service role   | DoctorServiceMapping.role, getServiceAssignmentMatrix, upsertDoctorServiceMapping, applyDoctorServicePrivilege | service-assignment (role dropdown) |
| Schedule board | getScheduleBoard (appointments) | schedule-board/page.tsx (timeline) |
| Availability   | DoctorScheduleTemplate (existing) | availability/page.tsx (weekly slots table) |
| Approvals      | DOCTOR_CREDENTIAL type, apply + reject in decide | approvals/page.tsx, owner approval UI |
