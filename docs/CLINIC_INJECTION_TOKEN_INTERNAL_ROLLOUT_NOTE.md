# Clinic Injection Token — Internal rollout note

**Audience:** branch ops, finance, engineering.
**Status:** internal release (see verdict in [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md)).

---

## What branches should configure

1. **Branch services (catalog):** at least one **Service** row suitable as the **injection / procedure fee** line used in checkout. Optionally a second service for **consumables** if you bill them separately.
2. **Medicine policies / variants:** unchanged — staff still pick the **variant** for the token; clinic-provided **medicine fee** checkout line uses the same variant when enabled.
3. **Permissions:** staff need existing keys (`injection.token.generate`, etc.); no new permission key for checkout.
4. **Media / storage:** external Rx upload uses `POST /api/v1/media/upload` with folder `injection-external-rx` — same storage config as the rest of the app.

---

## What finance must sign off

1. **Doctor settlement accrual** for injection checkout orders is **identical** to other paid clinic orders linked to a visit: **`DoctorSettlementLedger`** uses **`order.totalAmount`** as gross and splits **doctorShare / clinicShare** using the **visit-attending doctor’s** contract or commission policy.
   - This is **not** “injection fee to clinic only, medicine to doctor” unless your contract happens to match that — **per-line attribution is not implemented.**
2. If the visit doctor is **ineligible** (no profile, not `DOCTOR` type), **no ledger row** is created; the order still exists for **branch revenue** reporting.
3. Search for injection-sourced orders in DB: `orders.notes` contains **`[BPA_INJECTION_CHECKOUT:v1]`**.

---

## Staff training (one slide)

- **Two ways to bill:** (a) normal billing screen then token, or (b) **Create order lines from fee fields** (+ optional walk-in) on the Injection Tokens page.
- **Patient-brought:** do **not** enter a clinic **medicine fee** — the API rejects a medicine **order line** for that source.
- **Stock:** paying or creating lines **does not** remove stock; **injection room / vial** (or outside receive) still governs inventory.
- **Attending doctor** on a walk-in visit drives settlement accrual for the **whole** checkout order — pick the doctor intentionally.

---

## Intentionally not automated (yet)

- Per-line or injection-specific **doctor vs clinic** split.
- **Draft order + token later** in one API when total &gt; 0 and unpaid.
- **Automatic dispense / inventory** from checkout `OrderItem` rows.
- Full **E2E** automation in CI (manual checklist is source of truth for this release).

---

## Related

- [CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md](./CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md)
- [CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md](./CLINIC_INJECTION_TOKEN_FINISHING_HANDOFF.md)
