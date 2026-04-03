# BPA Clinic Enterprise Execution Plan

Execute remaining backend work, frontend integration, and enterprise review for BPA Clinic in three sequential phases.

## Phase 1: Backend Completion (Phase 2 from Master Plan)

### 1.1 Queue Token Concurrency Fix
**Problem:** Token generation in `queue.service.ts` has race condition - concurrent check-ins can fail with P2002 unique constraint violation.

**Solution:**
- Add retry logic in `issueTicket` function to handle P2002 errors
- Wrap retry in try-catch with max 3 attempts
- Add exponential backoff (50ms, 100ms, 200ms)
- Log concurrent collision events for monitoring

**Files:**
- `src/api/v1/modules/clinic/queue.service.ts` - Add retry wrapper around ticket creation

### 1.2 Appointment List Pagination & Indexing
**Problem:** No hard limit on pagination, missing composite indexes for common queries.

**Solution:**
- Add input validation (Zod schema) for list queries: `limit` max 100, `offset` >= 0
- Add database indexes:
  - `(branchId, scheduledStartAt)` for date-based lists
  - `(doctorId, scheduledStartAt)` for doctor schedules
  - `(branchId, status, scheduledStartAt)` for filtered lists

**Files:**
- `src/api/v1/modules/clinic/appointment.service.ts` - Add validation
- `prisma/migrations/YYYYMMDD_add_appointment_indexes/migration.sql` - New migration

### 1.3 Appointment Events Endpoint
**Problem:** Events exist in DB but no API endpoint to retrieve them.

**Solution:**
- Add `GET /api/v1/clinic/branches/:branchId/appointments/:appointmentId/events`
- Permission: `clinic.appointments.read`
- Return `AppointmentEvent` rows ordered by `createdAt DESC`

**Files:**
- `src/api/v1/modules/clinic/clinic.controller.ts` - Add `getAppointmentEvents` handler
- `src/api/v1/modules/clinic/appointment.service.ts` - Add `getAppointmentEvents` service function
- `src/api/v1/modules/clinic/clinic.routes.ts` - Mount new route

## Phase 2: Frontend Integration

### 2.1 Wire EnterpriseAppointmentWizard to Backend APIs
**Current State:** Wizard UI exists but not connected to backend.

**Tasks:**
- Create `clinicApi.ts` with typed API client functions:
  - `searchPatients(branchId, query)` → `/api/v1/clinic/branches/:branchId/patients/search`
  - `getServices(branchId)` → `/api/v1/clinic/branches/:branchId/services`
  - `getDoctors(branchId, serviceId?)` → `/api/v1/clinic/branches/:branchId/doctors`
  - `getSlots(branchId, date, doctorId?, serviceId?)` → `/api/v1/clinic/branches/:branchId/slots`
  - `getPricePreview(branchId, data)` → `/api/v1/clinic/branches/:branchId/appointments/price-preview`
  - `createAppointment(branchId, data)` → `POST /api/v1/clinic/branches/:branchId/appointments`
- Update wizard step components to call these APIs
- Add loading/error states

**Files:**
- `bpa_web/lib/clinicApi.ts` - NEW
- `bpa_web/src/components/booking/EnterpriseAppointmentWizard.tsx` - Wire API calls
- Individual step components - Connect to API

### 2.2 Integrate Navigation & Permissions
**Tasks:**
- Add clinic appointment wizard to Staff Panel sidebar (permission: `clinic.appointments.manage`)
- Create appointment list page at `/staff/branch/[branchId]/clinic/appointments`
- Add "New Appointment" button that opens wizard modal
- Ensure sidebar only shows when `featuresJson.clinicEnabled === true`

**Files:**
- `bpa_web/src/lib/branchSidebarConfig.ts` - Add clinic appointments menu item
- `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.tsx` - NEW or UPDATE

### 2.3 Detail Pages (Minimal)
**Required Pages:**
- Appointment detail drawer (shows appointment info + events timeline)
- Queue ticket detail (shows token, status, wait time)

**Files:**
- `bpa_web/src/components/clinic/AppointmentDetailDrawer.tsx` - NEW
- `bpa_web/src/components/clinic/QueueTicketCard.tsx` - NEW

### 2.4 Error States
**Tasks:**
- Add error boundaries for clinic routes
- Display user-friendly messages for common errors:
  - 403 CLINIC_MODULE_DISABLED → "Clinic module disabled by owner"
  - 404 → "Appointment not found"
  - 409 INVALID_STATUS_TRANSITION → "Cannot perform this action in current status"
- Add toast notifications for success/error

**Files:**
- Update existing error handling in wizard and list components

## Phase 3: Enterprise Review

### 3.1 Backend/Frontend Contract Alignment
**Review:**
- Verify all wizard API calls match backend routes
- Check request/response types match TypeScript interfaces
- Ensure error codes are handled consistently

**Checklist:**
- [ ] Patient search API contract
- [ ] Services list API contract
- [ ] Doctors list API contract
- [ ] Slots API contract
- [ ] Price preview API contract
- [ ] Create appointment API contract
- [ ] Appointment events API contract

### 3.2 Pricing & Discount Safety
**Review:**
- Ensure all pricing calculations are backend-driven (no hardcoded prices in frontend)
- Verify discount application logic is in `billing.service.ts` or `discount.service.ts`
- Check that frontend only displays prices from API responses
- Validate that `PricePreview` type matches backend response

**Files to Audit:**
- `src/api/v1/modules/clinic/billing.service.ts`
- `src/api/v1/modules/clinic/discount.service.ts`
- `src/api/v1/modules/clinic/consultationFee.service.ts`
- Frontend: `PriceSummaryCard.tsx`, `DoctorSelector.tsx`

### 3.3 Doctor Payout & Settlement Logic
**Review:**
- Verify doctor settlement calculations are in backend only
- Check `doctorSettlement.service.ts` and `doctorContract.service.ts`
- Ensure frontend does not compute payouts
- Validate audit trail for all settlement transactions

**Files to Audit:**
- `src/api/v1/modules/clinic/doctorSettlement.service.ts`
- `src/api/v1/modules/clinic/doctorContract.service.ts`
- `src/api/v1/modules/clinic/consultationFee.service.ts`

### 3.4 Emergency/Custom Billing Handling
**Review:**
- Check emergency appointment pricing overrides
- Verify custom billing approval workflow
- Ensure `emergencyApproval.service.ts` and `exceptionOverride.service.ts` are properly integrated
- Validate that emergency cases have proper audit trail

**Files to Audit:**
- `src/api/v1/modules/clinic/emergencyApproval.service.ts`
- `src/api/v1/modules/clinic/exceptionOverride.service.ts`
- `src/api/v1/modules/clinic/billing.service.ts`

### 3.5 Route, Permission & Detail Page Completeness
**Review:**
- Verify all clinic routes have proper permission guards
- Check that all CRUD operations have corresponding audit events
- Ensure detail pages show complete information (no missing fields)
- Validate that all status transitions are logged

**Checklist:**
- [ ] All routes use `requireClinicPermission` middleware
- [ ] All mutations write to `AuditLog` via `writeClinicAudit`
- [ ] All detail pages show events/timeline
- [ ] All state transitions use `AppointmentStateMachine`

### 3.6 Backward Compatibility & Auditability
**Review:**
- Ensure no breaking changes to existing POS/inventory/pharmacy modules
- Verify all clinic mutations are auditable
- Check that legacy appointment endpoints (if any) still work
- Validate that clinic data is properly isolated by branch

**Checklist:**
- [ ] No changes to non-clinic Prisma models
- [ ] All clinic operations scoped by `orgId` + `branchId`
- [ ] Audit trail includes `before` and `after` snapshots
- [ ] No regression in existing staff/owner panel features

## Implementation Rules

1. **Backward Compatibility:** No breaking changes to existing modules
2. **Minimal Changes:** Only touch files directly related to the task
3. **Modular Structure:** Keep service/controller/route separation
4. **No Unrelated Refactors:** Resist the urge to "clean up" unrelated code
5. **Backend-Driven Logic:** All pricing, settlement, and business logic stays in backend
6. **No Redesign:** Keep existing UI structure and patterns
7. **Audit Everything:** All mutations must write to audit log
8. **Permission Guards:** All routes must check permissions

## Success Criteria

### Backend
- [ ] Queue token generation handles concurrency (no P2002 failures)
- [ ] Appointment list has pagination validation and proper indexes
- [ ] Appointment events endpoint returns timeline
- [ ] All new endpoints have tests (or manual curl verification)
- [ ] Migration runs successfully

### Frontend
- [ ] Wizard creates appointments successfully
- [ ] All API calls have loading/error states
- [ ] Sidebar shows clinic menu when enabled
- [ ] Detail pages display complete information
- [ ] Error messages are user-friendly

### Review
- [ ] No hardcoded pricing or settlement logic in frontend
- [ ] All financial calculations are backend-driven
- [ ] Audit trail is complete for all operations
- [ ] No breaking changes to existing modules
- [ ] Permission guards are in place

## Estimated Effort
- Phase 1 (Backend): 2-3 hours
- Phase 2 (Frontend): 3-4 hours
- Phase 3 (Review): 1-2 hours
- **Total: 6-9 hours**

## Blockers & Risks
- **Concurrency Testing:** Queue token retry logic needs load testing (manual verification acceptable)
- **API Contract Mismatches:** May discover missing backend endpoints during frontend integration
- **Permission Scope:** Need to verify which permissions already exist vs. need to be added

## Documentation Updates
All documentation updates will be placed in `/docs`:
- Update `/docs/clinic/CHECKPOINT1_APPOINTMENTS_INVENTORY_AND_ANALYSIS.md` with new events endpoint
- Create `/docs/clinic/PHASE2_COMPLETION_SUMMARY.md` with implementation details
- Update `/docs/plans/CLINIC_ENTERPRISE_IMPLEMENTATION_MASTER_PLAN.md` to mark Phase 2 complete
