# BPA/WPA Vaccination Module Current State & Implementation Plan

## 1. Executive Summary

The vaccination system partially exists.

The backend already has basic Prisma models for `VaccineType`, `Vaccination`, and `DewormingRecord`, plus clinic routes and services to list pet vaccinations, record a simple vaccination, calculate a next due date, look up a certificate token, and manage basic deworming records. The frontend also has a small standalone clinic vaccination page and a read-only staff patient profile vaccine tab.

However, this is not yet a complete BPA/WPA digital vaccination card system. The current implementation does not support branch-administered vaccine records, doctor/staff administered-by tracking, vaccine schedule rules, inventory batch deduction, billing/POS or clinic invoice linkage, real reminder scheduling, customer portal visibility, printable PDF cards, or public QR verification.

Recommended next step: implement the backend foundation first, with a modular vaccination domain that can read existing records while adding proper branch, inventory, billing, reminder, customer, and audit links.

## 2. Search Scope

Backend folders and files checked:

- `prisma/schema.prisma`
- `prisma/migrations`
- `prisma/seeders`
- `prisma/seed-data`
- `src/api/v1/app.ts`
- `src/app.ts`
- `src/api/v1/routes.ts`
- `src/api/v1/modules/clinic`
- `src/api/v1/modules/doctor`
- `src/api/v1/modules/notifications`
- `src/api/v1/modules/pets`
- `src/api/v1/modules/owner`
- `src/api/v1/modules/orders`
- `src/api/v1/modules/pos`
- `src/api/v1/modules/inventory`
- `src/api/v1/constants`
- `src/api/v1/services`

Frontend folders and files checked:

- `D:\BPA_Data\bpa_web\app\staff`
- `D:\BPA_Data\bpa_web\app\clinic`
- `D:\BPA_Data\bpa_web\app\doctor`
- `D:\BPA_Data\bpa_web\app\owner`
- `D:\BPA_Data\bpa_web\app\customer`
- `D:\BPA_Data\bpa_web\components`
- `D:\BPA_Data\bpa_web\lib\api.ts`
- `D:\BPA_Data\bpa_web\src\lib\branchSidebarConfig.ts`
- `D:\BPA_Data\bpa_web\src\lib\permissionMenu.ts`
- clinic, staff, owner, customer, pet profile, patient detail, doctor dashboard, and public marketing routes/components

Keywords checked:

- `vaccine`
- `vaccination`
- `immunization`
- `pet vaccine`
- `vaccine card`
- `rabies`
- `deworming`
- `reminder`
- `nextDueDate`
- `pet medical history`
- `patient medical record`
- `clinic record`
- `treatment record`

## 3. Existing Backend Findings

| Area | File path | What currently exists | Status | Risks or gaps |
|---|---|---|---|---|
| Prisma vaccine master | `prisma/schema.prisma` | `VaccineType` model with `name`, optional `targetAnimalTypeId`, `defaultIntervalDays`, and `description`. Linked to `AnimalType` and `Vaccination`. | Partial | Global name uniqueness only. No `orgId`, `branchId`, manufacturer catalog, active status, species schedule, clinical item mapping, inventory mapping, or CRUD API found. |
| Prisma vaccination record | `prisma/schema.prisma` | `Vaccination` model with `petId`, `vaccineTypeId`, `administeredAt`, `nextDueDate`, `batchNumber`, `vetClinic`, `notes`, `manufacturer`, and unique `certificateToken`. | Partial | Missing `orgId`, `branchId`, `customerId/ownerId`, administered doctor/staff, visit/appointment, inventory batch, invoice/order, record status, correction/void fields, and audit fields. |
| Prisma deworming record | `prisma/schema.prisma` | `DewormingRecord` model with pet, medication name, dosage, weight, administered date, next due date, and notes. | Partial | Basic standalone pet record only. No branch, staff, doctor, inventory, reminder, billing, or audit links. |
| Pet health/card fields | `prisma/schema.prisma` | `Pet` has `healthCardJson`, `qrCodeUrl`, `clinicRegisteredBranchId`, `medicalHistories`, `dewormingRecords`, and `vaccinations`. | Partial/unused | `healthCardJson` and `qrCodeUrl` are generic pet fields. No current vaccination card workflow was found using them. |
| Service category | `prisma/schema.prisma` | `ServiceCategory` enum includes `VACCINATION`. | Partial | Useful for clinic service catalog, but not connected to `Vaccination` records or vaccine administration. |
| Migration creating vaccine tables | `prisma/migrations/20260116192630_owner_profile_data/migration.sql` | Creates `vaccine_types`, `vaccinations`, and `deworming_records`. | Existing | Initial base tables only. They do not include branch, staff, inventory, billing, or reminder links. |
| Migration adding certificate/manufacturer | `prisma/migrations/20260302260000_vaccination_certificate_manufacturer/migration.sql` | Adds `manufacturer`, `certificateToken`, and indexes to `vaccinations`. | Partial | Certificate token exists, but no public verification route, QR generator, PDF card, revocation, or verification audit found. |
| Vaccination service | `src/api/v1/modules/clinic/vaccination.service.ts` | Provides `listByPet`, `getNextDueByPet`, `recordVaccination`, `getByCertificateToken`, `listDewormingByPet`, and `recordDeworming`. Derives `nextDueDate` from `VaccineType.defaultIntervalDays` when not provided. | Partial | No branch scoping or branch ownership verification inside the service. No inventory deduction, doctor/staff tracking, billing link, card model, update/correct/void, or reminder scheduling. |
| Clinic controller | `src/api/v1/modules/clinic/clinic.controller.ts` | Exposes controller handlers for pet vaccination list, next due, record vaccination, certificate lookup, deworming list, and record deworming. | Partial | Validation is inline and minimal. No separate validation schema found. `branchId` is route context but not used by vaccination service calls. |
| Clinic routes | `src/api/v1/modules/clinic/clinic.routes.ts` | Authenticated clinic routes exist for pet vaccinations, next due, recording vaccination, certificate token lookup, deworming list, and deworming create. | Partial | Routes are under branch URLs but data is not branch-scoped. Certificate lookup requires clinic auth and is not a public QR verification endpoint. |
| Route registration | `src/api/v1/routes.ts`, `src/app.ts` | Clinic module is mounted under `/api/v1/clinic` with country scope and auth guards. | Existing | No standalone public vaccination verification route found. |
| Staff clinical overview | `src/api/v1/modules/clinic/patient.service.ts` | `loadPatientClinicalOverviewData` includes pet vaccinations and future `vaccinationsNextDue`. Vaccine due items are included in patient alerts. | Partial | Overview checks patient branch scope before loading, but the vaccination query itself reads by `petId` only. No create/update/administer workflow. |
| Staff patient overview controller/route | `src/api/v1/modules/clinic/clinic.controller.ts`, `src/api/v1/routes.ts` | `getPatientClinicalOverview` exposes patient clinical overview for staff branch patient profile. | Partial | Read-only aggregation. Not a vaccination card API. |
| Doctor patient history | `src/api/v1/modules/doctor/doctor.service.ts`, `src/api/v1/modules/doctor/doctor.routes.ts` | Doctor patient history includes recent pet vaccinations with vaccine type names. | Partial | Read-only. No doctor vaccine administration or correction workflow. Vaccination rows are not branch-scoped by record because records have no branch. |
| Doctor reminders | `src/api/v1/modules/doctor/doctor.service.ts`, `src/api/v1/modules/doctor/doctor.controller.ts`, `src/api/v1/modules/doctor/doctor.routes.ts` | Doctor reminders count and fetch vaccination rows due by an end date for pets connected to that doctor/branch through visits. | Partial | It is a dashboard query, not a reminder engine. No notification records are created or sent. Query includes overdue items but is not a branch-wide vaccination dashboard. |
| Notification reminder stub | `src/api/v1/modules/notifications/notification.service.ts` | Has `REMINDER_TYPES` including `VACCINE_DUE`, but `queueReminder` is a TODO and `getPendingReminders` returns an empty list. | Partial/unused | No working vaccine reminder scheduling or delivery. Also, the Prisma `NotificationType` enum does not include `VACCINE_DUE`, so this stub cannot map directly to stored notifications without schema work. |
| Notification routes/controllers | `src/api/v1/modules/notifications` | Generic notification list/read/settings/test endpoints exist. | Existing | Not connected to vaccination due dates. |
| Clinical item vaccine catalog seed | `prisma/seeders/data/masterClinicalCatalogCategories.ts` | Adds a `vaccines` clinical catalog category for vaccination and immunization, inventory tracked and branch visible. | Partial | This seed belongs to the clinical item/inventory catalog, not to `VaccineType`. No bridge found between `ClinicalItem` vaccines and `VaccineType`. |
| Clinical vaccine items seed | `prisma/seeders/data/masterClinicalCatalogItems.ts` | Seeds `Rabies Vaccine`, `DHPP Vaccine`, and `Dewormer` as inventory-tracked clinical items with batch/expiry/cold-chain flags for vaccines. | Partial | Useful inventory catalog data, but not used by `recordVaccination`. No stock deduction or batch selection. |
| Clinical catalog templates | `prisma/seeders/data/masterClinicalCatalogTemplates.ts` | Includes a `vaccination-focused-clinic` template. | Partial | Template visibility only. Not tied to vaccine card records. |
| Veterinary master CSV | `prisma/seed-data/complete_veterinary_master_catalog.csv` | Contains many vaccine product names, including rabies, canine, feline, and livestock vaccines. | Existing seed source | Catalog/import source only. No direct vaccination card workflow. |
| Clinical stock services | `src/api/v1/modules/clinic/clinicalItemStock.service.ts`, `src/api/v1/modules/clinic/clinicalStockLedger.service.ts` | Generic branch stock, batch, ledger, consumption, and adjustment services exist. Ledger can decrement branch item batch quantity when a negative delta includes a `batchId`. | Existing | Not called by vaccination service. No vaccine-specific branch stock candidate API or administer-with-stock transaction. |
| Clinic item/stock routes | `src/api/v1/modules/clinic/clinic.routes.ts` | Generic routes exist for clinic item search, item stock, alerts, ledger, consumption, adjust, and receive. | Partial | Can support future vaccine batch selector, but no vaccine-specific workflow found. |
| Billing service | `src/api/v1/modules/clinic/billing.service.ts` | Clinic billing can create an order/invoice from a visit and fetch billing summaries/orders. | Existing | No vaccination record fields link to visit, order, invoice, or appointment. No vaccine administration billing workflow found. |
| Clinic billing routes | `src/api/v1/modules/clinic/clinic.routes.ts` | Routes exist for visit billing summary, visit orders, payment status, invoice creation, and prescription order lines. | Existing | No vaccine administration endpoint creates or links billing. |
| Service catalog vaccination category | `src/api/v1/modules/clinic/serviceCatalog.service.ts` | Maps `VACCINATION` service category prefix to `VAC`. | Existing | Service booking/catalog concept only. Not linked to pet vaccination records. |
| Doctor service assignment roles | `src/api/v1/constants/doctorServiceAssignmentRoles.ts` | Includes `VACCINATION` among allowed service assignment categories. | Existing | Scheduling/assignment support only, not vaccine administration/card. |
| Clinic room constants | `src/api/v1/constants/clinicRooms.ts` | Includes room type `VACCINATION`. | Existing | Facility setup support only, not vaccine card. |
| Permissions | `prisma/seeders/seedRolesPermissions.ts`, `src/api/v1/constants/branchRoles.ts`, `src/api/v1/constants/branchRoleMatrix.ts` | Uses broad clinic permissions such as `clinic.patients.read`, `clinic.emr.read`, and `clinic.emr.write`. | Partial | No vaccination-specific permissions found for view, administer, correct, void, print, verify, or master-data management. |
| Owner pet APIs | `src/api/v1/modules/owner/owner.controller.ts`, `src/api/v1/modules/owner/owner.routes.ts` | Owner can list/get own pets. | Partial | No vaccination/card data returned. |
| User pet profile API | `src/api/v1/modules/pets/pets.controller.ts`, `src/api/v1/modules/pets/pets.routes.ts` | User pet profile includes a hardcoded `healthStatus: { vaccinated: false, nextDueDate: null }`. | Partial/incorrect | Does not query `Vaccination`. Customer-facing vaccination status is not functional. |
| Validation schemas | Clinic vaccination files | Not found as a separate schema/module. | Not found | Current create validation is minimal inline controller logic. |
| Vaccine master CRUD API | Backend search scope | Not found. | Not found | `VaccineType` table exists but no API for list/create/update/manage was found. |
| Public vaccine QR/verify API | Backend search scope | Not found. | Not found | Only authenticated branch certificate-token lookup exists. |
| Vaccine inventory deduction | Backend search scope | Not found. | Not found | Vaccine inventory items and stock ledger exist, but vaccination record creation does not deduct stock. |
| Vaccine billing/POS link | Backend search scope | Not found. | Not found | No `Vaccination` link to order, invoice, payment, POS, appointment, or visit. |

Current backend vaccination APIs found:

- `GET /api/v1/clinic/branches/:branchId/patients/:petId/vaccinations`
- `GET /api/v1/clinic/branches/:branchId/patients/:petId/vaccinations/next-due`
- `POST /api/v1/clinic/branches/:branchId/vaccinations`
- `GET /api/v1/clinic/branches/:branchId/vaccinations/certificate/:token`
- `GET /api/v1/clinic/branches/:branchId/patients/:petId/deworming`
- `POST /api/v1/clinic/branches/:branchId/deworming`
- `GET /api/v1/clinic/branches/:branchId/patients/:petId/clinical-overview`
- `GET /api/v1/doctor/patients/:petId/history`
- `GET /api/v1/doctor/reminders`

## 4. Existing Frontend Findings

| Area | File path | What currently exists | Status | Risks or gaps |
|---|---|---|---|---|
| API client vaccination functions | `D:\BPA_Data\bpa_web\lib\api.ts` | Functions exist for staff clinic vaccination list, next due, record, certificate lookup, deworming list, and deworming record. | Partial | Mirrors partial backend. No vaccine master API, update/correction, inventory batch, administer-with-stock, public verify, customer card, PDF, or reminder send API. |
| Standalone clinic vaccination page | `D:\BPA_Data\bpa_web\app\clinic\(larkon)\vaccinations\page.jsx` | Provides manual `Branch ID` and `Pet ID` inputs, vaccination history table, next due view, record vaccination form, certificate token lookup, deworming list, and deworming form. | Partial | Manual IDs only. Requires numeric `Vaccine type ID`. No patient search, vaccine picker, inventory batch selector, branch/doctor/staff context, billing link, PDF, QR, public verification, or customer card. Certificate output is raw JSON. |
| Staff pet profile vaccination tab | `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\patients\[patientId]\page.jsx` | Patient profile has a `Vaccines` tab showing recent vaccinations and upcoming due vaccinations from clinical overview. | Partial | Read-only. No add record form, correction, certificate, PDF/QR, inventory, billing, or deworming display. |
| Staff clinic patient clinical overview API use | `D:\BPA_Data\bpa_web\lib\api.ts`, staff patient page | Staff patient profile calls `staffClinicPatientClinicalOverview`. | Partial | Useful read model, but not a vaccine card workflow. |
| Staff intake vaccine/deworming status | `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\intake\[appointmentId]\page.jsx` | Intake form captures `vaccineStatus` and `dewormingStatus` text fields inside intake history JSON. | Partial | Free-text intake status only. Does not create `Vaccination` or `DewormingRecord`. |
| Doctor clinical history timeline | `D:\BPA_Data\bpa_web\app\doctor\(larkon)\appointments\_components\ClinicalHistoryTimeline.tsx` | Shows vaccination count and up to five vaccination entries in doctor patient history timeline. | Partial | Read-only. No vaccine administration or due workflow. |
| Doctor appointment/visit pages | `D:\BPA_Data\bpa_web\app\doctor\(larkon)\appointments\[id]\page.tsx`, `D:\BPA_Data\bpa_web\app\doctor\(larkon)\appointments\_components\DoctorAppointmentDrawer.tsx`, `D:\BPA_Data\bpa_web\app\doctor\(larkon)\visits\[id]\page.tsx` | Render clinical history timeline that can include vaccinations. | Partial | Consultation integration is visibility-only. No record/administer action. |
| Doctor reminders widget | `D:\BPA_Data\bpa_web\app\doctor\(larkon)\dashboard\_components\RemindersWidget.tsx`, `D:\BPA_Data\bpa_web\app\doctor\(larkon)\dashboard\page.tsx` | Displays `vaccinationDue` summary count from doctor reminders. | Partial | No detailed vaccine dashboard, no send/schedule reminder action, no branch-wide staff view. |
| Staff branch sidebar | `D:\BPA_Data\bpa_web\src\lib\branchSidebarConfig.ts` | Clinic sidebar includes patients, visits, items, supply, surgeries, treatment courses, etc. | Not found | No vaccination or vaccine card menu entry found. |
| Standalone clinic permission menu | `D:\BPA_Data\bpa_web\src\lib\permissionMenu.ts` | Clinic menu includes dashboard, services, appointments, queue, patients, staff, and medicine control. | Not found | No `/clinic/vaccinations` menu entry found. |
| Standalone clinic dashboard links | `D:\BPA_Data\bpa_web\app\clinic\(larkon)\dashboard\page.tsx` | Quick links for queue, appointments, and patients. | Not found | No vaccination quick link found. |
| Standalone clinic patient detail | `D:\BPA_Data\bpa_web\app\clinic\(larkon)\patients\[petId]\page.jsx` | Displays clinic patient detail. | Partial | No vaccination card tab or vaccine history found in this route. |
| Owner pet portal | `D:\BPA_Data\bpa_web\app\owner\(larkon)\pets\page.tsx`, `D:\BPA_Data\bpa_web\app\owner\(larkon)\pets\[id]\page.tsx`, `D:\BPA_Data\bpa_web\app\owner\_lib\ownerApi.ts` | Owner can list and view own pet demographics. | Not found | No owner/customer vaccination card page, vaccine history, due dates, QR, or PDF download found. |
| Customer portal folder | `D:\BPA_Data\bpa_web\app\customer` | Folder not found. | Not found | No customer-specific vaccination UI found. |
| Public marketing text | `D:\BPA_Data\bpa_web\app\(public)\_components\EcosystemSection.tsx` and locale text | Public/marketing content mentions vaccines, reminders, or digital pet history. | Partial/marketing only | Not functional product UI. |
| Vaccination route documentation | `D:\BPA_Data\bpa_web\docs\CLINIC_STANDALONE_VS_STAFF_PATIENT_ROUTES.md` | Mentions clinic vaccination route documentation. | Existing docs only | Documentation does not complete workflow. |

## 5. Current End-to-End Workflow

Current actual workflow:

1. A staff/clinic user can open the standalone clinic vaccination page if they know the route.
2. The page requires manual `branchId` and `petId`.
3. The user can list existing vaccination records for the pet.
4. The user can create a vaccination record by entering a numeric `vaccineTypeId` and optional dates, batch number, manufacturer, and notes.
5. The backend writes a `Vaccination` row and generates a `certificateToken`.
6. The staff patient profile `Vaccines` tab and doctor clinical history can later show the vaccination record.
7. Doctor reminders can count/fetch due vaccination rows based on `nextDueDate`.

Where the required workflow breaks:

- Customer/Pet search -> Pet profile: partially exists for staff patient profile, but the vaccination add workflow is not integrated into that profile.
- Pet profile -> Vaccine record: partial read-only staff tab exists; create form exists only on a separate manual-ID clinic page.
- Vaccine record -> Billing: Not found.
- Vaccine record -> Inventory: Not found.
- Vaccine record -> Reminder: partial due queries exist, but actual scheduling/sending is Not found.
- Vaccine record -> Customer card: Not found.
- Vaccine record -> Public QR verification: Not found.
- Vaccine record -> PDF card/certificate: Not found.
- Branch-wise vaccine administration: Not found because records do not store `branchId`.
- Doctor/staff entry tracking: Not found because records do not store administered-by fields.

## 6. Data Model Gap Analysis

| Required model/capability | Current state | Gap |
|---|---|---|
| Vaccine master | Partial: `VaccineType` exists. Clinical inventory also has vaccine catalog seeds. | No org/branch-aware master, active status, code, schedule rules, clinical item mapping, or CRUD API. `VaccineType` and `ClinicalItem` vaccine catalog are not linked. |
| Vaccine schedule by species/age | Missing. | Only `VaccineType.defaultIntervalDays` exists. No species/age/dose schedule table. |
| Pet vaccination card | Missing. | `Pet.healthCardJson` and `Pet.qrCodeUrl` exist but no dedicated card model/workflow found. |
| Pet vaccination record | Partial: `Vaccination` exists. | Missing org, branch, owner/customer, doctor/staff, inventory, visit, appointment, invoice/order, status, correction, void, and audit links. |
| Branch administered vaccine record | Missing. | Route includes `branchId`, but the record has no `branchId` and service does not persist branch context. |
| Doctor/staff administered by | Missing. | No `doctorId`, `staffId`, `administeredByUserId`, or `createdBy` on `Vaccination`. |
| Inventory batch/lot link | Missing. | `batchNumber` is free text only. No `BranchItemBatch` or stock ledger link. |
| Next due date | Partial. | `nextDueDate` exists and can be derived from `defaultIntervalDays`, but no schedule engine, reminder status, or overdue dashboard model. |
| Reminder schedule | Missing. | Notification stub exists, but no persisted vaccine reminder records or jobs. |
| PDF/QR verification | Partial token only. | `certificateToken` exists, but no QR generator, PDF output, public verification route, revocation, or verification audit. |
| Customer visibility | Missing. | Owner/customer pet APIs and frontend do not expose vaccination card data. |
| Audit log | Missing. | No vaccination-specific create/update/correction/void audit found. |

## 7. API Gap Analysis

| Required API | Status | Notes |
|---|---|---|
| GET pet vaccination card | Partial | Existing pet vaccination list endpoint can return records, but no card envelope, pet/card metadata, QR, printable certificate, or customer-safe response exists. |
| POST add vaccination record | Partial | `POST /api/v1/clinic/branches/:branchId/vaccinations` exists, but it is not branch-scoped in data and does not handle inventory, billing, administered-by, or audit. |
| PATCH update/correct vaccination record | Missing | No correction/update/void API found. |
| GET upcoming/overdue vaccinations | Partial | Per-pet future next-due endpoint exists. Doctor reminders can query due items. No branch-wide upcoming/overdue vaccination dashboard API found. |
| GET vaccine master list | Missing | No `VaccineType` list API found. Generic clinical item search exists, but it is not a vaccine master API. |
| POST/PUT vaccine master | Missing | No vaccine master management API found. |
| GET branch vaccine stock candidates | Partial | Generic clinic item search and stock/batch APIs exist. No vaccine-specific branch candidate endpoint that maps vaccine master to stock batches. |
| POST administer vaccine with inventory deduction | Missing | No endpoint creates a vaccination record and deducts a branch inventory batch in one transaction. |
| POST generate/refresh vaccination card QR | Missing | No QR generation or refresh API found. |
| GET public verify vaccination card | Missing | Authenticated certificate-token lookup exists, but no public verification endpoint found. |
| POST schedule/send reminder | Missing | Notification reminder stub exists, but no working vaccine reminder scheduling/sending API found. |
| GET customer portal vaccination card | Missing | Owner/customer APIs do not return vaccine card data. |

## 8. Frontend Gap Analysis

| Required screen | Status | Notes |
|---|---|---|
| Staff pet profile vaccination tab | Partial | Read-only `Vaccines` tab exists in staff patient profile. |
| Staff add vaccine record form | Partial | Standalone clinic vaccination page has a basic manual form. It is not integrated into staff pet profile and requires numeric IDs. |
| Staff vaccine history timeline/table | Partial | Standalone table and staff patient read-only list exist. No full card/timeline workflow. |
| Staff upcoming/overdue vaccine dashboard | Partial | Doctor reminder count exists. No staff/branch upcoming-overdue dashboard found. |
| Doctor consultation integration | Partial | Doctor history timeline shows vaccination history read-only. No administer/correct workflow. |
| Inventory vaccine batch selector | Missing | No vaccine batch selector found in vaccination UI. |
| Billing/invoice integration | Missing | No vaccination billing/invoice UI found. |
| Customer pet vaccination card page | Missing | Owner pet pages do not show vaccination card data. `app/customer` was Not found. |
| Printable/downloadable PDF card | Missing | No PDF card UI found. |
| QR verification view | Missing | No public QR verification page found. Authenticated raw certificate lookup exists on standalone clinic page only. |

## 9. Recommended Standard Architecture

Recommended modular architecture:

- Vaccination module: owns vaccination cards, vaccination records, corrections/voids, due calculations, public-card status, and record-level audit. It should expose application services and APIs, but should not directly own inventory, billing, notification, or prescription internals.
- Vaccine KB/Master module: owns vaccine definitions, species/age schedule rules, default booster intervals, active/inactive status, and optional mapping to clinical catalog/inventory items.
- Pet medical record integration: consumes vaccination records as one part of the pet clinical timeline. The pet/patient module should read vaccination summaries through a service/read-model interface.
- Inventory integration: exposes branch vaccine stock candidates and a transactional stock deduction interface. Vaccination administration should call inventory through a clear service contract, preferably with `BranchItemBatch` and ledger references.
- Billing integration: creates or links an order/invoice/clinic bill through billing APIs. Vaccination records should store only external references such as `invoiceId`, `orderId`, `visitId`, or `appointmentId`.
- Notification/reminder integration: listens to vaccination-created/corrected events and schedules reminders from `nextDueDate`. Notification delivery should remain in the notification module.
- Public verification/QR integration: owns public token verification, QR payloads, certificate/card PDF generation, revocation, and verification audit events.
- Audit/permission model: uses vaccination-specific permissions and audit logs for create, correct, void, print, public verify, and master-data configuration.

The vaccination module should orchestrate workflows but keep hard dependencies behind small interfaces. For example, "administer vaccine" can run a transaction that creates a vaccination record, calls inventory deduction, optionally links billing, and emits reminder events without moving all inventory, billing, and notification logic into one large service.

## 10. Suggested Database Models

These are planned Prisma model changes only. Do not apply them until implementation begins.

### Vaccine

Purpose: canonical vaccine master/knowledge-base row.

Suggested fields:

- `id`
- `orgId`
- `countryCode`
- `code`
- `name`
- `targetAnimalTypeId`
- `species`
- `manufacturer`
- `description`
- `defaultIntervalDays`
- `clinicalItemId`
- `clinicalItemVariantId`
- `isActive`
- `createdAt`
- `updatedAt`

Important relationships:

- `orgId` for tenant/org scoping when required.
- `targetAnimalTypeId` or species for dog/cat/etc. scheduling.
- Optional `clinicalItemId`/`clinicalItemVariantId` to bridge vaccine master to inventory catalog.

### VaccineSchedule

Purpose: species/age/dose schedule engine.

Suggested fields:

- `id`
- `orgId`
- `vaccineId`
- `targetAnimalTypeId`
- `minAgeDays`
- `maxAgeDays`
- `doseNumber`
- `intervalDays`
- `boosterIntervalDays`
- `isRequired`
- `notes`
- `isActive`
- `createdAt`
- `updatedAt`

Important relationships:

- `vaccineId` -> `Vaccine`.
- `targetAnimalTypeId` -> `AnimalType`.

### PetVaccinationCard

Purpose: customer-visible digital vaccination card per pet.

Suggested fields:

- `id`
- `orgId`
- `petId`
- `customerId` or `ownerId`
- `cardNumber`
- `status`
- `publicToken`
- `qrCodeUrl`
- `issuedAt`
- `refreshedAt`
- `createdAt`
- `updatedAt`

Important relationships:

- `petId` -> `Pet`.
- `customerId`/`ownerId` -> pet owner/customer account.
- Public token should be unique and revocable.

### PetVaccinationRecord

Purpose: administered vaccine event.

Suggested fields:

- `id`
- `orgId`
- `branchId`
- `petId`
- `customerId` or `ownerId`
- `cardId`
- `vaccineId`
- `legacyVaccineTypeId`
- `vaccineScheduleId`
- `administeredAt`
- `nextDueDate`
- `doseNumber`
- `route`
- `site`
- `manufacturer`
- `lotNumber`
- `batchNumber`
- `inventoryBatchId`
- `clinicalItemId`
- `clinicalItemVariantId`
- `administeredByDoctorId`
- `administeredByStaffId`
- `createdByUserId`
- `visitId`
- `appointmentId`
- `invoiceId`
- `orderId`
- `status`
- `correctionReason`
- `voidReason`
- `notes`
- `createdAt`
- `updatedAt`
- `voidedAt`

Important relationships:

- `orgId`, `branchId` for tenant and branch ownership.
- `petId`, `customerId`/`ownerId` for pet/customer visibility.
- `doctorId`/`staffId` for administered-by tracking.
- `inventoryBatchId` to `BranchItemBatch`.
- `invoiceId`/`orderId`, `visitId`, `appointmentId` for billing and clinic workflow linkage.

### VaccinationReminder

Purpose: persisted reminder schedule and delivery status.

Suggested fields:

- `id`
- `orgId`
- `branchId`
- `petId`
- `customerId` or `ownerId`
- `vaccinationRecordId`
- `vaccineId`
- `dueDate`
- `reminderDate`
- `status`
- `channel`
- `notificationId`
- `scheduledAt`
- `sentAt`
- `attemptCount`
- `lastError`
- `createdAt`
- `updatedAt`

Important relationships:

- `vaccinationRecordId` -> vaccination record that generated the due date.
- `notificationId` -> notification module record if delivery is stored there.

### VaccinationCertificate / VaccinationVerification

Purpose: public verification, QR, and printable/downloadable card support.

Suggested fields:

- `id`
- `orgId`
- `branchId`
- `petId`
- `cardId`
- `vaccinationRecordId`
- `token`
- `qrPayload`
- `qrCodeUrl`
- `pdfUrl` or `mediaId`
- `verifyCount`
- `lastVerifiedAt`
- `expiresAt`
- `revokedAt`
- `createdAt`
- `updatedAt`

Important relationships:

- Can reference either the whole pet card or an individual vaccination record.
- Should avoid exposing sensitive customer data in the public response.

## 11. Suggested Permissions

Recommended permission keys:

- `vaccination.card.view`
- `vaccination.card.print`
- `vaccination.record.create`
- `vaccination.record.correct`
- `vaccination.record.void`
- `vaccination.record.delete` if hard delete is ever allowed
- `vaccination.inventory.administer`
- `vaccination.reminder.manage`
- `vaccination.public.verify`
- `vaccine.master.view`
- `vaccine.master.manage`

Recommended role behavior:

- Owner/admin: can view all cards, create/correct/void records, print cards, verify records, configure vaccine master data, configure schedules, and manage reminders.
- Branch manager: can view branch cards, create/correct/void branch records, print cards, approve corrections, view overdue dashboards, and manage branch vaccine stock mappings.
- Doctor/vet: can view patient vaccine cards, create/administer vaccinations, correct own recent records subject to policy, print certificates, and view due/overdue records for assigned patients.
- Clinic staff/nurse: can view cards, create/administer vaccinations if permitted, select inventory batch, print cards, and schedule reminders.
- Reception/front desk: can view and print cards, see due status, and attach billing where allowed; should not clinically correct or void records unless explicitly granted.
- Customer/pet owner: can view own pet vaccination card, due dates, and downloadable certificate/PDF; cannot create, correct, void, or configure records.
- Public verifier: can verify a QR/token through a limited public endpoint that reveals only safe certificate/card validity details.

## 12. Implementation Roadmap

### Phase 1: Audit-safe DB/API foundation

Backend tasks:

- Add planned vaccination/card/schedule/reminder/certificate models with nullable integration fields where needed.
- Add migration and Prisma client updates.
- Add a new vaccination module with read APIs, create API, correction/void API, and legacy `Vaccination` read compatibility.
- Add vaccine master list/manage APIs or a bridge from `VaccineType` to the new `Vaccine` model.
- Add permissions and basic tests.

Frontend tasks:

- Add API client methods only where needed for new APIs.
- Keep existing UI behavior unchanged until staff UI phase.

Risks:

- Existing records use `VaccineType` and lack branch context.
- Vaccine catalog exists in two places: `VaccineType` and clinical inventory items.

Acceptance criteria:

- Existing vaccination list still works.
- New card/read APIs return existing legacy rows where possible.
- New create/correct/void APIs are permission-protected.
- No POS, inventory, prescription, or patient profile behavior changes unexpectedly.

### Phase 2: Staff pet profile vaccination card

Backend tasks:

- Expose staff pet vaccination card endpoint by branch and pet.
- Add add-record API without inventory deduction as a safe first UI target.
- Add vaccine master picker API.

Frontend tasks:

- Upgrade staff pet profile `Vaccines` tab into a usable vaccination card.
- Add vaccine history table/timeline, upcoming due panel, add vaccine form, and correction UI if permitted.
- Replace numeric vaccine type ID entry with a searchable vaccine picker.

Risks:

- Staff patient profile currently consumes aggregate clinical overview data, so avoid overloading that endpoint with all card behavior.

Acceptance criteria:

- Staff can open a pet profile and view vaccine history and due dates.
- Staff can add a vaccine record without manual pet/branch IDs.
- Existing standalone vaccination page can remain for compatibility or be clearly deprecated later.

### Phase 3: Administer vaccine with branch inventory and billing

Backend tasks:

- Add branch vaccine stock candidate API using clinical item/variant/batch data.
- Add transactional administer API that creates the vaccination record and deducts the selected `BranchItemBatch` through the stock ledger.
- Add optional billing/invoice/order linkage to clinic billing or POS.
- Store `inventoryBatchId`, lot/batch data, `visitId`, `appointmentId`, `invoiceId`/`orderId`, and administered-by IDs.

Frontend tasks:

- Add inventory batch selector with expiry/remaining quantity visibility.
- Add administer workflow from pet profile/visit context.
- Add billing option or invoice link after administration.

Risks:

- Inventory batch deduction and billing must be atomic enough to avoid stock mismatch.
- Vaccine product catalog must be mapped cleanly to vaccine master rows.

Acceptance criteria:

- Administering a vaccine deducts exactly one branch batch/ledger entry.
- The vaccination record stores inventory and billing references.
- Insufficient stock blocks administration with a clear error.

### Phase 4: Reminder engine and overdue dashboard

Backend tasks:

- Add persisted vaccination reminders from `nextDueDate`.
- Add scheduler/job to queue reminders.
- Add branch upcoming/overdue APIs.
- Integrate with notification settings and delivery channels.

Frontend tasks:

- Add staff/manager due and overdue dashboard.
- Add reminder status and send/reschedule controls where permitted.
- Improve doctor reminders to show actionable detail, not only a count.

Risks:

- Notification enum and reminder stub need alignment with stored notification types.
- Reminder duplication must be avoided when records are corrected.

Acceptance criteria:

- Due dates create reminder rows.
- Overdue dashboard shows accurate branch/pet/vaccine data.
- Reminder send/reschedule actions are auditable and permission-protected.

### Phase 5: Customer portal + QR/PDF certificate

Backend tasks:

- Add customer portal card API limited to owned pets.
- Add public verify endpoint for card/certificate token.
- Add QR generation and PDF/card generation service or media integration.
- Add revocation/refresh behavior for public tokens.

Frontend tasks:

- Add owner/customer pet vaccination card page.
- Add downloadable/printable PDF card.
- Add public QR verification page with limited safe details.

Risks:

- Public verification must not leak owner contact, payment, or private clinical notes.
- PDF generation needs stable branding and branch/org metadata.

Acceptance criteria:

- Pet owner can view own pet vaccine card and due dates.
- QR code opens a public verification page.
- PDF card can be downloaded/printed.

### Phase 6: Hardening, tests, audit logs, permissions

Backend tasks:

- Add audit logs for create, correct, void, print, QR refresh, public verify, and reminder send.
- Add service and integration tests for branch scoping, permissions, stock deduction, billing links, reminders, and public verify.
- Add migration/backfill scripts if legacy records need branch/card mapping.

Frontend tasks:

- Add permission-aware controls and empty/error/loading states.
- Add regression coverage where available.
- Polish staff, doctor, and customer workflows.

Risks:

- Legacy records without branch/staff/inventory data need clear display labels and non-destructive migration behavior.

Acceptance criteria:

- Unauthorized users cannot mutate vaccination records.
- Audit trail is available for record changes.
- Legacy and new records display safely.
- No existing clinic/POS/inventory/pet flows regress.

## 13. Low-Risk Implementation Strategy

- Keep existing vaccination routes working while adding new versioned or clearly scoped vaccination-card APIs.
- Treat current `Vaccination` rows as legacy-compatible records until a migration/backfill plan is approved.
- Add nullable integration fields first, then enforce required fields only after UI and backfill are stable.
- Use a feature flag such as `clinic.vaccination.v2` or branch/org config to enable new workflows gradually.
- Keep `VaccineType` and clinical inventory vaccine items bridged through mapping fields instead of merging them abruptly.
- Put inventory deduction behind the existing clinical stock ledger service so vaccination does not duplicate stock rules.
- Put billing links behind clinic billing/order APIs so vaccination does not own invoice or POS logic.
- Put reminders behind notification/reminder services so vaccination only emits due-date intent/events.
- Use database transactions for administer-with-stock and administer-with-billing references.
- Prefer correction/void records over hard delete for clinical safety.
- Add branch scoping and permission checks before exposing customer or public verification workflows.

## 14. Exact Next Codex Commands Needed

1. Backend foundation implementation command:
   `Codex, implement Phase 1 backend vaccination foundation only: add planned Prisma models, modular vaccination APIs, permissions, tests, and legacy read compatibility; do not build frontend yet.`

2. Frontend staff vaccination UI command:
   `Codex, implement Phase 2 staff vaccination UI: upgrade staff pet profile with vaccine card, history, due dates, add/correct form, and vaccine picker using the new APIs.`

3. Customer portal + reminder + QR/PDF finishing command:
   `Codex, implement remaining vaccination workflow: inventory batch administration, billing link, reminder engine, customer portal card, public QR verify, and PDF certificate behind feature flags.`

## 15. Final Recommendation

The best next step is Phase 1: build the backend vaccination foundation and API contracts first. The project already has enough partial pieces to reuse, but the missing branch, staff, inventory, billing, reminder, customer, and audit links are structural. Locking those contracts down before building more UI will reduce rework and keep the vaccination card module loosely coupled to Appointment, Patient/Pet, Prescription, Medicine/Vaccine KB, Notification, Dose Engine, Inventory, and Billing.
