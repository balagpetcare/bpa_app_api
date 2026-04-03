# Clinic Services & Pricing — Enterprise Architecture

## 1. Problem statement

Branches need a single place to manage **clinic services** (consultation, surgery, grooming, etc.), **list and floor pricing**, **doctor-specific fee models**, **assignment** to doctors, **change visibility** for staff and doctors, and **audit / acknowledgment** when managers change agreed fees. Public-facing service pages later need **media and structured content** without a second catalog.

## 2. Current system analysis

- **`Service`**: Branch-scoped catalog row with `price` (default list/sell), `ServicePricingVariant` for species/sex overrides, `serviceCode`, category enum, status.
- **`DoctorServiceMapping`**: Which doctors may perform which services (staff matrix).
- **`DoctorServiceFee`**: Per doctor profile + service (+ optional species); historically a single `fee` amount.
- **`DoctorContract` / `DoctorContractRule`**: Settlement / revenue-share rules; not the same as per-booking list price.
- **APIs**: Owner uses `clinic.services.manage`; staff clinic routes historically used `clinic.appointments.manage` for service CRUD; doctor `GET/PUT .../my-services` manages fees.
- **Gaps**: No centralized staff “Services & Pricing” hub; no fee % / hybrid model; no acknowledgment workflow; consultation snapshot used **BranchMember.id** as if it were **ClinicStaffProfile.id** in one code path; `feeAmount` typo vs schema `fee`.

## 3. Target architecture

- **Extend** `Service` and `DoctorServiceFee`; add **`ServiceMedia`**, **`ServicePricingChangeLog`**, **`DoctorServiceFeeChangeLog`**.
- **`servicePricingResolution.service`**: Single place for `resolveServiceListPrice` and `resolveDoctorServiceFeeAmount` (branch member → profile resolution for appointments).
- **Staff UI**: `Services & Pricing` sidebar section with catalog, pricing matrix, agreements (link/embed), per-service content/media.
- **Doctor UI**: Larkon page showing assigned services, resolved fees, pending acknowledgments.

## 4. Sidebar / IA (staff)

| Item | Route |
|------|--------|
| Services catalog | `/staff/branch/:branchId/clinic/services-pricing/catalog` |
| Pricing matrix | `/staff/branch/:branchId/clinic/services-pricing/matrix` |
| Doctor agreements | `/staff/branch/:branchId/clinic/services-pricing/agreements` |
| Packages | Existing catalog tab (link) |
| Service content | `/staff/branch/:branchId/clinic/services-pricing/services/:serviceId/content` |

## 5. Permission model

- **`clinic.services.manage`**: Create/update services, pricing patch, media, variants (owner + staff where granted).
- **`clinic.appointments.manage`**: Retained on service routes as **alternate** permission (OR) for backward compatibility.
- **`manager.pricing.view`**: Read pricing matrix / history where only view is needed.
- **`clinic.doctors.manage_services`**: Service assignment matrix.

## 6. Data model summary

- **Service**: `baseCost`, `minSafePrice`, `staffInstructions`, `pricingExplanation`, `visibleToPublic`, `preparationNotes`, `aftercareNotes`, `faqJson`; `price` remains default list/sell.
- **DoctorServiceFee**: `feeModel` (FIXED | PERCENT_OF_LIST | HYBRID), `feePercent`, `fixedAmount` (nullable; fallback `fee`), acknowledgment and lock fields.
- **ServiceMedia**: Links `Service` to `Media` with `kind` (HERO | GALLERY | VIDEO) and `sortOrder`.
- **Logs**: Append-only JSON snapshots for service pricing and doctor fee rows.

## 7. API contract (clinic branch)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/branches/:branchId/service-pricing/matrix` | Matrix payload |
| GET | `/branches/:branchId/services/:serviceId/pricing-history` | Service pricing audit |
| GET | `/branches/:branchId/doctors/:memberId/fee-history` | Doctor fee audit |
| PATCH | `/branches/:branchId/services/:serviceId/pricing` | Partial pricing/content update |
| GET | `/branches/:branchId/services/:serviceId/media` | List media |
| PUT | `/branches/:branchId/services/:serviceId/media` | Replace ordered media set |

**Doctor**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/clinics/:branchId/my-services/acknowledge` | Acknowledge pending manager revision |

`GET .../my-services` extended with assignment, list/min prices, fee model, pending ack.

## 8. Acknowledgment / change tracking

- Manager/owner updates fees via existing owner or new staff flows can set **`pendingManagerChangeAt`** (and optional **`revisionNote`**). Doctor clears with **`acknowledge`** (sets `doctorAcknowledgedAt`, clears pending).
- **`feeLockedByClinic`**: When true, doctor `PUT my-services` **does not** change that row’s fee fields (merge/preserve).
- **History**: Every material PATCH to service pricing or doctor fee writes a **change log** row; UI can show prior JSON.

## 9. Billing integration

- **Phase 1**: Resolver used in **`getDoctorsWithFees`**, **`resolveConsultationFee`**, and **`createPriceSnapshot`** (appointment). **BranchMember.id → ClinicStaffProfile.id** resolved inside resolver/consultation module.
- **Phase 2**: Invoice/cost-sheet snapshots may store resolver output JSON (existing `snapshotJson` patterns).
- **Settlement**: `DoctorContractRule` remains authoritative for batch accrual; per-visit display fees come from **`DoctorServiceFee`** + list price; document reconciliation in finance SOP.

## 10. Media

- Reuse **`Media`** + upload pipeline; **`ServiceMedia`** join only stores ordering and role.

## 11. Rollout / migration

- Nullable columns; existing rows unchanged behavior (fee model defaults to FIXED; amount from `fee`).
- Optional backfill: `fixed_amount = fee` where null.
- Deprecate standalone Next pages that called non-v1 `/api/clinic/services` in favor of staff/doctor larkon routes.

## 12. Risks / follow-up

- RBAC: verify which staff roles receive `clinic.services.manage`.
- Large branches: matrix pagination if service count grows past ~100.
- Align owner **fees** UI with new fields in a later iteration if needed.

## 13. Implementation pointers (code)

- **Migration**: `prisma/migrations/20260401120000_clinic_services_pricing_enterprise/migration.sql`
- **Resolver**: `src/api/v1/modules/clinic/servicePricingResolution.service.ts`, `consultationFee.service.ts` (BranchMember → profile + `fee` field fix)
- **Matrix / media / pricing PATCH**: `src/api/v1/modules/clinic/servicePricing.service.ts`, routes in `clinic.routes.ts`, handlers in `clinic.controller.ts`
- **Doctor**: `acknowledgeMyServiceFeeChange`, enriched `getMyServices` / guarded `putMyServices` in `doctor.service.ts`; `POST .../my-services/acknowledge` in `doctor.routes.ts`
- **Staff UI**: `bpa_web/app/staff/.../clinic/services-pricing/*`, sidebar `src/lib/branchSidebarConfig.ts`
- **Doctor UI**: `bpa_web/app/doctor/(larkon)/service-fees/page.tsx`
- **API client**: `bpa_web/lib/api.ts` (`staffClinicServicePricingMatrix`, `staffClinicPatchServicePricing`, `doctorPostMyServicesAcknowledge`, etc.)
