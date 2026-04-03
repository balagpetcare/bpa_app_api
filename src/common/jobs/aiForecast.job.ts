/**
 * Daily AI forecast job — recomputes AiForecastSnapshot per org/branch.
 */
import prisma from "../../infrastructure/db/prismaClient";
import { runForecastForBranch } from "../../api/v1/modules/ai_intelligence/aiForecast.service";

export async function runAiForecastDailyJob(): Promise<{
  success: boolean;
  branches: number;
  error?: string;
}> {
  const run = await prisma.aiJobRun.create({
    data: { jobType: "AI_FORECAST_DAILY", status: "RUNNING" },
  });
  try {
    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 500,
    });
    let branches = 0;
    for (const org of orgs) {
      const brs = await prisma.branch.findMany({
        where: { orgId: org.id },
        select: { id: true },
      });
      for (const b of brs) {
        await runForecastForBranch(org.id, b.id, { maxVariants: 300 });
        branches++;
      }
    }
    await prisma.aiJobRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        statsJson: { branchesProcessed: branches, orgs: orgs.length } as any,
      },
    });
    return { success: true, branches };
  } catch (e: any) {
    await prisma.aiJobRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: String(e?.message || e) },
    });
    return { success: false, branches: 0, error: String(e?.message || e) };
  }
}
