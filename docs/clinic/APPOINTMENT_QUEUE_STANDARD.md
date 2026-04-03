# Clinic Appointment & Queue Standard

This document describes the BPA Clinic appointment, queue, and visit lifecycles, permission matrix, API summary, and QA checklist.

---

## 1. State machines

### 1.1 Appointment lifecycle

```
[BOOKED] ──check-in──► [CHECKED_IN]
    │                        │
    ├──cancel───────────────► [CANCELLED]
    ├──no-show───────────────► [NO_SHOW]
    └──reschedule────────────► [BOOKED] (new slot)

From CHECKED_IN: queue ticket is created; ticket flow continues separately.
```

- **BOOKED** / **CONFIRMED**: Scheduled; can check-in, cancel, reschedule, or mark no-show.
- **CHECKED_IN**: Patient checked in; a queue ticket is created (or linked).
- **CANCELLED** / **NO_SHOW**: Terminal; no further actions.

### 1.2 Queue ticket lifecycle

```
[CREATED] ──► [WAITING] ──call next──► [CALLED] ──start──► [IN_SERVICE] ──complete──► [COMPLETED]
                  │                         │
                  └──skip──────────────────► [SKIPPED]
```

- **CREATED**: Ticket issued (walk-in or from check-in).
- **WAITING**: In queue; can be called next or skipped.
- **CALLED**: Called to consult; can start service.
- **IN_SERVICE**: Consultation in progress; can complete.
- **COMPLETED** / **SKIPPED**: Terminal.

### 1.3 Visit lifecycle

```
[CHECKED_IN] ──start──► [IN_PROGRESS] ──complete──► [COMPLETED]
      │                       │
      └──────────────────────┴── (vitals, notes, prescriptions, billing)
```

- Visit can be created from queue (ticket start) or independently.
- **CHECKED_IN**: Visit created, not yet started.
- **IN_PROGRESS**: Consultation active; EMR updates (vitals, SOAP, attachments) apply.
- **COMPLETED**: Visit closed; billing and follow-up can be recorded.

---

## 2. Permission matrix

All clinic routes are under `/api/v1/clinic/branches/:branchId/...` and require auth plus one of the listed permissions. Scoping is by `orgId` + `branchId`.

| Permission | Slots | Appointments CRUD | Check-in | Cancel/No-show | Queue session | Queue tickets | Screen |
|------------|-------|-------------------|----------|----------------|---------------|---------------|--------|
| clinic.appointments.read | ✓ | list/get | — | — | — | — | — |
| clinic.appointments.manage | ✓ | create/update | ✓ | ✓ | — | — | — |
| clinic.queue.manage | — | — | ✓ | — | open/close | issue, call next, skip, start, complete, priority | ✓ |
| clinic.queue.screen | — | — | — | — | get session | list tickets | ✓ |

| Permission | Patients | EMR (visits, vitals, notes) | Templates | Prescriptions | Billing | Lab | Reports |
|------------|----------|-----------------------------|-----------|---------------|---------|-----|---------|
| clinic.patients.read | list/get | — | — | — | — | vaccinations/deworm read | certificate |
| clinic.patients.manage | register/update | — | — | — | — | — | — |
| clinic.emr.read | — | list/get visits | list/get | — | summary, orders | list requisitions | dashboard |
| clinic.emr.write | — | create/update, vitals, notes, attachments, discharge | apply | — | create invoice | — | — |
| clinic.prescription.read | — | — | — | list/get/verify | order-lines | — | — |
| clinic.prescription.write [RETIRED] | — | — | — | **Not used by clinic Rx routes** — registry/seed only; use `create`/`edit`/`finalize` + DOCTOR middleware for authoring; dispense: `medicine.dispense.issue` | — | — | — |
| clinic.lab.read | — | — | — | — | — | list by visit | — |
| clinic.lab.write | — | — | — | — | — | create requisition, add report | — |
| clinic.overview.read | — | — | — | — | — | — | dashboard |

**Role mapping (typical):**

- **BRANCH_MANAGER**: Full clinic permissions (appointments, queue, patients, EMR, prescription, lab, overview).
- **CLINIC_STAFF**: Operational subset (appointments.manage, queue.manage, queue.screen, patients, EMR, prescription as configured). Owner controls assignment via branch access.

---

## 3. API reference summary

Base: `GET/POST/PATCH` to `/api/v1/clinic/branches/:branchId/...`. All require authentication and appropriate clinic permission.

### Slots & Appointments

| Method | Path | Description |
|--------|------|-------------|
| GET | /slots | Available slots (date, doctorId, serviceId) |
| GET | /appointments | List appointments (date, doctorId, status, limit, offset) |
| GET | /appointments/:appointmentId | Get one appointment |
| POST | /appointments | Create appointment |
| POST | /appointments/:id/check-in | Check-in (creates/links queue ticket) |
| POST | /appointments/:id/cancel | Cancel |
| POST | /appointments/:id/reschedule | Reschedule |
| POST | /appointments/:id/no-show | Mark no-show |

### Queue session & tickets

| Method | Path | Description |
|--------|------|-------------|
| GET | /queue/session | Get/create session (date) |
| POST | /queue/session/open | Open session |
| POST | /queue/session/close | Close session (body: sessionId) |
| GET | /queue/tickets | List tickets (date, status) |
| POST | /queue/tickets | Issue ticket (walk-in) |
| POST | /queue/tickets/:id/assign-doctor | Assign doctor |
| POST | /queue/tickets/:id/priority | Set priority |
| POST | /queue/next | Call next (optional doctorId) |
| POST | /queue/tickets/:id/skip | Skip |
| POST | /queue/tickets/:id/start | Start service |
| POST | /queue/tickets/:id/complete | Complete |
| GET | /queue/screen | PII-safe screen payload (token + status only) |

### Patients (pets)

| Method | Path | Description |
|--------|------|-------------|
| GET | /patients | List (limit, offset, search) |
| GET | /patients/owner-lookup | Owner lookup |
| GET | /patients/unique/:uniquePetId | Get by unique pet ID |
| GET | /patients/:petId | Get patient |
| POST | /patients | Register patient |
| PATCH | /patients/:petId | Update patient |

### EMR (visits, vitals, notes, attachments)

| Method | Path | Description |
|--------|------|-------------|
| GET | /visits | List (petId, patientId, limit, offset) |
| GET | /visits/:visitId | Get visit |
| POST | /visits | Create visit |
| PATCH | /visits/:visitId | Update visit |
| POST | /visits/:visitId/vitals | Add vital |
| POST | /visits/:visitId/notes | Add clinical note (SOAP etc.) |
| POST | /visits/:visitId/attachments | Add attachment |
| POST | /visits/:visitId/apply-template | Apply consultation template |
| POST | /visits/:visitId/discharge | Add discharge note |

### Consultation templates

| Method | Path | Description |
|--------|------|-------------|
| GET | /consultation-templates | List |
| GET | /consultation-templates/:id | Get one |
| POST | /consultation-templates | Create |
| PATCH | /consultation-templates/:id | Update |

### Prescriptions & medicine

| Method | Path | Description |
|--------|------|-------------|
| GET | /visits/:visitId/prescriptions | List by visit |
| POST | /visits/:visitId/prescriptions | Create prescription |
| GET | /prescriptions/verify/:qrToken | Get by QR token |
| GET | /prescriptions/:id | Get prescription |
| POST | /prescriptions/:id/finalize | Finalize |
| POST | /prescriptions/:id/dispense | Dispense |
| GET | /medicine-search | Search medicine (q, limit) |
| GET | /prescriptions/:id/order-lines | Order lines for billing |

### Billing

| Method | Path | Description |
|--------|------|-------------|
| GET | /visits/:visitId/billing-summary | Billing summary |
| GET | /visits/:visitId/orders | Visit orders |
| POST | /visits/:visitId/create-invoice | Create invoice from visit |

### Vaccinations & deworming

| Method | Path | Description |
|--------|------|-------------|
| GET | /patients/:petId/vaccinations | List vaccinations |
| GET | /patients/:petId/vaccinations/next-due | Next due |
| POST | /vaccinations | Record vaccination |
| GET | /vaccinations/certificate/:token | Certificate by token |
| GET | /patients/:petId/deworming | List deworming |
| POST | /deworming | Record deworming |

### Lab

| Method | Path | Description |
|--------|------|-------------|
| POST | /lab/requisitions | Create requisition |
| GET | /visits/:visitId/lab-requisitions | List by visit |
| POST | /lab/requisitions/:id/report | Add report (abnormal flags, items) |

### Service deliveries

| Method | Path | Description |
|--------|------|-------------|
| POST | /visits/:visitId/service-deliveries | Record delivery |
| GET | /visits/:visitId/service-deliveries | List by visit |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | /reports/dashboard | Dashboard summary (dateFrom, dateTo): visitCount, orderCount, revenue |

---

## 4. QA checklist

- **Double-booking**: Slot engine excludes already-booked slots; concurrent create for same doctor+slot should result in one success and one failure (or validation error). Verify with two concurrent requests.
- **Token uniqueness**: Walk-in tokens are branch+date+sequence; no duplicate token numbers per session. Verify by issuing multiple tickets and checking tokenNo.
- **Staff without permissions**: User without `clinic.queue.manage` cannot open/close session or change priority; without `clinic.appointments.manage` cannot check-in/cancel/no-show. Verify 403 for restricted endpoints.
- **Waiting screen PII**: GET `/queue/screen` returns only token number and status (and optional priority); no patient name, phone, or identifier. Verify response payload and UI.
- **Org/branch isolation**: Every query is scoped by branchId (and orgId); user cannot access another branch’s data. Verify by using a different branchId with same auth.
- **Audit events**: Cancel, reschedule, no-show, check-in, queue session open/close, ticket priority change, call next, skip, start, complete should write to clinic audit log. Verify audit records exist after each action.

---

## 5. Manual test steps

1. **Appointments**: Create appointment for a branch; list by date; check-in (expect queue ticket); cancel and no-show from UI; confirm status changes.
2. **Queue**: Open session for branch+date; issue walk-in ticket; call next; start then complete ticket; close session. Confirm ticket states and screen payload (token only).
3. **Visits**: Create visit (or from check-in); add vitals and SOAP note; add attachment URL; apply template; add discharge note; confirm on visit detail.
4. **Prescriptions**: From visit, create prescription with items; finalize; dispense; verify by QR token.
5. **Billing**: Load visit billing summary and orders; create invoice with customer and line items; confirm order appears.
6. **Reports**: Call dashboard summary with date range; confirm visitCount, orderCount, revenue for completed visits/orders in range.

---

*Last updated to align with clinic routes and permissions in backend-api (56 endpoints, 22+ clinic permissions).*
