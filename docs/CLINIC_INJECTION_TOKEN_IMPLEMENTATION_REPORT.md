# Clinic Injection Token — Implementation Report

**Date:** 2026-03-23.
**Plan:** [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md).
**Prior audit:** [CLINIC_INJECTION_TOKEN_AUDIT.md](./CLINIC_INJECTION_TOKEN_AUDIT.md).

---

## What was implemented

### P0 — Architecture / semantics

- **Renamed `MedicineSource` enum** (PostgreSQL `ALTER TYPE … RENAME VALUE`) to:
  - `INTERNAL_CLINIC` (was `INTERNAL`)
  - `CLINIC_PROVIDED_MEDICINE` (was `EXTERNAL` — now valid for injection with vial rules)
  - `OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT` (was `OUTSIDE`)
- **`medicineSource.util.ts`**: `normalizeMedicineSourceInput` accepts legacy `INTERNAL` / `EXTERNAL` / `OUTSIDE` from clients and maps to new values.
- **`doseConsumption.service.ts`**: Unified rules — clinic sources require vial unless **emergency bypass**; patient-brought outside forbids bypass and vial; outside receive check uses new enum; bypass without vial allowed for clinic sources only (audited).
- **Dead token flow removed**: `CLINIC_PROVIDED_MEDICINE` is administrable with vial (no more “EXTERNAL blocked at dose” mismatch).

### P1 — External / encounter / billing snapshot

- **New enum** `InjectionEncounterKind`: `INTERNAL_VISIT` | `EXTERNAL_WALK_IN`.
- **New `injection_tokens` columns**: external prescriber/clinic/notes/evidence URL; optional `serviceChargeAmount`, `medicineChargeAmount`, `consumablesChargeAmount` (decimals).
- **Token generation API** accepts and persists these fields.
- **List API** supports `medicineSource` and `encounterKind` query filters.
- **Lifecycle display**: `injectionTokenLifecycle.util.ts` → `lifecycleLabel` on create, list, context, and validate responses (`CREATED`, `VALIDATED_IN_QUEUE`, `ADMINISTERED`, etc.).

### Frontend (bpa_web)

- **Injection Tokens page**: encounter selector, enterprise medicine source labels + hints, external Rx panel for walk-in, optional billing snapshot fields, filters, table columns (encounter, source, lifecycle), detail drawer enrichment, links to patient register + billing.
- **Multi-medicine tokens (2026-03-23):** staff form is a **line repeater** (`medicationLines` payload); per line: source (clinic vs patient-brought), variant or manual drug fields, route/dose/unit, duration/frequency/validity/notes, optional vial, optional **clinic med unit price** for checkout. **Walk-in attending doctor** is optional. **Validate** and **context** responses include `medicationLines`; list/table summarizes line count.
- **Injection Room**: `coerceMedicineSource` for API compatibility; dose source taken from token (not user-editable); patient-brought path hides vial picker; emergency bypass uses `INTERNAL_CLINIC`.
- **Types / `lib/api.ts` / `displayFormatters` / `StatusBadge`**: updated for new enums and lifecycle labels.

### Other backend

- **`dailyReconciliation.service.ts`**: bypass-without-token count uses `INTERNAL_CLINIC` + `CLINIC_PROVIDED_MEDICINE` instead of old enum strings.

---

## Files changed (summary)

**Backend (`backend-api`)**

- `prisma/schema.prisma`
- `prisma/migrations/20260323180000_injection_token_enterprise_medicine_source/migration.sql`
- `src/api/v1/modules/clinic/medicineSource.util.ts` (new)
- `src/api/v1/modules/clinic/injectionTokenLifecycle.util.ts` (new)
- `src/api/v1/modules/clinic/doseConsumption.service.ts`
- `src/api/v1/modules/clinic/injectionToken.service.ts`
- `src/api/v1/modules/clinic/clinic.controller.ts`
- `src/api/v1/modules/clinic/dailyReconciliation.service.ts`
- `docs/CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md` (new)
- `docs/CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md` (this file)
- `docs/CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md` (new)
- **Finishing:** `injectionToken.service.ts` (extended), `clinic.controller.ts`, `docs/CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md`

**Frontend (`bpa_web`)**

- `app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-tokens/page.tsx`
- `app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/injection-room/page.tsx`
- `src/types/clinicMedicineControl.ts`
- `lib/api.ts`
- `src/lib/displayFormatters.ts`
- `src/components/dashboard/StatusBadge.tsx`
- **Finishing:** `injection-tokens/page.tsx` (checkout + upload + drawer), `lib/api.ts`, `src/services/mediaUpload.ts`

---

## DB changes

- Migration renames `MedicineSource` enum labels and sets column defaults to `INTERNAL_CLINIC`.
- Adds `InjectionEncounterKind` type and seven nullable / default columns on `injection_tokens`.

**Apply:** `npx prisma migrate deploy` (or `migrate dev`) then `npx prisma generate` (stop processes locking `query_engine` on Windows if needed).

---

## API changes

| Area | Change |
|------|--------|
| `POST …/injection-token` | New optional body: `encounterKind`, `externalPrescriber*`, `externalRx*`, `serviceChargeAmount`, `medicineChargeAmount`, `consumablesChargeAmount`; `medicineSource` uses new enum (legacy strings normalized). **Preferred:** `medicationLines[]` (multi-row intake). **Checkout:** `billingCheckout.medicineLineBillings[]` for multiple clinic medicine order lines; `billingCheckout.walkIn.doctorBranchMemberId` optional. Per-line `billingUnitPrice` / `medicineFeeSnapshot` accepted and stored on lines. |
| `GET …/injection-tokens` | Query: `medicineSource`, `encounterKind`; each list item includes `lifecycleLabel`. |
| `GET …/injection-token/:id/context` | Includes new token fields + `lifecycleLabel` + `medicationLines` (+ `visit.doctorId` when present). |
| `GET …/injection-token/validate` | Returned `token` includes `lifecycleLabel` and `medicationLines`. |
| `POST …/dose` | Emergency bypass + clinic source without vial supported; patient-brought rules unchanged. |
| `POST …/injection-token` + `billingCheckout` | Creates `Order`/`OrderItem` (service + optional product lines), optional `walkIn` visit, `markPaid` → `COMPLETED`; then token. Triggers `createSettlementLedgerForOrder` when total > 0 and paid. |

---

## Finishing pass (2026-03-23)

### Closed gaps

- **Lightweight walk-in:** `billingCheckout.walkIn` creates `Visit` + treatment code without appointment; token generation uses new paid order in one transaction.
- **Real billing:** `OrderItem` rows for injection service (`serviceId`) and clinic-provided medicine (`productId`/`variantId`); patient-brought source **rejects** medicine billing lines server-side.
- **Settlement:** after successful checkout with paid amount, `doctorSettlement.service` `createSettlementLedgerForOrder` (same model as `orders.service` `processPayment` — whole-order gross, doctor from visit).
- **External evidence:** staff UI uses `uploadMedia(..., "injection-external-rx")` → `POST /api/v1/media/upload`; URL field still supported.
- **UX / safety:** flow explainer, checkout toggles, visit fields disabled for walk-in, detail drawer shows **linked order + line list** + billing link; improved error text when no paid order.

### Files touched (finishing)

**Backend:** `injectionToken.service.ts`, `clinic.controller.ts`
**Frontend:** `app/staff/.../injection-tokens/page.tsx`, `lib/api.ts`, `src/services/mediaUpload.ts`
**Docs:** `CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md`, this report, `CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md`, `CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md`

---

## UX changes

- Clear distinction between **internal visit** vs **external walk-in** at token creation.
- Medicine source labels explain inventory impact.
- Injection room no longer allows changing medicine source away from the token.
- Patient-brought path explains outside receive requirement.

---

## Gaps fixed (from audit)

- EXTERNAL vs OUTSIDE confusion for injection → replaced by explicit enterprise enum names + rules.
- Token creatable but not administrable (`EXTERNAL`) → `CLINIC_PROVIDED_MEDICINE` is injectable with vial.
- Emergency bypass vs vial requirement → aligned for clinic sources.

---

## Multi-line medication (2026-03-23)

- **Storage:** `injection_token_medication_lines` (see migration `20260323190000_injection_token_medication_lines`); legacy `injection_tokens.variantId` / `expectedDose` mirror first line where applicable.
- **Token-level `medicineSource`:** derived from lines (mixed clinic + outside → `INTERNAL_CLINIC` so clinic medicine order lines remain valid; all outside → `OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT`).
- **Billing:** administration/injection fee remains a **separate** service line; **each clinic line** with a unit price can become an order line via `medicineLineBillings`; outside lines **never** create medicine order lines.
- **Doctor rules:** internal flow uses **existing visit** (doctor from visit / branch policy). Walk-in: **doctor optional** on `billingCheckout.walkIn`.
- **UI gaps:** branch catalog **does not auto-populate** per-line clinic price — staff enter **Clinic med price** when using checkout. Injection room **multi-vial** behavior may still be effectively **first vial on token** for legacy compatibility.

---

## Remaining gaps (non-blocking for internal rollout)

- **Per-line doctor attribution:** not implemented — see **Finance attribution** below.
- **Unpaid checkout + token in one call** when total &gt; 0: **rejected by design**; use clinic billing for deferred payment.
- **Automatic dispense / stock** from checkout lines: **not implemented** — by design for this release.
- **Token DB status enum** unchanged; `lifecycleLabel` remains display-layer.
- **Repo-wide `tsc`:** still not globally green; feature-touched files reviewed in release-close pass (see below).

---

## Release-close pass (2026-03-23)

### Final code adjustments

- **`injectionToken.service.ts`:** `orders.notes` from `billingCheckout` now suffix **`[BPA_INJECTION_CHECKOUT:v1]`** for DB/report grep; settlement hook failures **log** via `console.error` (order still committed).
- **`doctorSettlement.service.ts`:** JSDoc on `createSettlementLedgerForOrder` documents that injection checkout orders use **whole-order** gross and **visit doctor** rules (same as other paid visit orders).
- **`injection-tokens/page.tsx`:** on-page **Finance & stock** alert (settlement = whole order + visit doctor; **no** automatic inventory from lines).

### Finance attribution (explicit decision)

| Question | Answer |
|----------|--------|
| Is revenue “clinic-only”? | **No** when a `DoctorSettlementLedger` row is created: **doctorShare** and **clinicShare** are computed from **full `order.totalAmount`**. |
| Is it “visit-doctor earning”? | **Yes, at order level** — accrual is keyed to the **visit’s `doctorId`** (must be eligible `DOCTOR` profile) for the **entire** paid order, not per `OrderItem`. |
| Per-line injection vs medicine split? | **Unsupported** — treat as **C) mixed business reality, single ledger row on whole order** until a future product decision. |

**Guardrails:** staff UI + [CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md](./CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md) state this explicitly so finance cannot assume line-level attribution.

### Inventory behavior (explicit decision)

**Billing / `billingCheckout` does not perform dispense or quantity deduction.** Stock changes remain tied to **dose recording, vial sessions, outside receive**, etc. Documented in plan, checklist, rollout note, and UI.

### Smoke QA status

- **Runtime E2E:** not executed in this environment (no substitute for human checklist).
- **Static verification:** Prisma schema validates; routes and controller wiring unchanged except documented prior work; invalid cases and messages verified in `injectionToken.service.ts` (`buildInjectionBillingLines`, `markPaid` / total check).
- **Human runbook:** [CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md](./CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md) (expanded with invalid rows + settlement trace).

---

## Validation performed

- `npx prisma validate` (schema OK).
- Feature-local review: `injectionToken.service.ts`, `doctorSettlement.service.ts` (JSDoc only), `clinic.controller.ts` (unchanged this pass), staff `injection-tokens/page.tsx`.
- **Repo-wide `tsc`:** still reports unrelated errors; **no new injection-specific error** identified in the files touched this pass (prior `BuiltLine` fix retained).

---

## Final system status (this release)

**INTERNAL RELEASE READY** — appropriate when branches run the checklist, finance accepts **whole-order** doctor accrual, and staff understand **no stock movement from checkout lines**. **Not** “production-ready for all tenants” without broader product/finance sign-off for multi-tenant defaults.

**Docs:** [CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md](./CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md) · [CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md](./CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md)
