/**
 * Wave-4 rollup: cost facts + CTS, SLO measurements, operational exception index.
 * ORG_ID=1 WINDOW_DAYS=30 npm run job:wave4-rollup
 */
import { runCostRollup } from "../../api/v1/modules/operational_intelligence/financialIntelligence.service";
import { evaluateSlosForOrg } from "../../api/v1/modules/operational_intelligence/slo.service";
import { refreshOperationalExceptions } from "../../api/v1/modules/operational_intelligence/operationalExceptionIndex.service";

export async function runWave4RollupForOrg(
  orgId: number,
  windowDays = 30
): Promise<{ success: boolean; error?: string; cost?: unknown; slo?: unknown; exceptions?: unknown }> {
  if (!Number.isFinite(orgId) || orgId <= 0) {
    return { success: false, error: "invalid orgId" };
  }
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - windowDays * 86400000);
  const window = { periodStart, periodEnd };
  try {
    const cost = await runCostRollup(orgId, window);
    const slo = await evaluateSlosForOrg(orgId, window);
    const exceptions = await refreshOperationalExceptions(orgId);
    return { success: true, cost, slo, exceptions };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}
