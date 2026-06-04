/**
 * Pure helpers for POS list-price resolution mode (no Prisma).
 * When POS governance is on, list price for scan/browse must match assertPosSalePricingGovernance.
 */

/** True when POS scan / browse should use `resolveSellingPriceWithEnterprise` for displayed list price. */
export function shouldPosUseEnterpriseListPriceResolution(policy: {
  posPricingGovernanceEnabled?: boolean | null;
  posUseEnterpriseListResolution?: boolean | null;
}): boolean {
  return Boolean(policy.posPricingGovernanceEnabled || policy.posUseEnterpriseListResolution);
}
