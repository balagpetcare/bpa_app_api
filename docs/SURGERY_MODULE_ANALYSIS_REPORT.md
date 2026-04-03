# STEP A — Surgery Module Compatibility Analysis Report

## 1. Current Relevant Modules/Files Already Present

### Backend (backend-api)

| Area | Files / Models |
|------|------------------|
| **Schema** | `prisma/schema.prisma` — Service, BranchRoom, ClinicalCase, Appointment, Visit, SurgeryPackage, ProcedureOrder, InventoryConsumption, ClinicInvoice, DoctorSettlementLedger, DoctorSettlementBatch, CaseCostSheet, DoctorContractRule, DoctorServiceFee, SurgeryPackageTemplate |
| **Clinic routes** | `src/api/v1/modules/clinic/clinic.routes.ts` — base `/api/v1/clinic`, branch-scoped `branches/:branchId/...` |
| **Clinic controller** | `clinic.controller.ts`, `clinicEnterprise.controller.ts` — appointments, visits, packages, billing, settlement |
| **Clinic services** | `appointment.service.ts`, `patient.service.ts`, `emr.service.ts`, `billing.service.ts`, `package.service.ts`, etc. |
| **Doctor module** | `doctor.routes.ts`, `doctor.controller.ts` — doctor-centric appointments/visits |
| **Permissions** | `prisma/seeders/seedRolesPermissions.ts` — permissions array + roles; clinic.* keys (no clinic.surgery.* yet) |
| **Middleware** | `clinic.middleware.ts` — `requireClinicPermission(perm1, perm2, ...)` |
| **Placeholder FKs** | `DispenseRequest.surgeryCaseId`, `MedicationAdministration.surgeryCaseId` (Int? with no relation) |

### Frontend (bpa_web)

| Area | Path |
|------|------|
| Staff clinic | `app/staff/(larkon)/branch/[branchId]/clinic/` — appointments, intake, visits, patients, medicine-control, billing |
| Doctor panel | `app/doctor/(larkon)/appointments/`, `visits/` |
| Branch nav | `src/lib/branchSidebarConfig.ts` |
| API client | `lib/api.ts` |

---

## 2. What Can Be Reused

- **Service** — category SURGERY, otRequired, estimatedCostJson, allowedRoomTypes; no change.
- **BranchRoom** — as OT rooms (roomType "SURGERY"), cleaningBufferMinutes, operationalStatus; add `surgeryCases` relation only.
- **SurgeryPackageTemplate** — itemsJson, surgeryType; extend with preopChecklistJson, defaultStaffRolesJson, postopInstructionsJson.
- **ClinicInvoice** — doctorFeeAmount, clinicShareAmount, consumableCost; add surgeryCaseId, anesthesiaCharge, otCharge, equipmentCharge, labCharge, billingStatus.
- **DoctorSettlementLedger** — caseId, packageId, doctorShare, clinicShare; add surgeryCaseId, staffRole.
- **InventoryConsumption + ConsumptionItem** — PLANNED/ACTUAL, clinicalCaseId, procedureOrderId; link via ClinicalCase created for surgery when needed.
- **CaseCostSheet** — directCost, doctorShare, clinicShare, snapshotJson; used via ClinicalCase.
- **DoctorContractRule / DoctorServiceFee** — fee rules; snapshot at surgery case creation.
- **Clinic routes pattern** — `requireClinicPermission`, `req.clinicBranchId`, branch isolation.
- **Billing flow** — existing Order + ClinicInvoice + collect payment; surgery will create/attach Order when finalizing.
- **Doctor panel** — same auth and branch/doctor context for surgery list/detail.

---

## 3. What Must Be Added

### Schema

- **New enums:** SurgeryCaseStatus, SurgeryCasePriority, SurgeryStaffRole.
- **New models:** SurgeryCase, SurgeryCaseStaff, SurgeryCaseStatusLog, SurgeryCaseChecklist.
- **New relations on existing models:** Appointment, Visit, ClinicalCase, Branch, BranchMember, Service, SurgeryPackage, BranchRoom, Pet, Organization, User (patient, createdBy, updatedBy, statusLog changedBy, checklist completedBy).
- **Extensions:** ClinicInvoice (surgeryCaseId + charge columns + billingStatus), DoctorSettlementLedger (surgeryCaseId, staffRole), SurgeryPackageTemplate (checklist/staff/postop JSON).
- **Optional back-relations:** DispenseRequest, MedicationAdministration (already have surgeryCaseId; add relation when SurgeryCase exists).

### Backend

- New clinic routes: `GET/POST /branches/:branchId/surgeries`, `GET/PATCH/POST status /branches/:branchId/surgeries/:id`, staff, checklist, consumables, estimate, billing, payouts.
- New doctor routes: `GET /doctor/surgeries`, `GET /doctor/surgeries/:id`, `PATCH notes`, `POST start`, `POST complete`.
- New services: surgery.service.ts (CRUD, status guard, case number), surgeryBilling.service.ts, surgeryPayout.service.ts.
- New controller: surgery.controller.ts (or handlers in clinic.controller).
- Permission keys: clinic.surgery.read, clinic.surgery.create, clinic.surgery.manage, clinic.surgery.notes.write, clinic.surgery.billing, clinic.surgery.payout, clinic.surgery.reports.
- Seed: add surgery permissions and assign to OWNER / BRANCH_MANAGER (and optionally RECEPTIONIST) as per architecture.

### Frontend

- Staff: `/clinic/surgeries`, `/clinic/surgeries/new`, `/clinic/surgeries/[id]` (tabbed workspace).
- Doctor: `/doctor/surgeries`, `/doctor/surgeries/[id]`.
- Sidebar: surgery nav under clinic.
- API helpers in `lib/api.ts` for surgery endpoints.

---

## 4. Conflicts / Risks / Migration Concerns

### Resolved / No Blockers

- **SurgeryCase vs ClinicalCase:** Architecture is hybrid: SurgeryCase is the surgery lifecycle; ClinicalCase remains for charges/collection. SurgeryCase has optional clinicalCaseId. When creating a surgery case from appointment/visit, we can create or link ClinicalCase as today. No conflict.
- **ProcedureOrder:** Stays for procedure-level tracking; SurgeryCase has its own status. Optional: later link ProcedureOrder to SurgeryCase if needed. Not required for Phase 1.
- **DispenseRequest / MedicationAdministration:** Already have surgeryCaseId; adding relation to SurgeryCase is additive. No breaking change.
- **Naming:** SurgeryCase, SurgeryCaseStaff, etc. match doc; Prisma camelCase, DB snake_case via @@map — consistent with existing.

### Risks to Mitigate

- **Case number uniqueness:** Format `SRG-{branchCode}-{YYMMDD}-{seq}` — require branch code or branchId in generator and unique constraint on caseNumber.
- **Status transition guard:** Must be enforced in service layer; invalid transitions return 4xx and do not write status or status log.
- **Pricing snapshot:** On create, store pricingSnapshotJson and feeRuleSnapshotJson; edits only with clinic.surgery.manage to avoid accidental overwrite.
- **Migration order:** Add enums first, then SurgeryCase and related tables, then new columns on ClinicInvoice/DoctorSettlementLedger/SurgeryPackageTemplate; then back-relations on Appointment, Visit, etc. Prisma migration will generate one migration; run once.

### Permission Gaps

- Current seeds do not include clinic.surgery.*. Adding them and assigning to OWNER and BRANCH_MANAGER (and appropriate clinic roles) is required so UI and API are consistent.

### Route Collisions

- No collision: `/branches/:branchId/surgeries` is new; no existing route uses `surgeries`. Doctor panel `/doctor/surgeries` is new.

---

## 5. Recommended Execution Order

1. **Phase 1 (schema + master + skeleton)**  
   - Add enums and models (SurgeryCase, SurgeryCaseStaff, SurgeryCaseStatusLog, SurgeryCaseChecklist).  
   - Extend ClinicInvoice, DoctorSettlementLedger, SurgeryPackageTemplate.  
   - Add relations on Appointment, Visit, ClinicalCase, Branch, BranchMember, Service, SurgeryPackage, BranchRoom, Pet, Organization, User; add SurgeryCase relation to DispenseRequest and MedicationAdministration.  
   - Create migration, run `prisma migrate`.  
   - Add surgery permissions to seed and run seed (or document manual step).  
   - Add surgery routes (list, get, create, update, status) and surgery.service.ts + surgery.controller.ts with branch/org checks and status guard.  
   - Master setup: reuse GET services (surgery filter), GET rooms (OT); no new tables.

2. **Phase 2 (workflow + staff + consumables)**  
   - Staff assignment APIs; checklist APIs; consumables plan/reserve/consume/reverse (via InventoryConsumption + ClinicalCase/ProcedureOrder or surgery-scoped helper).  
   - Timeline/audit (SurgeryCaseStatusLog).

3. **Phase 3 (billing + payout)**  
   - Estimate/finalize billing (ClinicInvoice + Order), payment collection; payout generation (DoctorSettlementLedger), snapshot strategy; report-ready structures.

4. **Phase 4 (UI + permissions + reports)**  
   - Surgery list, create wizard, detail workspace (tabs); doctor surgery list/detail; role-aware actions; empty/loading/error states; sidebar and API client; docs and hardening.

---

## Conclusion

- **No blocking conflict** identified. Existing clinic, billing, inventory, and doctor patterns can be reused; SurgeryCase is additive and wraps/links to existing entities as per architecture.  
- Proceed with Phase 1 implementation (schema, migrations, permissions, surgery CRUD + status guard + master setup).
