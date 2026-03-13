# Shift Handover Checklist (Medicine Control)

Use with **GET /api/v1/clinic/branches/:branchId/medicine-control/handover-summary**.

## Checklist

- [ ] **Active vials** — Review list of active vial sessions (id, variant, remaining mL, valid until).
- [ ] **Remaining mL** — Confirm remaining quantity per vial matches physical.
- [ ] **Pending injections** — Resolve or hand over pending injection tokens.
- [ ] **Expired vial** — Discard or return any vials that expired in the last N hours (see `expiredVialsInWindow`).

## API

- `GET .../handover-summary?expiredWithinHours=24` — Returns active vials, pending tokens, and vials expired in the last 24 hours.

## References

- Pharmacy + Injection + Medicine Control — Final Lock Plan (§11)
- [eodHandover.service.ts](src/api/v1/modules/clinic/eodHandover.service.ts)
