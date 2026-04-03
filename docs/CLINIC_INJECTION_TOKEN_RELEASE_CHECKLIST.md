# Clinic Injection Token — Release checklist

**Related:** [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md) · [CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md](./CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md) · [CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md](./CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md)

---

## Pre-deploy

1. Apply migration `20260323180000_injection_token_enterprise_medicine_source` (or full `prisma migrate deploy` on target DB).
2. Run `npx prisma generate` (on Windows, stop processes locking the Prisma engine if `EPERM`).
3. Deploy API then web; confirm staff session can `POST /api/v1/clinic/branches/:branchId/medicine-control/injection-token` (401/403 without auth is OK; route must exist).

---

## Smoke (internal) — happy paths

| # | Case | Pass? |
|---|------|-------|
| 1 | **Internal + existing order:** Visit with completed order → generate token (no `billingCheckout`) → validate → injection room → record dose (clinic source + vial as applicable) → token USED | ☐ |
| 2 | **Internal + checkout:** Same visit + `billingCheckout` (no walk-in), `markPaid: true`, service and/or medicine lines → token → validate → dose | ☐ |
| 3 | **Walk-in:** `billingCheckout.walkIn` + fees + `markPaid: true` → new visit, order notes contain `[BPA_INJECTION_CHECKOUT:v1]`, token | ☐ |
| 4 | **Walk-in patient-brought:** Outside medicine source, checkout **service fee only** (no medicine line), paid → token → room path without vial | ☐ |
| 5 | **Walk-in clinic-provided:** Service + medicine line on checkout, paid → token → vial path as configured | ☐ |
| 6 | External Rx: evidence **URL** and/or **file upload** (`folder` `injection-external-rx`) → `externalRxEvidenceUrl` on token | ☐ |
| 7 | List → open detail drawer → **linked order** + **line items** visible | ☐ |

---

## Smoke — invalid / guardrails

| # | Case | Expected | Pass? |
|---|------|----------|-------|
| A | Medicine source **patient-brought** + `billingCheckout` includes medicine product line | API error (no clinic medicine charge for patient-brought) | ☐ |
| B | Line total **&gt; 0** and `markPaid: false` | API error (must collect payment or use billing UI) | ☐ |
| C | Walk-in with pet **not** owned by `patientId` | API error | ☐ |

---

## Settlement trace (after paid checkout with total &gt; 0)

1. Note **`orders.id`** from API response or token’s `orderId`.
2. Confirm `orders.notes` contains **`[BPA_INJECTION_CHECKOUT:v1]`** (injection checkout tag).
3. If visit doctor is a **DOCTOR** `clinicStaffProfile`, expect **`doctor_settlement_ledger`** row with matching **`orderId`** (type `ORDER`, `grossAmount` = order total) — same as POS-paid visit orders.
4. If no ledger row: expected when visit doctor is missing or not eligible per `createSettlementLedgerForOrder`; order still appears in branch revenue / daily reconciliation aggregates.

---

## Finance / inventory (do not assume)

- **Not** per-line doctor attribution: entire **order total** accrues under visit doctor rules. See [CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md](./CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md).
- **Billing lines do not reduce inventory**; dispense/vial flows are unchanged.

---

## Rollback

- Revert deploy; reversing enum migration on production requires a DBA plan — avoid ad-hoc rollback of `MedicineSource` renames.
