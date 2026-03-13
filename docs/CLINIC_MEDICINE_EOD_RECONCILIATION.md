# End-of-Day Closure and Mandatory Reconciliation

## Mandatory reconciliation

Daily reconciliation is **mandatory** before a branch can close the day for medicine control. Enforcement is done at EOD close:

- **GET .../medicine-control/eod-status?date=YYYY-MM-DD** — Returns `canClose` and `blockers`. If reconciliation has not been run for the date, or if there is an unacknowledged mismatch, `canClose` is false and blockers list the reason.
- **POST .../medicine-control/eod-close** — Succeeds only when `eod-status` reports `canClose: true` (all tokens resolved, no active vials opened that day, reconciliation run, and any mismatch acknowledged).

## Before closing the day

1. All tokens for the day are USED or CANCELLED.
2. All vial sessions opened that day are closed/returned/exhausted/expired (not ACTIVE/PARTIALLY_USED).
3. Daily reconciliation has been run for the date.
4. If reconciliation has a mismatch, it has been acknowledged.

## References

- Pharmacy + Injection + Medicine Control — Final Lock Plan (§8, §12)
- [eodHandover.service.ts](src/api/v1/modules/clinic/eodHandover.service.ts)
