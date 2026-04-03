# Clinic Enterprise Implementation Master Plan

## 1. Current Status Summary
Phase 1 (Clinic Setup & Structure) is fully implemented. The Owner can enable clinic capabilities, configure settings, set up branches as clinics, manage services, staff profiles, rooms, schedules, and holidays. Branch isolation and basic state machines are in place. Staff Clinic Appointment workflows (V2 API) have been audited and updated for state machine constraints and branch isolation (Checkpoints 1 & 2). 

## 2. Reused Documents
- `/docs/clinic/CLINIC_SETUP_STRUCTURE_PLAN.md`
- `/docs/clinic/IMPLEMENTATION_SUMMARY.md`
- `/docs/clinic/CHECKPOINT1_APPOINTMENTS_INVENTORY_AND_ANALYSIS.md`
- `/docs/clinic/CHECKPOINT2_STATE_MACHINE_AND_ISOLATION.md`
- `/docs/clinic/OWNER_CONTROLLED_CLINIC_QA.md`
- `/docs/clinic/APPOINTMENTS_STAFF.md`
- `/docs/clinic/STAFF_CLINIC_STANDARD.md`

## 3. Remaining Work Phases

### Phase 2: Appointment Booking Engine & Queue Completion
- Complete Clinic Panel (3102) appointment booking workflows.
- Finalize queue token generation concurrency handling and robust retry logic.
- Pagination, indexing, and input validation improvements for appointment lists.

### Phase 3: Medical Records (EMR) & Treatment Workflows
- **EMR Setup:** Implement Patient EMR schemas (medical history, vitals, visit notes, historical tracking).
- **Prescriptions:** Digital prescription generation and pharmacy/inventory integration.
- **Treatment Workflows:** Seamless state transitions from Queue -> Consultation -> Lab/Surgery -> Pharmacy.

### Phase 4: Clinic Billing & Invoicing
- Unify clinic consultation fees (doctor specific & overrides), medicine costs, and lab/surgery costs into a consolidated branch invoice.
- Payment collection flow and synchronization with existing POS/wallet/ledger systems.

### Phase 5: Public Clinic Discovery
- Expose public-facing APIs for the Mother App.
- Allow pet owners to search clinics, view available services, and book appointments directly.

## 4. Dependencies
- EMR (Phase 3) depends on the Appointment and Queue Engine (Phase 2) completion to attach visit data.
- Billing (Phase 4) depends on EMR/Treatment Workflows (Phase 3) for accurate invoicing based on consumed services and medicines.
- Existing inventory/pharmacy modules must be stable for prescription integration.

## 5. Blockers
- No major blockers currently identified.
- Proper concurrency handling for queue tokens in Phase 2 needs careful implementation to prevent race conditions during high-volume check-ins.

## 6. Backend Tasks
- Implement EMR database schema (vitals, diagnoses, treatment plans) and related APIs.
- Enhance Queue token generation (unique constraint retry mechanisms).
- Build Treatment workflow controllers and integrate with `AppointmentStateMachine`.
- Develop Clinic Billing calculation engine.
- Expose Mother App discovery endpoints with appropriate caching and indexing.

## 7. Frontend Tasks
- **Clinic Panel / Staff Panel:** Build/refine appointment booking engine UI.
- **Staff Panel:** Implement Patient EMR views and treatment data entry components.
- **Staff Panel:** Add digital prescription builder UI.
- **Staff Panel:** Build Clinic Checkout/Billing UI with integrated payment options.

## 8. Review/Hardening Tasks
- E2E testing for the entire consultation lifecycle (Book -> Check-in -> Queue -> Consult -> Prescription -> Bill).
- Concurrency load testing for queue check-ins and appointment double-booking safeguards.
- Role-based access control (RBAC) security review ensuring strict branch isolation for medical data (EMR).
- Audit trail verification for all medical and billing records.

## 9. Cleanup Tasks
- Deprecate any legacy appointment/queue endpoints superseded by V2.
- Refactor duplicate logic in service catalogs if identified.
- Ensure all new components follow the standard `WINDSURF_GLOBAL_RULE.md` architecture.

## 10. Recommended Model and Mode
- **Phase 2 (Appointments/Queue):** Cascade (Architect mode) to finalize state machines and concurrency.
- **Phase 3 (EMR/Workflows):** Cascade (Architect mode) due to high complexity and database schema design.
- **Phase 4 (Billing):** Cascade (Implementation mode) relying on existing POS/Ledger patterns.
- **Phase 5 (Public Discovery):** Cascade (Implementation mode).
