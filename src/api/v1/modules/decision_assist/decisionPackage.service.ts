import { buildEvidencePayload, ENGINE_VERSION } from "./evidence";

const prisma = require("../../../../infrastructure/db/prismaClient").default;

const DEFAULT_POLICY = "wave5.policy.v1";

export async function synthesizeFromReplenishment(params: {
  orgId: number;
  createdByUserId: number;
  take?: number;
}) {
  const take = Math.min(params.take ?? 8, 25);
  const suggestions = await prisma.aiReplenishmentSuggestion.findMany({
    where: { orgId: params.orgId, status: "OPEN", severity: "CRITICAL" },
    take,
    orderBy: { updatedAt: "desc" },
    include: {
      branch: { select: { name: true } },
      variant: { select: { sku: true, title: true } },
    },
  });

  if (suggestions.length === 0) {
    return { created: false, message: "No critical open replenishment rows to synthesize.", package: null };
  }

  const items = suggestions.map((s: any, idx: number) => {
    const evidence = buildEvidencePayload({
      sources: [{ table: "AiReplenishmentSuggestion", id: s.id }],
      factors: [
        { name: "onHand", value: s.onHand, unit: "units" },
        { name: "rop", value: s.rop, unit: "units" },
        { name: "suggestedQty", value: s.suggestedQty, unit: "units" },
        { name: "severity", value: String(s.severity ?? ""), source: "replenishment_engine" },
      ],
      policyIds: [`DecisionPolicy:org:${params.orgId}:${DEFAULT_POLICY}`],
      confidence: 0.65,
      caveats: Array.isArray(s.reasonCodes) ? (s.reasonCodes as unknown[]).map((x) => String(x)) : [],
      rankingMethod:
        "min(100, (suggestedQty / max(1, onHand+1)) * 20 + (severity==CRITICAL ? 40 : 0)) — display score only; not a demand forecast.",
      synthesisSource: "synthesizeFromReplenishment:critical_open",
    });

    const score =
      Math.min(100, (s.suggestedQty / Math.max(1, s.onHand + 1)) * 20 + (s.severity === "CRITICAL" ? 40 : 0));

    return {
      actionType: "REPLENISH_DRAFT_STOCK_REQUEST",
      title: `Draft stock request — ${s.variant?.sku ?? "SKU"} @ ${s.branch?.name ?? "branch"}`,
      score,
      rank: idx,
      evidenceJson: evidence,
      constraintsJson: [
        { name: "no_auto_post", passed: true, message: "Does not post ledger; creates draft workflow only after approval." },
        { name: "recall_hold", passed: true, message: "Verify lot/recall holds in inventory UI before accepting." },
      ],
      confidence: evidence.confidence as number,
      targetRefs: {
        aiReplenishmentSuggestionId: s.id,
        branchId: s.branchId,
        variantId: s.variantId,
      },
    };
  });

  const pkg = await prisma.decisionPackage.create({
    data: {
      orgId: params.orgId,
      status: "PROPOSED",
      summary: `Synthesized ${items.length} replenishment actions from critical AI suggestions`,
      policyVersion: DEFAULT_POLICY,
      createdByUserId: params.createdByUserId,
      items: { create: items },
      approvalEvents: {
        create: {
          eventType: "SUBMITTED",
          actorUserId: params.createdByUserId,
          payloadJson: { engineVersion: ENGINE_VERSION, source: "synthesizeFromReplenishment" },
        },
      },
    },
    include: { items: true, approvalEvents: { orderBy: { createdAt: "asc" } } },
  });

  return { created: true, package: pkg };
}

export async function listDecisionPackages(orgId: number, status?: string) {
  const where: any = { orgId };
  if (status && status !== "ALL") {
    where.status = status;
  }
  return prisma.decisionPackage.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      items: { take: 20, orderBy: { rank: "asc" } },
    },
  });
}

export async function getDecisionPackageById(orgId: number, id: number) {
  return prisma.decisionPackage.findFirst({
    where: { id, orgId },
    include: {
      items: { orderBy: { rank: "asc" } },
      approvalEvents: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, profile: { select: { displayName: true, username: true } } } } },
      },
      createdBy: { select: { id: true, profile: { select: { displayName: true, username: true } } } },
      approvedBy: { select: { id: true, profile: { select: { displayName: true, username: true } } } },
    },
  });
}

export async function transitionToPendingApproval(orgId: number, packageId: number, userId: number) {
  return prisma.decisionPackage.updateMany({
    where: { id: packageId, orgId, status: "PROPOSED" },
    data: { status: "PENDING_APPROVAL" },
  });
}
