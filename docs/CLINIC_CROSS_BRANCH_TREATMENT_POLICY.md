# Cross-Branch Treatment Rule (Medicine Control)

## Standard (enterprise lock)

- **Inventory deduction** → treatment branch (where the visit and injection happen).
- **Billing owner** → treatment branch.
- **Prescription reference** → may point to original branch for audit only; no inventory or billing at prescription branch for that administration.

## Implementation

- All inventory deduction and order/billing for clinic medicine use the **visit’s branch** (treatment branch).
- In dose consumption, injection token, and order flows, `branchId` is the branch where the visit/treatment occurs.
- If a prescription is created at a different branch, that is stored as reference only; inventory is not deducted at the prescription branch for that administration.

## References

- [doseConsumption.service.ts](src/api/v1/modules/clinic/doseConsumption.service.ts) — branchId = treatment branch
- [injectionToken.service.ts](src/api/v1/modules/clinic/injectionToken.service.ts) — token and visit branch
- Pharmacy + Injection + Medicine Control — Final Lock Plan (§10)
