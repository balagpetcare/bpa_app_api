import * as crypto from "crypto";
import { isBranchInOrg } from "../executive_tower/branchScope";

const prisma = require("../../../../infrastructure/db/prismaClient").default;

const SIM_ENGINE = "wave5.sim.v1";

export interface ScenarioParams {
  demandPct?: number;
  leadTimeAddDays?: number;
  branchId?: number;
}

function hashInputs(templateKey: string, horizonDays: number, params: ScenarioParams): string {
  const canonical = JSON.stringify({ templateKey, horizonDays, params });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Read-only analytics over existing rows — never writes StockLedger or operational documents. */
export async function createAndExecuteScenario(params: {
  orgId: number;
  createdByUserId: number;
  templateKey: string;
  horizonDays: number;
  parametersJson: ScenarioParams;
}) {
  const inputsHash = hashInputs(params.templateKey, params.horizonDays, params.parametersJson);

  const run = await prisma.scenarioRun.create({
    data: {
      orgId: params.orgId,
      templateKey: params.templateKey,
      parametersJson: params.parametersJson as object,
      horizonDays: params.horizonDays,
      status: "RUNNING",
      engineVersion: SIM_ENGINE,
      inputsHash,
      baselineAt: new Date(),
      createdByUserId: params.createdByUserId,
    },
  });

  try {
    const result = await computeScenarioReadOnly({
      orgId: params.orgId,
      templateKey: params.templateKey,
      horizonDays: params.horizonDays,
      parametersJson: params.parametersJson,
    });

    const snapshot = await prisma.scenarioResultSnapshot.create({
      data: {
        scenarioRunId: run.id,
        outputsJson: result.outputs,
        driversJson: result.drivers,
      },
    });

    await prisma.scenarioRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", errorMessage: null },
    });

    return { runId: run.id, status: "SUCCEEDED" as const, result: snapshot };
  } catch (e: any) {
    await prisma.scenarioRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorMessage: String(e?.message ?? e).slice(0, 2000) },
    });
    throw e;
  }
}

async function computeScenarioReadOnly(input: {
  orgId: number;
  templateKey: string;
  horizonDays: number;
  parametersJson: ScenarioParams;
}) {
  const demandPct = Number(input.parametersJson.demandPct ?? 0);
  const leadAdd = Number(input.parametersJson.leadTimeAddDays ?? 0);
  const branchFilter = input.parametersJson.branchId;

  if (branchFilter != null) {
    const ok = await isBranchInOrg(input.orgId, Number(branchFilter));
    if (!ok) throw new Error("branchId does not belong to org");
  }

  const whereSug: any = {
    orgId: input.orgId,
    status: "OPEN",
  };
  if (branchFilter != null && Number.isFinite(Number(branchFilter))) whereSug.branchId = Number(branchFilter);

  const suggestions = await prisma.aiReplenishmentSuggestion.findMany({
    where: whereSug,
    take: 200,
    orderBy: { severity: "desc" },
    include: {
      branch: { select: { name: true } },
      variant: { select: { sku: true, title: true } },
    },
  });

  const baselineCritical = suggestions.filter((s: any) => s.severity === "CRITICAL").length;

  const topRisks = suggestions.slice(0, 15).map((s: any) => {
    const demandFactor = 1 + demandPct / 100;
    const leadStress = leadAdd > 0 ? 1 + Math.min(0.5, leadAdd / 30) : 1;
    const simulatedGap = Math.round(s.suggestedQty * demandFactor * leadStress);
    return {
      aiReplenishmentSuggestionId: s.id,
      branchId: s.branchId,
      branchName: s.branch?.name,
      variantId: s.variantId,
      sku: s.variant?.sku,
      baselineSuggestedQty: s.suggestedQty,
      simulatedStressQty: simulatedGap,
      explain: {
        demandPctApplied: demandPct,
        leadTimeAddDays: leadAdd,
        formula:
          "simulatedStressQty = round(suggestedQty * (1 + demandPct/100) * (1 + min(0.5, leadTimeAddDays/30))) — management heuristic only",
      },
    };
  });

  const bottleneckRanking = [
    {
      node: "replenishment_engine",
      score: baselineCritical + Math.ceil(suggestions.length * (demandPct / 200)),
      explain: "Ranked by count of OPEN suggestions after stress transform",
    },
  ];

  const outputs = {
    dataClassification: "SIMULATION_SANDBOX",
    isolationNote:
      "Heuristic stress only. Does not modify StockLedger, balances, or PO/SR rows. Persisted as ScenarioRun + ScenarioResultSnapshot for audit.",
    templateKey: input.templateKey,
    horizonDays: input.horizonDays,
    baseline: {
      openSuggestions: suggestions.length,
      criticalOpen: baselineCritical,
    },
    simulated: {
      stressedCriticalEstimate: Math.min(
        suggestions.length,
        Math.ceil(baselineCritical * (1 + demandPct / 100) * (1 + Math.min(0.4, leadAdd / 20)))
      ),
      notes: [
        "Sandbox only — does not change inventory.",
        "Use decision packages to record human review before operational APIs.",
      ],
    },
    topStockoutRisks: topRisks,
    bottleneckRanking,
  };

  const drivers = [
    { name: "demandPct", value: demandPct },
    { name: "leadTimeAddDays", value: leadAdd },
    { name: "rowsSampled", value: suggestions.length },
  ];

  return { outputs, drivers };
}

export async function listScenarioRuns(orgId: number, take = 50) {
  return prisma.scenarioRun.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take,
    include: { result: true },
  });
}

export async function getScenarioRun(orgId: number, runId: number) {
  return prisma.scenarioRun.findFirst({
    where: { id: runId, orgId },
    include: { result: true, createdBy: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
}

export async function cancelScenarioRun(orgId: number, runId: number) {
  const r = await prisma.scenarioRun.findFirst({ where: { id: runId, orgId } });
  if (!r) return { ok: false, message: "Not found" };
  if (r.status !== "QUEUED" && r.status !== "DRAFT") {
    return { ok: false, message: "Only QUEUED/DRAFT runs can be cancelled" };
  }
  await prisma.scenarioRun.update({
    where: { id: runId },
    data: { status: "CANCELLED" },
  });
  return { ok: true };
}

export const SCENARIO_TEMPLATES = [
  {
    templateKey: "DEMAND_SHOCK",
    label: "Demand shock",
    defaults: { demandPct: 10, leadTimeAddDays: 0 },
    description: "Scale replenishment pressure by demand percentage (heuristic).",
  },
  {
    templateKey: "LEAD_TIME_EXTENSION",
    label: "Lead time extension",
    defaults: { demandPct: 0, leadTimeAddDays: 3 },
    description: "Stress-test using extra lead-time days (heuristic).",
  },
  {
    templateKey: "COMBINED_STRESS",
    label: "Combined stress",
    defaults: { demandPct: 10, leadTimeAddDays: 2 },
    description: "Apply both demand and lead-time stress.",
  },
] as const;
