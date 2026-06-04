/**
 * Read-only health check for stock flow data consistency.
 *
 * Env:
 *   FLOW_ORG_ID (optional) — limit checks to one org
 *   FLOW_AUDIT_LIMIT (default 200) — max stock requests scanned
 *
 * Run: npm run audit:flow
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { listWarehouseFulfillmentQueue } from "../src/api/v1/services/warehouseFulfillmentQueue.service";
import { listBranchInboundQueue } from "../src/api/v1/services/branchInboundQueue.service";
import { computeFullRequestSummary } from "../src/api/v1/services/stockRequestQuantity.service";
import { getBranchCategory } from "../src/api/v1/services/branchTypeResolver.service";
import { isBranchInboundActionable } from "../src/api/v1/services/stockRequestStatus.service";
import { stockTransfersEnterpriseSupersededColumnExists } from "../src/api/v1/services/stockFlowPgCaps.service";

const limit = Math.min(500, Math.max(20, Number(process.env.FLOW_AUDIT_LIMIT || 200) || 200));
const orgFilter = process.env.FLOW_ORG_ID ? Number(process.env.FLOW_ORG_ID) : null;

const issues: Array<{ code: string; message: string; hint: string; ref?: string }> = [];

function add(code: string, message: string, hint: string, ref?: string) {
  issues.push({ code, message, hint, ref });
  console.log(`ISSUE [${code}]: ${message}${ref ? ` (${ref})` : ""}`);
  console.log(`  → ${hint}`);
}

async function main() {
  console.log("=== auditStockFlow — read-only consistency scan ===\n");

  const hasEnterpriseSupersededCol = await stockTransfersEnterpriseSupersededColumnExists();
  if (!hasEnterpriseSupersededCol) {
    console.log(
      "Note: stock_transfers.enterpriseSupersededAt not deployed — legacy-vs-plan check ignores superseded marker. Run: npx prisma migrate deploy\n"
    );
  }

  const orgWhere =
    orgFilter && Number.isFinite(orgFilter) ? { orgId: orgFilter } : ({} as { orgId?: number });

  const srs = await prisma.stockRequest.findMany({
    where: {
      ...orgWhere,
      status: { notIn: ["CLOSED", "CANCELLED", "DRAFT"] },
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      orgId: true,
      branchId: true,
      status: true,
      requestIntent: true,
      items: {
        select: {
          id: true,
          variantId: true,
          requestedQty: true,
          fulfilledQty: true,
          cancelledQty: true,
          lineKind: true,
          backorderStatus: true,
        },
      },
      allocationPlans: {
        where: { parentPlanId: null },
        take: 1,
        select: {
          id: true,
          status: true,
          fromLocationId: true,
          shortageQty: true,
          totalAllocatedQty: true,
        },
      },
      dispatches: { select: { id: true, status: true } },
    },
  });

  const orgIds = [...new Set(srs.map((s) => s.orgId))];
  const queueInternal = new Map<number, Awaited<ReturnType<typeof listWarehouseFulfillmentQueue>>>();
  const queueProc = new Map<number, Awaited<ReturnType<typeof listWarehouseFulfillmentQueue>>>();
  for (const oid of orgIds) {
    queueInternal.set(oid, await listWarehouseFulfillmentQueue([oid], { segment: "INTERNAL_TRANSFER" }));
    queueProc.set(oid, await listWarehouseFulfillmentQueue([oid], { segment: "PROCUREMENT" }));
  }

  const branchCatCache = new Map<number, Awaited<ReturnType<typeof getBranchCategory>>>();

  async function categoryOf(branchId: number) {
    const hit = branchCatCache.get(branchId);
    if (hit) return hit;
    const c = await getBranchCategory(branchId);
    branchCatCache.set(branchId, c);
    return c;
  }

  for (const sr of srs) {
    const plan = sr.allocationPlans?.[0] ?? null;
    if (
      plan?.status === "CONFIRMED" &&
      !["APPROVED", "DISPATCHED", "PARTIALLY_DISPATCHED", "FULFILLED_PARTIAL", "RECEIVED", "PARTIALLY_RECEIVED", "RECEIVED_PARTIAL", "RECEIVED_FULL"].includes(
        sr.status
      )
    ) {
      add(
        "SR_NOT_READY_AFTER_CONFIRM",
        `StockRequest ${sr.id} status ${sr.status} but allocation plan ${plan.id} is CONFIRMED`,
        "confirmPlan should set APPROVED when transition allowed; check canTransitionTo / terminal skips",
        `orgId=${sr.orgId}`
      );
    }

    if (plan?.status === "CONFIRMED" || plan?.status === "PICKING" || plan?.status === "PICKED") {
      const queue =
        sr.requestIntent === "PROCUREMENT" ? queueProc.get(sr.orgId) ?? [] : queueInternal.get(sr.orgId) ?? [];
      const hit = queue.some((q) => q.stockRequestId === sr.id);
      const lineRows = sr.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        requestedQty: item.requestedQty,
        fulfilledQty: item.fulfilledQty,
        cancelledQty: item.cancelledQty,
        lineKind: item.lineKind,
        backorderStatus: item.backorderStatus ?? "NONE",
      }));
      let totalRemaining = 0;
      if (plan.fromLocationId) {
        const full = await computeFullRequestSummary(sr.orgId, plan.fromLocationId, lineRows);
        totalRemaining = full.requestSummary.totalRemainingQty;
      }
      if (totalRemaining > 0 && !hit && ["INTERNAL_TRANSFER", "PROCUREMENT"].includes(sr.requestIntent || "")) {
        add(
          "QUEUE_VISIBILITY_GAP",
          `SR ${sr.id} has remaining qty=${totalRemaining} and active plan ${plan.status} but not in fulfillment queue`,
          "Check shouldIncludeInternalTransferQueueRow / segment filter / plan status in CONFIRMED|PICKING|PICKED",
          `intent=${sr.requestIntent}`
        );
      }
    }

    const postConfirmPlan =
      plan &&
      ["CONFIRMED", "PICKING", "PICKED", "DISPATCHED"].includes(plan.status) &&
      (plan.shortageQty ?? 0) > 0 &&
      ["INTERNAL_TRANSFER", "PROCUREMENT"].includes(sr.requestIntent || "");
    if (postConfirmPlan) {
      const demandForPlan = await prisma.procurementDemandLine.count({
        where: { stockRequestId: sr.id, orgId: sr.orgId, allocationPlanId: plan.id },
      });
      if (demandForPlan === 0) {
        add(
          "SHORTAGE_WITHOUT_DEMAND",
          `SR ${sr.id} plan ${plan.id} (${plan.status}) shortageQty>0 but no procurement_demand_lines for this plan`,
          "Run npm run repair:stock-flow -- --apply or re-run createProcurementDemandLinesFromShortage for planId",
          `plan=${plan.id}`
        );
      }
    }

    const cat = await categoryOf(sr.branchId);
    if (cat === "WAREHOUSE" && sr.requestIntent === "INTERNAL_TRANSFER") {
      add(
        "WAREHOUSE_INTERNAL_TRANSFER_INTENT",
        `Branch ${sr.branchId} is WAREHOUSE category but SR ${sr.id} intent INTERNAL_TRANSFER`,
        "May be intentional override; verify UX treats this as DC replenishment vs PROCUREMENT default",
        `sr=${sr.id}`
      );
    }
  }

  const inTransit = await prisma.stockDispatch.findMany({
    where: {
      ...orgWhere,
      status: "IN_TRANSIT",
    },
    take: limit,
    select: {
      id: true,
      orgId: true,
      stockRequestId: true,
      toLocation: { select: { branchId: true } },
    },
  });

  for (const d of inTransit) {
    const bid = d.toLocation.branchId;
    const q = await listBranchInboundQueue(bid, d.orgId);
    const found = q.some((row) => row.kind === "DISPATCH" && row.inboundId === d.id);
    if (found || !d.stockRequestId) continue;

    const sr = await prisma.stockRequest.findUnique({
      where: { id: d.stockRequestId },
      select: {
        status: true,
        allocationPlans: {
          where: { parentPlanId: null },
          take: 1,
          select: { status: true, totalAllocatedQty: true, shortageQty: true },
        },
        dispatches: { select: { status: true } },
      },
    });
    const actionable = sr
      ? isBranchInboundActionable({ status: sr.status }, true)
      : true;
    if (!actionable) {
      add(
        "INBOUND_FILTERED_BY_SR_STATUS",
        `Dispatch ${d.id} IN_TRANSIT to branch ${bid} hidden from inbound queue (linked SR not actionable)`,
        "isBranchInboundActionable returned false — check APPROVED/DISPATCHED rules for receive",
        `sr=${d.stockRequestId} status=${sr?.status}`
      );
    } else {
      add(
        "IN_TRANSIT_NOT_IN_INBOUND_QUEUE",
        `Dispatch ${d.id} IN_TRANSIT to branch ${bid} missing from listBranchInboundQueue`,
        "Check getIncomingInboundUnifiedForBranch filters vs dispatch status; receivable flag",
        `dispatch=${d.id}`
      );
    }
  }

  const plansWithLegacyRisk = await prisma.allocationPlan.findMany({
    where: {
      ...orgWhere,
      status: { not: "CANCELLED" },
      stockRequestId: { not: null },
    },
    take: limit,
    select: { id: true, stockRequestId: true, status: true },
  });
  for (const p of plansWithLegacyRisk) {
    if (!p.stockRequestId) continue;
    const transfers = await prisma.stockTransfer.count({
      where: {
        stockRequestId: p.stockRequestId,
        status: { not: "CANCELLED" },
        ...(hasEnterpriseSupersededCol ? { enterpriseSupersededAt: null } : {}),
      },
    });
    if (transfers > 0 && ["CONFIRMED", "PICKING", "PICKED", "DISPATCHED"].includes(p.status)) {
      add(
        "LEGACY_TRANSFER_WITH_ENTERPRISE_PLAN",
        `SR ${p.stockRequestId} has active allocation plan (${p.status}) and StockTransfer rows`,
        "Risk of double fulfillment — shouldBlockLegacyOwnerFulfillment should block new legacy calls",
        `plan=${p.id}`
      );
    }
  }

  const postedSessions = await prisma.dispatchReceiveSession.findMany({
    where: { status: "POSTED", ...(orgWhere.orgId != null ? { orgId: orgWhere.orgId } : {}) },
    take: limit,
    include: { stockDispatch: { select: { id: true, status: true } } },
  });
  for (const s of postedSessions) {
    const st = s.stockDispatch?.status;
    if (st && st !== "DELIVERED") {
      add(
        "SESSION_POSTED_BUT_DISPATCH_NOT_DELIVERED",
        `DispatchReceiveSession ${s.id} POSTED but dispatch ${s.stockDispatchId} status=${st}`,
        "Data inconsistency after receive confirm — investigate ledger vs dispatch status",
        `dispatch=${s.stockDispatchId}`
      );
    }
  }

  console.log(`\n=== Summary: ${issues.length} issue(s) reported ===`);
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
