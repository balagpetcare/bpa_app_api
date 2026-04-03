# Clinic Injection Token — Enterprise Implementation Plan

**Date:** 2026-03-23.
**Prerequisite audit:** [CLINIC_INJECTION_TOKEN_AUDIT.md](./CLINIC_INJECTION_TOKEN_AUDIT.md).

---

## 1. Current system summary

- Tokens require `Visit` + `COMPLETED` `Order` in-branch (`injectionToken.service.ts`).
- `MedicineSource` was `INTERNAL` | `EXTERNAL` | `OUTSIDE` with confusing semantics (`EXTERNAL` blocked at dose time).
- Emergency bypass UI posted INTERNAL without vial; backend required vial — contract mismatch.
- No structured external Rx capture, encounter kind, or denormalized billing snapshot on token.

## 2. Target enterprise model

- **Three medicine sources** aligned with inventory rules:
  - **INTERNAL_CLINIC** — clinic stock / vial session; deduct inventory when dose recorded (unless audited emergency bypass).
  - **CLINIC_PROVIDED_MEDICINE** — clinic supplies product for injection (same vial/stock rules as internal clinic path).
  - **OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT** — patient’s own medicine; pharmacy verification (`OutsideMedicineReceive`); **no** vial/stock deduction.
- **Encounter kind** on token: `INTERNAL_VISIT` vs `EXTERNAL_WALK_IN` (lightweight labeling; visit row still required today).
- **External Rx capture** (optional fields): prescriber name/clinic, notes, evidence URL.
- **Billing snapshot** on token: optional decimals for service / medicine / consumables (order remains source of truth for payment).

## 3. Source / origin model

| Source enum | Inventory | Dose path |
|-------------|-----------|-----------|
| INTERNAL_CLINIC | Vial required unless `emergencyBypass` | `openVialService.recordDose` when vial set |
| CLINIC_PROVIDED_MEDICINE | Same as INTERNAL_CLINIC | Same |
| OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT | None | `hasValidOutsideReceive`; no vial |

API accepts **legacy** strings `INTERNAL`, `EXTERNAL`, `OUTSIDE` and normalizes via `medicineSource.util.ts`.

## 4. Internal flow

- **Classic:** visit search → existing **completed** `Order` → generate token → validate → injection room → dose → token USED.
- **Quick bill:** same visit, optional `billingCheckout` on `POST …/injection-token` creates a **new** `Order` + `OrderItem` rows and can mark payment **COMPLETED** in the same transaction as token creation.

## 5. External / walk-in flow

- **With walk-in checkout:** `billingCheckout.walkIn` creates a lightweight `Visit` (no appointment, `CHECKED_IN`), then order lines + optional `markPaid`, then token. Encounter kind is forced to `EXTERNAL_WALK_IN` for audit.
- **With existing visit:** same as internal quick bill; set encounter + external Rx fields as before.
- External evidence: **URL** and/or **file** via standard `POST /api/v1/media/upload` (`folder` e.g. `injection-external-rx`) → store returned URL on `externalRxEvidenceUrl`.

## 6. Billing design

- **Source of truth:** `Order` + `OrderItem` (`serviceId` / `productId`+`variantId`); `orderId` on `InjectionToken`.
- **Token snapshots:** `serviceChargeAmount`, `medicineChargeAmount`, `consumablesChargeAmount` — aligned to checkout lines when `billingCheckout` is used; otherwise optional manual audit fields.
- **Settlement:** on `markPaid` + positive total, `createSettlementLedgerForOrder` runs (same rules as POS/clinic billing: **gross = full `order.totalAmount`**, doctor from **visit** — not per line). Orders from this checkout include `[BPA_INJECTION_CHECKOUT:v1]` in `orders.notes` for audit grep.
- **Inventory:** checkout **does not** call dispense or ledger deduction; stock movement remains tied to dose/vial flows.

## 7. Inventory design

- INTERNAL_* + CLINIC_PROVIDED: vial session + `recordDose` when not emergency bypass without vial.
- OUTSIDE: never `recordDose` on vial.
- Emergency bypass: allow administration **without** vial for clinic-stock sources only; `emergencyBypassReason` on `MedicationAdministration`.

## 8. Status lifecycle

- **DB** (unchanged): `PENDING`, `USED`, `EXPIRED`, `CANCELLED`.
- **API display** `lifecycleLabel`: `CREATED`, `VALIDATED_READY` (in-queue semantics), `ADMINISTERED`, `EXPIRED`, `CANCELLED` (computed).

## 9. UI/UX flow

- Injection Tokens: clear labels for sources, encounter kind, external Rx panel, optional charge fields, link to patient register.
- Injection Room: updated source options; bypass relies on backend fix (no vial when bypass).

## 10. API changes

- `POST .../injection-token` body: `encounterKind`, `externalPrescriber*`, `externalRx*`, charge snapshots, `medicineSource` (new or legacy).
- **`billingCheckout` (optional):** `walkIn?` `{ patientId, petId, doctorBranchMemberId }`, `injectionServiceId`, `servicePrice`, `medicineVariantId`, `medicineQuantity`, `medicineUnitPrice`, `consumablesServiceId`, `consumablesPrice`, `paymentMethod`, **`markPaid`** (required semantics: if line total > 0, must be `true` to complete payment), `notes`.
- **`visitId`:** required unless `billingCheckout.walkIn` is present (server creates visit).
- List/context responses: `lifecycleLabel`, token fields; **context** includes `order.items` for service vs product line visibility.
- `POST .../dose`: normalized `medicineSource`; bypass skips vial for clinic sources only.

## 11. DB changes

- Migration: rename `MedicineSource` enum values (PostgreSQL `ALTER TYPE ... RENAME VALUE`).
- Add `InjectionEncounterKind` + columns on `injection_tokens`.

## 12. Implementation phases

| Phase | Content |
|-------|---------|
| P0 | Enum rename, normalization util, dose + bypass fix, dead-token fix |
| P1 | Token encounter + external Rx + billing snapshot fields, UI |
| P2 | Lifecycle labels, filters, polish |
| **Finishing** | `billingCheckout` (walk-in visit + real `Order`/`OrderItem`), settlement hook on paid checkout, media upload for evidence, staff UI for checkout + order lines in drawer |
| Deferred | Per-line doctor attribution for injection vs consult; dedicated `Order` “line kind” enum; automated tests/E2E |

## 13. Risks

- Enum rename requires DB migration on all environments.
- Legacy mobile/clients sending old enum strings — mitigated by normalization in controller.
