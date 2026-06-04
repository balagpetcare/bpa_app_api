/**
 * Pure helper: batch pricing rules may be scoped to a branch (non-null branchId) or org-wide (null).
 */
export function batchPricingRuleAppliesToBranch(ruleBranchId: number | null | undefined, sellingBranchId: number): boolean {
  return ruleBranchId == null || ruleBranchId === sellingBranchId;
}
