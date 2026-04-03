/**
 * Procurement sync — refreshes AiProcurementRecommendation rows (lighter than hourly full run).
 */
import prisma from "../../infrastructure/db/prismaClient";
import { refreshProcurementForBranch } from "../../api/v1/modules/ai_intelligence/procurement.service";

export async function runAiProcurementSyncJob(): Promise<{ success: boolean; error?: string }> {
  const run = await prisma.aiJobRun.create({
    data: { jobType: "AI_PROCUREMENT_SYNC", status: "RUNNING" },
  });
  try {
    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 500,
    });
    let processed = 0;
    for (const org of orgs) {
      const brs = await prisma.branch.findMany({
        where: { orgId: org.id },
        select: { id: true },
      });
      for (const b of brs) {
        const r = await refreshProcurementForBranch(org.id, b.id);
        processed += r.processed;
      }
    }
    await prisma.aiJobRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        statsJson: { variantsProcessed: processed } as any,
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
