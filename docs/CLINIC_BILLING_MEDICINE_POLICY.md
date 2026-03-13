# Clinic Billing — Multi-Dose Medicine Policy

## Standard (enterprise lock)

- **Patient pays full medicine price** per dose/order (not per mL).
- **System tracks mL usage internally** for inventory, vial sessions, and reconciliation.

## Implementation

- Order lines and billing are per dose/order (full price).
- `medication_administrations.administeredDose` and vial session `remainingQty` track mL for inventory and daily reconciliation.
- No mL-based patient billing; billing simplicity and fraud minimization are preserved.

## References

- [billing.service.ts](src/api/v1/modules/clinic/billing.service.ts) — order and payment flow
- [doseConsumption.service.ts](src/api/v1/modules/clinic/doseConsumption.service.ts) — administeredDose recording
- Pharmacy + Injection + Medicine Control — Final Lock Plan (§5)
