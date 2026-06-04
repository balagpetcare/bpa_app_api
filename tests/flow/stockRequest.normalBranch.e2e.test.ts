const runE2e = process.env.FLOW_E2E_DB === "1";

(runE2e ? describe : describe.skip)("stockRequest.normalBranch e2e (FLOW_E2E_DB=1)", () => {
  jest.setTimeout(180000);

  it("draft → submit → allocate → confirm → APPROVED → internal fulfillment queue", async () => {
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
      branchId: ctx.normalBranchId,
      requesterUserId: ctx.requesterUserId,
      items: [{ productId: ctx.productId, variantId: ctx.variantId, requestedQty: 2 }],
    });
    expect(draft.requestIntent).toBe("INTERNAL_TRANSFER");

    await stockService.submitRequest(draft.id);

    const plan = await allocationService.createFromStockRequest({
      orgId: ctx.orgId,
      stockRequestId: draft.id,
      fromLocationId: ctx.warehouseFromLocationId,
      createdByUserId: ctx.requesterUserId,
      skipAutoAllocation: false,
    });

    const lineRows = plan.lines?.length
      ? plan.lines
      : await prisma.allocationPlanLine.findMany({
          where: { allocationPlanId: plan.id },
        });
    const hasAlloc = lineRows.some((l: { quantityAllocated: number }) => Number(l.quantityAllocated) > 0);
    expect(hasAlloc).toBe(true);

    await allocationService.confirmPlan(plan.id, ctx.orgId, ctx.requesterUserId);

    const sr = await prisma.stockRequest.findUnique({ where: { id: draft.id }, select: { status: true } });
    expect(sr?.status).toBe("APPROVED");

    const q = await listWarehouseFulfillmentQueue([ctx.orgId], { segment: "INTERNAL_TRANSFER" });
    expect(q.some((r: { stockRequestId: number }) => r.stockRequestId === draft.id)).toBe(true);
  });
});
