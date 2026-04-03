# Surgery Module Workflow & Conventions

## Status lifecycle

- **DRAFT** → SCHEDULED | CANCELLED  
- **SCHEDULED** → PRE_OP | CANCELLED  
- **PRE_OP** → READY_FOR_OT | CANCELLED  
- **READY_FOR_OT** → IN_PROGRESS  
- **IN_PROGRESS** → POST_OP  
- **POST_OP** → COMPLETED  
- **COMPLETED** / **CANCELLED** → (terminal)

All transitions are logged in `SurgeryCaseStatusLog`.

## Emergency workflow

- Use **priority = EMERGENCY** when creating the case.
- No separate “emergency” status; the same status flow applies. Staff can filter by priority on the list.
- Optional: create case from walk-in or emergency intake and link appointment/visit when available.

## Consent & documents

- Consent and document upload are planned for a later phase.
- When implemented: link documents to `SurgeryCase` (e.g. consent form, pre-op checklist signed copy) via an attachments or documents table.

## Templates (SurgeryPackageTemplate)

- **preopChecklistJson**: default pre-op checklist items (e.g. `[{ "label": "NPO confirmed", "required": true }]`).
- **defaultStaffRolesJson**: default staff roles and optional fee (e.g. `[{ "role": "ANESTHETIST", "feeType": "FIXED", "feeValue": 500 }]`).
- **postopInstructionsJson**: post-op instructions (e.g. `[{ "instruction": "Rest 24h", "timing": "IMMEDIATE" }]`).

When creating a surgery case from a package, the UI can prefill checklist and staff from the template.

## Billing & payouts

- **Estimate**: creates an Order + ClinicInvoice linked to the surgery case with `billingStatus = ESTIMATE`.
- **Finalize**: sets `billingStatus = FINALIZED` and generates DoctorSettlementLedger entries for primary doctor and assigned staff (from fee rules / staff feeValue).
- Payouts are listed under the surgery case; batch settlement is handled by the existing settlement batch flow.

## Permissions

- `clinic.surgery.read` – view list and detail  
- `clinic.surgery.create` – create cases  
- `clinic.surgery.manage` – update, status, staff, checklist  
- `clinic.surgery.notes.write` – pre-op/operative/post-op notes (doctor panel uses manage/notes)  
- `clinic.surgery.billing` – create estimate, finalize bill  
- `clinic.surgery.payout` – view payouts, generate (if exposed)  
- `clinic.surgery.reports` – surgery revenue report  
