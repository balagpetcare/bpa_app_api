/**
 * Hourly replenishment suggestion refresh (+ optional auto-draft when env set).
 */
import prisma from "../../infrastructure/db/prismaClient";
import {
  maybeAutoDraftStockRequest,
  refreshReplenishmentSuggestionsForBranch,
} from "../../api/v1/modules/ai_intelligence/replenishment.service";
import { refreshProcurementForBranch } from "../../api/v1/modules/ai_intelligence/procurement.service";

export async function runAiReplenishmentHourlyJob(): Promise<{ success: boolean; error?: string }> {
  const run = await prisma.aiJobRun.create({
    data: { jobType: "AI_REPLENISHMENT_HOURLY", status: "RUNNING" },
  });
  try {
    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, ownerUserId: true },
      take: 500,
    });
    let suggestions = 0;
    for (const org of orgs) {
      const brs = await prisma.branch.findMany({
        where: { orgId: org.id },
        select: { id: true },
      });
      for (const b of brs) {
        const r = await refreshReplenishmentSuggestionsForBranch(org.id, b.id);
        suggestions += r.created;
        await refreshProcurementForBranch(org.id, b.id);
        await maybeAutoDraftStockRequest(org.id, b.id, org.ownerUserId);
      }
    }
    await prisma.aiJobRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        statsJson: { suggestionRows: suggestions } as any,
      },
    });
    return { success: true };
  } catch (e: any) {
    await prisma.aiJobRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: String(e?.message || e) },
    });
    return { success: false, error: String(e?.message || e) };
  }
}
