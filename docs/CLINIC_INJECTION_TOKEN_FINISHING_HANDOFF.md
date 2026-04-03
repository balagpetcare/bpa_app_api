# Clinic Injection Token — Final internal rollout handoff

**Date:** 2026-03-23 (release-close).
**Plan:** [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_PLAN.md)
**Report:** [CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md](./CLINIC_INJECTION_TOKEN_IMPLEMENTATION_REPORT.md)
**Checklist:** [CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md](./CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md)
**Rollout note:** [CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md](./CLINIC_INJECTION_TOKEN_INTERNAL_ROLLOUT_NOTE.md)

---

## Scope (frozen for this release)

Enterprise medicine sources, walk-in visit creation, **`billingCheckout`** with real `orders` / `order_items`, settlement hook, media upload for external Rx, staff UI + token context with order lines. **No redesign** beyond release-close hardening below.

---

## Release-close hardening (this pass)

- **Order traceability:** injection checkout appends **`[BPA_INJECTION_CHECKOUT:v1]`** to `orders.notes`.
- **Settlement failures:** `createSettlementLedgerForOrder` errors are **logged** (`console.error`) with `orderId` / `branchId` instead of failing silently.
- **Documentation:** finance attribution and inventory limits spelled out in plan, checklist, rollout note, and **staff UI warning** on Injection Tokens.
- **`doctorSettlement.service`:** JSDoc states injection orders use **whole-order** accrual to **visit doctor** (same as other clinic orders).

---

## Deploy steps

1. `prisma migrate deploy` (includes `20260323180000_injection_token_enterprise_medicine_source` when applied in sequence).
2. `npx prisma generate`.
3. Deploy API → deploy `bpa_web`.

---

## QA before calling it “live” internally

Run every row in [CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md](./CLINIC_INJECTION_TOKEN_RELEASE_CHECKLIST.md) (happy paths + invalid cases + settlement trace).

---

## API reminder

`POST …/medicine-control/injection-token` — `visitId` required unless `billingCheckout.walkIn`. For positive totals, `billingCheckout.markPaid` must be `true`.

---

## Verdict

**INTERNAL RELEASE READY** — safe for branch-internal operations when finance acknowledges whole-order doctor accrual and staff are briefed on inventory behavior. Not asserted as general multi-tenant production-ready without broader product sign-off.

---

## Related audit

- [CLINIC_INJECTION_TOKEN_AUDIT.md](./CLINIC_INJECTION_TOKEN_AUDIT.md)
