/**
 * Audit Intelligence Service (CCMLPA) — variance, risk score, compliance, leakage trend.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export async function getBranchManagerDashboard(branchId: number): Promise<any> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const now = new Date();
  const [issuedToday, unresolvedReturns, activeSessions, pendingApprovals] = await Promise.all([
    prisma.dispenseRequest.count({ where: { branchId, status: { in: ["ISSUED", "PARTIALLY_ISSUED"] }, createdAt: { gte: todayStart } } }),
    prisma.vialReturn.count({ where: { verificationStatus: "PENDING" } }),
    prisma.vialSession.count({ where: { branchId, status: { in: ["ACTIVE", "PARTIALLY_USED"] }, validUntil: { gt: now } } }),
    prisma.medicineApprovalRequest.count({ where: { branchId, status: "PENDING" } }),
  ]);
  return { issuedToday, unresolvedReturns, activeSessions, pendingApprovals };
}

export async function getPharmacyDashboard(branchId: number): Promise<any> {
  const [pendingRequests, approvedNotIssued, openBins] = await Promise.all([
    prisma.dispenseRequest.count({ where: { branchId, status: "PENDING" } }),
    prisma.dispenseRequest.count({ where: { branchId, status: "APPROVED" } }),
    prisma.auditBin.count({ where: { branchId, status: "OPEN" } }),
  ]);
  return { pendingRequests, approvedNotIssued, openBins };
}

export async function getAuditorDashboard(branchId: number): Promise<any> {
  const [quarantinedReturns, openIncidents, binsSealed] = await Promise.all([
    prisma.vialReturn.count({ where: { vialSession: { branchId }, verificationStatus: "QUARANTINED" } }),
    prisma.medicineIncident.count({ where: { branchId, status: { in: ["OPEN", "INVESTIGATING"] } } }),
    prisma.auditBin.count({ where: { branchId, status: "SEALED" } }),
  ]);
  return { quarantinedReturns, openIncidents, binsSealed };
}

export async function getOwnerDashboard(orgId: number): Promise<any> {
  const branches = await prisma.branch.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const summary = {
    branches: branches.length,
    totalPendingApprovals: await prisma.medicineApprovalRequest.count({ where: { orgId, status: "PENDING" } }),
    totalOpenIncidents: await prisma.medicineIncident.count({ where: { orgId, status: { in: ["OPEN", "INVESTIGATING"] } } }),
  };
  return summary;
}
