/**
 * Medicine Incident Service (CCMLPA) — raise, assign, resolve incidents.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import type { MedicineIncidentType, MedicineIncidentSeverity, MedicineIncidentStatus } from "@prisma/client";

export type RaiseIncidentInput = {
  orgId: number;
  branchId: number;
  incidentType: MedicineIncidentType;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  severity?: MedicineIncidentSeverity;
};

export async function raiseIncident(data: RaiseIncidentInput): Promise<any> {
  return prisma.medicineIncident.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      incidentType: data.incidentType,
      relatedEntityType: data.relatedEntityType ?? null,
      relatedEntityId: data.relatedEntityId ?? null,
      severity: data.severity ?? "MEDIUM",
      status: "OPEN",
    },
    include: { branch: { select: { id: true, name: true } } },
  });
}

export async function assignInvestigator(incidentId: number, userId: number): Promise<any> {
  return prisma.medicineIncident.update({
    where: { id: incidentId },
    data: { assignedToUserId: userId, status: "INVESTIGATING" },
    include: { assignedTo: { select: { id: true }, profile: { select: { displayName: true } } } },
  });
}

export async function resolveIncident(incidentId: number, resolutionNotes: string): Promise<any> {
  return prisma.medicineIncident.update({
    where: { id: incidentId },
    data: { status: "RESOLVED", resolutionNotes },
    include: { discrepancies: true },
  });
}

export async function listIncidents(
  branchId: number,
  opts?: { status?: MedicineIncidentStatus; skip?: number; take?: number }
): Promise<{ list: any[]; total: number }> {
  const where: any = { branchId };
  if (opts?.status) where.status = opts.status;
  const [list, total] = await Promise.all([
    prisma.medicineIncident.findMany({
      where,
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 50, 100),
      include: { assignedTo: { select: { id: true }, profile: { select: { displayName: true } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.medicineIncident.count({ where }),
  ]);
  return { list, total };
}
