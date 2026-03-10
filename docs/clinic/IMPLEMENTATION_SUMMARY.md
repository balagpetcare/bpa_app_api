# Clinic Setup Remainder — Implementation Summary

This document summarizes the implementation of the Clinic Setup & Structure Phase-1 remainder (CP1–CP7) as specified in the plan.

## Completed checkpoints

### CP1 — Data model: BranchRoom
- **Schema**: `BranchRoom` model in `prisma/schema.prisma` (orgId, branchId, name, roomType, capacity, status, notes).
- **Migration**: `prisma/migrations/20260302160000_add_branch_rooms/migration.sql`.

### CP2 — Owner clinic rooms API
- **Endpoints**: GET/POST `/api/v1/owner/clinic/branches/:branchId/rooms`, PATCH/DELETE `.../rooms/:roomId`.
- **Permission**: `clinic.rooms.manage`.
- **Audit**: CLINIC_ROOM_CREATE, CLINIC_ROOM_UPDATE, CLINIC_ROOM_DEACTIVATE via `auditWriter`.

### CP3 — Owner UI: Rooms
- **Page**: `bpa_web/app/owner/(larkon)/clinic/[branchId]/rooms/page.tsx` (list, add, edit, deactivate/reactivate).
- **API client**: `ownerClinicRooms`, `ownerClinicRoomCreate`, `ownerClinicRoomUpdate`, `ownerClinicRoomDelete` in `ownerApi.ts`.
- **Menu**: Rooms under Clinic (required `clinic.rooms.manage`). Quick link on clinic branch dashboard.

### CP4 — ClinicStaffProfile + staff profile APIs & UI
- **Schema**: `ClinicStaffProfile` (branchMemberId, staffType, licenseNumber, specializationTags, defaultConsultationFee, visiting, status).
- **Migration**: `prisma/migrations/20260302170000_add_clinic_staff_profile/migration.sql`.
- **APIs**: GET/PUT `.../staff/:memberId/profile`. `listClinicStaff` extended with profile summary.
- **Permission**: `clinic.staff.manage`.
- **UI**: Staff list shows profile summary; `staff/[memberId]/page.tsx` for profile editor and role template assignment.

### CP5 — Schedule templates, holidays, emergency policy
- **Schema**: `DoctorScheduleTemplate`, `RoomScheduleTemplate`, `BranchHoliday`. Emergency policy in `Branch.clinicSettingsJson.emergencySlotPolicy`.
- **Migrations**: `20260302180000_add_clinic_schedule_templates`, `20260302190000_add_branch_holidays`.
- **APIs**: GET/PUT schedule templates, GET/POST/DELETE holidays, GET/PUT policy/emergency.
- **Permissions**: `clinic.schedule.manage`, `clinic.holidays.manage`, `clinic.emergency.manage`.
- **UI**: `clinic/[branchId]/schedule/page.tsx` (templates display, holidays CRUD, emergency policy form).

### CP6 — Fees config
- **Storage**: `Branch.clinicSettingsJson.fees.serviceOverrides` (array of { serviceId, fee }). Doctor fee on `ClinicStaffProfile.defaultConsultationFee`.
- **APIs**: GET/PUT `.../fees`. Permission: `clinic.fees.manage`.
- **UI**: `clinic/[branchId]/fees/page.tsx` (doctor fees note, service overrides add/remove).

### CP7 — Role templates & permission overrides
- **Constants**: `CLINIC_ROLE_TEMPLATE_PERMISSIONS` in `branchRoles.ts` (CLINIC_DOCTOR, CLINIC_NURSE, CLINIC_RECEPTION, CLINIC_LAB, CLINIC_GROOMER, CLINIC_MANAGER).
- **Resolver**: `resolveBranchAccessProfile` in `branchAccessPermission.service.ts` now merges `BranchAccessPermission.permissionOverrides` into computed permissions (additive).
- **API**: POST `.../staff/:memberId/assign-template` (body: `{ templateKey }`). Sets `ClinicStaffProfile.staffType` and `BranchAccessPermission.permissionOverrides` when row exists.
- **Audit**: CLINIC_ROLE_TEMPLATE_ASSIGN.
- **UI**: Staff profile page “Assign role template” dropdown and button.

## Permissions registered
- clinic.rooms.manage  
- clinic.staff.manage  
- clinic.schedule.manage  
- clinic.holidays.manage  
- clinic.emergency.manage  
- clinic.fees.manage  

(Already present: clinic.overview.read, clinic.settings.read/write, clinic.services.manage.)

## Touch points (main files)
- **Backend**: `prisma/schema.prisma`, migrations under `prisma/migrations/`, `ownerClinic.service.ts`, `ownerClinic.controller.ts`, `owner.routes.ts`, `permissionsRegistry.service.ts`, `seedRolesPermissions.ts`, `branchRoles.ts`, `branchAccessPermission.service.ts`.
- **Frontend**: `ownerApi.ts`, `permissionMenu.ts`, `clinic/[branchId]/page.tsx`, `rooms/page.tsx`, `staff/page.tsx`, `staff/[memberId]/page.tsx`, `schedule/page.tsx`, `fees/page.tsx`.

## Notes
- All mutations use `entityType: "BRANCH"` and entityId patterns like `${branchId}:room:${roomId}` in audit.
- Clinic remains a Branch capability; all data scoped by orgId + branchId.
- No new `AuditEntityType` enum values; no breaking changes to POS/shop flows.
