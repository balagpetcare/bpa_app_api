/**
 * Post-commit hooks for procurement-demand auto-dispatch (feature-flagged).
 */
export function scheduleProcurementDemandAutoDispatchAfterGrn(grnId: number, orgId: number): void {
  setImmediate(() => {
    try {
      const { tryAutoDispatchFulfilledDemandsForGrn } = require("../procurement_demand/procurementDemand.service");
      tryAutoDispatchFulfilledDemandsForGrn(grnId, orgId).catch((e: unknown) =>
        console.error("tryAutoDispatchFulfilledDemandsForGrn", e)
      );
    } catch (e) {
      console.error("scheduleProcurementDemandAutoDispatchAfterGrn", e);
    }
  });
}
