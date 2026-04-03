/**
 * Append-only audit snapshots for DoctorServiceFee rows.
 * Uses JSON-safe primitives for Prisma Json columns.
 */

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(d: unknown): string | null {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString();
  const t = new Date(d as string | number).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Stable snapshot of a DoctorServiceFee row (or partial) for change logs.
 */
export function snapshotDoctorServiceFeeRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row) return {};
  return {
    id: row.id,
    clinicStaffProfileId: row.clinicStaffProfileId,
    serviceId: row.serviceId,
    species: row.species ?? null,
    fee: num(row.fee),
    feeModel: row.feeModel ?? null,
    feePercent: row.feePercent != null ? num(row.feePercent) : null,
    fixedAmount: row.fixedAmount != null ? num(row.fixedAmount) : null,
    durationMin: row.durationMin ?? null,
    isActive: row.isActive,
    notes: row.notes ?? null,
    pendingManagerChangeAt: iso(row.pendingManagerChangeAt),
    pendingManagerChangeByUserId: row.pendingManagerChangeByUserId ?? null,
    doctorAcknowledgedAt: iso(row.doctorAcknowledgedAt),
    doctorAcknowledgedByUserId: row.doctorAcknowledgedByUserId ?? null,
    revisionNote: row.revisionNote ?? null,
    lastAgreedAt: iso(row.lastAgreedAt),
    lastAgreedFee: row.lastAgreedFee != null ? num(row.lastAgreedFee) : null,
    feeLockedByClinic: row.feeLockedByClinic,
  };
}

export async function appendDoctorServiceFeeChangeLog(
  db: {
    doctorServiceFeeChangeLog: { create: (args: unknown) => Promise<unknown> };
  },
  params: {
    doctorServiceFeeId: number | null | undefined;
    actorUserId: number;
    beforeJson: Record<string, unknown>;
    afterJson: Record<string, unknown>;
    changeReason?: string | null;
  }
): Promise<void> {
  const id = params.doctorServiceFeeId;
  if (id == null || !Number.isFinite(id)) return;
  const reason = params.changeReason != null ? String(params.changeReason).slice(0, 512) : null;
  await db.doctorServiceFeeChangeLog.create({
    data: {
      doctorServiceFeeId: id,
      actorUserId: params.actorUserId,
      beforeJson: params.beforeJson,
      afterJson: params.afterJson,
      changeReason: reason,
    },
  });
}
