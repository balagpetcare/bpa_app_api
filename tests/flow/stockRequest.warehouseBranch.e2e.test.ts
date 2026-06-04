const runE2e = process.env.FLOW_E2E_DB === "1";

(runE2e ? describe : describe.skip)("stockRequest.warehouseBranch e2e (FLOW_E2E_DB=1)", () => {
  jest.setTimeout(180000);

  it("warehouse branch defaults PROCUREMENT; excluded from internal queue segment", async () => {
    const { tryLoadFlowE2eContext } = require("./flowE2eContext");
    const { listWarehouseFulfillmentQueue } = require("../../src/api/v1/services/warehouseFulfillmentQueue.service");
    const stockService = require("../../src/api/v1/modules/stock_requests/stock_requests.service");
    const allocationService = require("../../src/api/v1/modules/allocation_plans/allocationPlan.service");
    const prisma = require("../../src/infrastructure/db/prismaClient").default;

    const ctx = await tryLoadFlowE2eContext();
    expect(ctx).not.toBeNull();
    if (!ctx) return;

    const draft = await stockService.createRequest({
      orgId: ctx.orgId,
      branchId: ctx.warehouseBranchId,
      requesterUserId: ctx.requesterUserId,
      items: [{ productId: ctx.productId, variantId: ctx.variantId, requestedQty: 2 }],
    });
    expect(draft.requestIntent).toBe("PROCUREMENT");

    await stockService.submitRequest(draft.id);

    const plan = await allocationService.createFromStockRequest({
      orgId: ctx.orgId,
      stockRequestId: draft.id,
      fromLocationId: ctx.warehouseFromLocationId,
      createdByUserId: ctx.requesterUserId,
      skipAutoAllocation: false,
    });

    await allocationService.confirmPlan(plan.id, ctx.orgId, ctx.requesterUserId);

    const internalQ = await listWarehouseFulfillmentQueue([ctx.orgId], { segment: "INTERNAL_TRANSFER" });
    expect(internalQ.some((r: { stockRequestId: number }) => r.stockRequestId === draft.id)).toBe(false);

    const procQ = await listWarehouseFulfillmentQueue([ctx.orgId], { segment: "PROCUREMENT" });
    expect(procQ.some((r: { stockRequestId: number }) => r.stockRequestId === draft.id)).toBe(true);

    const planAfter = await prisma.allocationPlan.findUnique({
      where: { id: plan.id },
      select: { shortageQty: true, status: true },
    });
    const shortage =
      (planAfter?.shortageQty ?? 0) > 0 ||
      planAfter?.status === "PARTIALLY_ALLOCATED" ||
      planAfter?.status === "FAILED";
    if (shortage) {
      const n = await prisma.procurementDemandLine.count({ where: { stockRequestId: draft.id } });
      expect(n).toBeGreaterThan(0);
    }
  });
});
