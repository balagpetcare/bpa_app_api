/**
 * End-to-end stock flow simulation (real DB).
 *
 * Requires a seeded dev DB with inventory at a warehouse location.
 *
 * Env (required unless auto-discover succeeds):
 *   FLOW_ORG_ID
 *   FLOW_NORMAL_BRANCH_ID   — receiving branch (non-warehouse)
 *   FLOW_WAREHOUSE_FROM_LOCATION_ID — DC/main location with on-hand stock
 *   FLOW_REQUESTER_USER_ID  — user on the normal branch org
 *
 * Optional:
 *   FLOW_VARIANT_ID, FLOW_LOT_ID — pin SKU; else first suitable lot balance is used
 *   FLOW_REQUESTED_QTY (default 2)
 *   FLOW_WAREHOUSE_BRANCH_ID — for PROCUREMENT scenario (warehouse as requester)
 *   FLOW_SKIP_PROCUREMENT_SCENARIO=1
 *   FLOW_SKIP_RECEIVE=1 — stop after send dispatch
 *   FLOW_AUTO_DISCOVER=1 — try to infer IDs from org (best-effort)
 *
 * Run: npm run simulate:flow
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";

const stockService = require("../src/api/v1/modules/stock_requests/stock_requests.service");
const allocationService = require("../src/api/v1/modules/allocation_plans/allocationPlan.service");
const pickService = require("../src/api/v1/modules/pick_lists/pickList.service");
const dispatchService = require("../src/api/v1/modules/dispatches/dispatches.service");
const { listWarehouseFulfillmentQueue } = require("../src/api/v1/services/warehouseFulfillmentQueue.service");
const { listBranchInboundQueue } = require("../src/api/v1/services/branchInboundQueue.service");
const { getBranchCategory } = require("../src/api/v1/services/branchTypeResolver.service");

type StepResult = { name: string; ok: boolean; hint?: string; detail?: string };

const results: StepResult[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`PASS: ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, hint: string, detail?: string) {
  results.push({ name, ok: false, hint, detail });
  console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`FAIL ROOT CAUSE GUESS: ${hint}`);
}

function num(v: string | undefined, d?: number): number | null {
  if (v == null || v === "") return d ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const WAREHOUSE_TYPE_CODES = ["WAREHOUSE_DC", "WAREHOUSE", "CENTRAL_WAREHOUSE", "DISTRIBUTION_CENTER"] as const;

async function autoDiscover(orgId: number) {
  const whLoc = await prisma.inventoryLocation.findFirst({
    where: {
      warehouseId: { not: null },
      branch: {
        orgId,
        typeLinks: { some: { branchType: { code: { in: [...WAREHOUSE_TYPE_CODES] } } } },
      },
      stockLotBalances: { some: { onHandQty: { gte: 2 } } },
    },
    select: { id: true, branchId: true },
    orderBy: { id: "asc" },
  });
  if (!whLoc) return null;

  const balance = await prisma.stockLotBalance.findFirst({
    where: { locationId: whLoc.id, onHandQty: { gte: 2 } },
    select: { lotId: true, onHandQty: true },
  });
  if (!balance) return null;

  const lot = await prisma.stockLot.findUnique({
    where: { id: balance.lotId },
    select: { variantId: true },
  });
  if (!lot) return null;

  const variant = await prisma.productVariant.findUnique({
    where: { id: lot.variantId },
    select: { id: true, productId: true },
  });
  if (!variant) return null;

  const normalBranch = await prisma.branch.findFirst({
    where: {
      orgId,
      id: { not: whLoc.branchId },
      NOT: {
        typeLinks: { some: { branchType: { code: { in: [...WAREHOUSE_TYPE_CODES] } } } },
      },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!normalBranch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { orgId, branchId: normalBranch.id, status: "ACTIVE" },
    select: { userId: true },
  });
  if (!member) return null;

  const toLoc = await prisma.inventoryLocation.findFirst({
    where: { branchId: normalBranch.id, branch: { orgId } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!toLoc) return null;

  const whBranch = await prisma.branch.findUnique({
    where: { id: whLoc.branchId },
    select: { id: true },
  });

  return {
    orgId,
    normalBranchId: normalBranch.id,
    warehouseFromLocationId: whLoc.id,
    warehouseBranchId: whBranch?.id ?? whLoc.branchId,
    requesterUserId: member.userId,
    variantId: variant.id,
    productId: variant.productId,
    toLocationId: toLoc.id,
  };
}

async function runNormalBranchScenario(ctx: {
  orgId: number;
  normalBranchId: number;
  warehouseFromLocationId: number;
  requesterUserId: number;
  variantId: number;
  productId: number;
  toLocationId: number;
  requestedQty: number;
}) {
  let requestId: number | null = null;
  let planId: number | null = null;
  let pickListId: number | null = null;
  let dispatchId: number | null = null;

  try {
    const draft = await stockService.createRequest({
      orgId: ctx.orgId,
      branchId: ctx.normalBranchId,
      requesterUserId: ctx.requesterUserId,
      items: [{ productId: ctx.productId, variantId: ctx.variantId, requestedQty: ctx.requestedQty }],
    });
    requestId = draft.id;
    pass("request created (draft)", `SR-${requestId}`);

    const submitted = await stockService.submitRequest(requestId);
    if (submitted.status !== "SUBMITTED") {
      fail("submit request", "submitRequest did not reach SUBMITTED", String(submitted.status));
      return;
    }
    pass("request submitted", `status=${submitted.status}`);

    const plan = await allocationService.createFromStockRequest({
      orgId: ctx.orgId,
      stockRequestId: requestId,
      fromLocationId: ctx.warehouseFromLocationId,
      createdByUserId: ctx.requesterUserId,
      skipAutoAllocation: false,
    });
    planId = plan.id;
    pass("allocation plan created + FEFO", `planId=${planId} status=${plan.status}`);

    const lineRows = plan.lines?.length ? plan.lines : await prisma.allocationPlanLine.findMany({ where: { allocationPlanId: planId } });

    if (
      !lineRows.length ||
      !lineRows.some((l: { quantityAllocated: number }) => Number(l.quantityAllocated) > 0)
    ) {
      fail(
        "allocation has pickable quantity",
        "No on-hand FEFO allocation; increase stock at FLOW_WAREHOUSE_FROM_LOCATION_ID or pick another variant",
        `lines=${lineRows.length}`
      );
      return;
    }

    const confirmed = await allocationService.confirmPlan(planId, ctx.orgId, ctx.requesterUserId);
    if (confirmed.status !== "CONFIRMED") {
      fail("confirm allocation plan", "confirmPlan did not return CONFIRMED", confirmed.status);
      return;
    }
    pass("allocation confirmed", `planId=${planId}`);

    const srAfter = await prisma.stockRequest.findUnique({ where: { id: requestId }, select: { status: true } });
    if (srAfter?.status !== "APPROVED") {
      fail(
        "stock request ready after confirm",
        "confirmPlan should promote StockRequest to APPROVED when transition allowed (see allocationPlan.service)",
        srAfter?.status
      );
    } else {
      pass("stock request APPROVED after confirm", srAfter.status);
    }

    const queue = await listWarehouseFulfillmentQueue([ctx.orgId], { segment: "INTERNAL_TRANSFER" });
    const inQueue = queue.some((r: { stockRequestId: number }) => r.stockRequestId === requestId);
    if (!inQueue) {
      fail(
        "warehouse fulfillment queue visibility",
        "Plan not CONFIRMED/PICKING/PICKED with remaining work, or requestIntent filtered out; check warehouseFulfillmentQueue.service",
        `queueSize=${queue.length}`
      );
    } else {
      pass("visible in warehouse fulfillment queue (internal transfer)", `rows matching SR=${queue.filter((r: { stockRequestId: number }) => r.stockRequestId === requestId).length}`);
    }

    const pl = await pickService.createPickListFromPlan(planId, ctx.orgId);
    pickListId = pl.id;
    pass("pick list created", `pickListId=${pickListId}`);

    await pickService.startPicking(pickListId, ctx.orgId, ctx.requesterUserId);
    const plFull = await prisma.pickList.findUnique({
      where: { id: pickListId },
      include: { lines: true },
    });
    for (const line of plFull?.lines ?? []) {
      if (line.quantityToPick > 0) {
        await pickService.updatePickLine(pickListId, line.id, ctx.orgId, line.quantityToPick);
      }
    }
    await pickService.completePicking(pickListId, ctx.orgId, ctx.requesterUserId);

    const handed = await pickService.handoffToDispatch(pickListId, ctx.orgId, {
      toLocationId: ctx.toLocationId,
      createdByUserId: ctx.requesterUserId,
    });
    dispatchId = handed?.dispatch?.id ?? null;
    if (!dispatchId) {
      fail("dispatch created from pick", "handoffToDispatch returned no dispatch", JSON.stringify(handed));
      return;
    }
    pass("dispatch created (pick handoff)", `dispatchId=${dispatchId}`);

    await dispatchService.sendDispatch(dispatchId, ctx.requesterUserId);
    const sent = await prisma.stockDispatch.findUnique({ where: { id: dispatchId }, select: { status: true } });
    if (sent?.status !== "IN_TRANSIT") {
      fail("dispatch sent", "sendDispatch should set IN_TRANSIT when stock available", sent?.status);
    } else {
      pass("dispatch IN_TRANSIT", String(sent.status));
    }

    const inbound = await listBranchInboundQueue(ctx.normalBranchId, ctx.orgId);
    const inboundHit = inbound.some((r: { inboundId: number }) => r.inboundId === dispatchId && r.kind === "DISPATCH");
    if (!inboundHit) {
      fail(
        "branch inbound queue visibility",
        "Dispatch not PACKED/IN_TRANSIT to branch location, or isBranchInboundActionable filtered it out",
        `inboundRows=${inbound.length}`
      );
    } else {
      pass("dispatch visible on branch inbound queue", `dispatchId=${dispatchId}`);
    }

    if (process.env.FLOW_SKIP_RECEIVE === "1") {
      pass("receive skipped (FLOW_SKIP_RECEIVE=1)", "");
      return;
    }

    await dispatchService.receiveDispatch(
      dispatchId,
      { createdByUserId: ctx.requesterUserId },
      { mode: "legacy_immediate" }
    );
    const delivered = await prisma.stockDispatch.findUnique({ where: { id: dispatchId }, select: { status: true } });
    if (delivered?.status !== "DELIVERED") {
      fail("dispatch received", "receiveDispatch legacy_immediate should mark DELIVERED when fully received", delivered?.status);
    } else {
      pass("dispatch DELIVERED after receive", delivered.status);
    }

    const finalSr = await prisma.stockRequest.findUnique({ where: { id: requestId }, select: { status: true } });
    pass("final stock request state", finalSr?.status ?? "?");
  } catch (e: any) {
    fail("scenario exception", e?.message || String(e), e?.stack);
  }
}

async function runWarehouseProcurementScenario(ctx: {
  orgId: number;
  warehouseBranchId: number;
  warehouseFromLocationId: number;
  requesterUserId: number;
  variantId: number;
  productId: number;
  /** Destination location on the warehouse branch (same branch as requester for DC self-replenish pattern). */
  toLocationId: number;
  requestedQty: number;
}) {
  let requestId: number | null = null;
  let planId: number | null = null;
  try {
    const cat = await getBranchCategory(ctx.warehouseBranchId);
    if (cat !== "WAREHOUSE") {
      pass("skip procurement scenario — branch not WAREHOUSE category", `category=${cat}`);
      return;
    }

    const draft = await stockService.createRequest({
      orgId: ctx.orgId,
      branchId: ctx.warehouseBranchId,
      requesterUserId: ctx.requesterUserId,
      items: [{ productId: ctx.productId, variantId: ctx.variantId, requestedQty: ctx.requestedQty }],
    });
    requestId = draft.id;
    if (draft.requestIntent !== "PROCUREMENT") {
      fail("warehouse request intent PROCUREMENT", "resolveRequestIntent / branch type should default PROCUREMENT for warehouse branch", String(draft.requestIntent));
      return;
    }
    pass("warehouse draft PROCUREMENT", `SR-${requestId}`);

    await stockService.submitRequest(requestId);
    const plan = await allocationService.createFromStockRequest({
      orgId: ctx.orgId,
      stockRequestId: requestId,
      fromLocationId: ctx.warehouseFromLocationId,
      createdByUserId: ctx.requesterUserId,
      skipAutoAllocation: false,
    });
    planId = plan.id;
    await allocationService.confirmPlan(planId, ctx.orgId, ctx.requesterUserId);

    const demands = await prisma.procurementDemandLine.count({
      where: { stockRequestId: requestId, orgId: ctx.orgId },
    });
    const planAfter = await prisma.allocationPlan.findUnique({
      where: { id: planId },
      select: { shortageQty: true, status: true },
    });
    const shortage =
      (planAfter?.shortageQty ?? 0) > 0 ||
      planAfter?.status === "PARTIALLY_ALLOCATED" ||
      planAfter?.status === "FAILED";
    if (shortage && demands === 0) {
      fail(
        "procurement demand after shortage on PROCUREMENT SR",
        "createProcurementDemandLinesFromShortage should create rows for PROCUREMENT intent when confirm leaves variant short",
        `shortageQty=${plan.shortageQty} demands=${demands}`
      );
    } else if (shortage) {
      pass("procurement demand lines present after shortage", `count=${demands}`);
    } else {
      pass("full allocation — no shortage demand expected", `planStatus=${plan.status}`);
    }

    const internalQ = await listWarehouseFulfillmentQueue([ctx.orgId], { segment: "INTERNAL_TRANSFER" });
    const wronglyInternal = internalQ.some((r: { stockRequestId: number }) => r.stockRequestId === requestId);
    if (wronglyInternal) {
      fail(
        "PROCUREMENT excluded from internal-transfer queue",
        "warehouseFulfillmentQueue should filter PROCUREMENT out of INTERNAL_TRANSFER segment",
        ""
      );
    } else {
      pass("PROCUREMENT SR not in internal-transfer fulfillment queue", "");
    }

    const procQ = await listWarehouseFulfillmentQueue([ctx.orgId], { segment: "PROCUREMENT" });
    const inProc = procQ.some((r: { stockRequestId: number }) => r.stockRequestId === requestId);
    if (!inProc) {
      fail(
        "PROCUREMENT segment queue visibility",
        "Confirmed plan with remaining work should appear in PROCUREMENT segment when requestIntent is PROCUREMENT",
        `procQueueSize=${procQ.length}`
      );
    } else {
      pass("visible in warehouse fulfillment queue (PROCUREMENT segment)", "");
    }
  } catch (e: any) {
    fail("procurement scenario exception", e?.message || String(e), e?.stack);
  }
}

async function main() {
  console.log("=== simulateStockFlow — BPA stock request lifecycle ===\n");

  const orgId = num(process.env.FLOW_ORG_ID);
  let normalBranchId = num(process.env.FLOW_NORMAL_BRANCH_ID);
  let warehouseFromLocationId = num(process.env.FLOW_WAREHOUSE_FROM_LOCATION_ID);
  let requesterUserId = num(process.env.FLOW_REQUESTER_USER_ID);
  let variantId = num(process.env.FLOW_VARIANT_ID);
  let productId = num(process.env.FLOW_PRODUCT_ID);
  let toLocationId = num(process.env.FLOW_TO_LOCATION_ID);
  let warehouseBranchId = num(process.env.FLOW_WAREHOUSE_BRANCH_ID);
  const requestedQty = num(process.env.FLOW_REQUESTED_QTY, 2) ?? 2;

  if (process.env.FLOW_AUTO_DISCOVER === "1" && orgId) {
    const d = await autoDiscover(orgId);
    if (d) {
      normalBranchId = normalBranchId ?? d.normalBranchId;
      warehouseFromLocationId = warehouseFromLocationId ?? d.warehouseFromLocationId;
      requesterUserId = requesterUserId ?? d.requesterUserId;
      variantId = variantId ?? d.variantId;
      productId = productId ?? d.productId;
      toLocationId = toLocationId ?? d.toLocationId;
      warehouseBranchId = warehouseBranchId ?? d.warehouseBranchId;
      console.log("AUTO_DISCOVER applied:", d);
    }
  }

  if (!orgId || !normalBranchId || !warehouseFromLocationId || !requesterUserId) {
    console.log(
      "Missing FLOW_ORG_ID / FLOW_NORMAL_BRANCH_ID / FLOW_WAREHOUSE_FROM_LOCATION_ID / FLOW_REQUESTER_USER_ID.\n" +
        "Set FLOW_AUTO_DISCOVER=1 with FLOW_ORG_ID for best-effort discovery, or set all IDs explicitly.\n"
    );
    process.exit(2);
  }

  if (variantId == null || productId == null || toLocationId == null) {
    console.log("Missing variant/product/toLocation after discovery — set FLOW_VARIANT_ID, FLOW_PRODUCT_ID, FLOW_TO_LOCATION_ID.\n");
    process.exit(2);
  }

  console.log("Context:", {
    orgId,
    normalBranchId,
    warehouseFromLocationId,
    requesterUserId,
    variantId,
    productId,
    toLocationId,
    requestedQty,
  });

  console.log("\n--- Normal branch INTERNAL_TRANSFER scenario ---\n");
  await runNormalBranchScenario({
    orgId,
    normalBranchId,
    warehouseFromLocationId,
    requesterUserId,
    variantId,
    productId,
    toLocationId,
    requestedQty,
  });

  if (process.env.FLOW_SKIP_PROCUREMENT_SCENARIO !== "1" && warehouseBranchId) {
    const toWh = await prisma.inventoryLocation.findFirst({
      where: { branchId: warehouseBranchId, branch: { orgId } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (toWh) {
      console.log("\n--- Warehouse PROCUREMENT scenario ---\n");
      await runWarehouseProcurementScenario({
        orgId,
        warehouseBranchId,
        warehouseFromLocationId,
        requesterUserId,
        variantId,
        productId,
        toLocationId: toWh.id,
        requestedQty,
      });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${results.length - failed}/${results.length} steps passed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
