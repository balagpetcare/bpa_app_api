/**
 * Staff/manager service pricing matrix, audit logs, and service media ordering.
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const {
  resolveServiceListPriceFromRows,
  computeDoctorFeeAmountFromRow,
} = require("./servicePricingResolution.service");

function pickServicePricingSnapshot(svc: Record<string, unknown>) {
  return {
    price: svc.price != null ? Number(svc.price) : null,
    baseCost: svc.baseCost != null ? Number(svc.baseCost) : null,
    minSafePrice: svc.minSafePrice != null ? Number(svc.minSafePrice) : null,
    staffInstructions: svc.staffInstructions ?? null,
    pricingExplanation: svc.pricingExplanation ?? null,
    visibleToPublic: svc.visibleToPublic,
    preparationNotes: svc.preparationNotes ?? null,
    aftercareNotes: svc.aftercareNotes ?? null,
    faqJson: svc.faqJson ?? null,
    duration: svc.duration ?? null,
    name: svc.name ?? null,
    category: svc.category ?? null,
    description: svc.description ?? null,
    status: svc.status ?? null,
  };
}

function pickDoctorFeeSnapshot(row: Record<string, unknown>) {
  return {
    fee: row.fee != null ? Number(row.fee) : null,
    feeModel: row.feeModel ?? null,
    feePercent: row.feePercent != null ? Number(row.feePercent) : null,
    fixedAmount: row.fixedAmount != null ? Number(row.fixedAmount) : null,
    durationMin: row.durationMin ?? null,
    isActive: row.isActive,
    notes: row.notes ?? null,
    species: row.species ?? null,
    pendingManagerChangeAt: row.pendingManagerChangeAt ?? null,
    doctorAcknowledgedAt: row.doctorAcknowledgedAt ?? null,
    feeLockedByClinic: row.feeLockedByClinic,
    revisionNote: row.revisionNote ?? null,
  };
}

export async function getServicePricingMatrix(branchId: number, opts?: { limit?: number }) {
  const limit = opts?.limit ?? 500;
  const services = await prisma.service.findMany({
    where: { branchId },
    include: { pricingVariants: true },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: limit,
  });

  const serviceIds = services.map((s: { id: number }) => s.id);
  if (serviceIds.length === 0) {
    return { services: [], doctors: [], feeRows: [], mappings: [] };
  }

  const [mappings, feeRows, doctors] = await Promise.all([
    prisma.doctorServiceMapping.findMany({
      where: { branchId, serviceId: { in: serviceIds } },
      include: {
        clinicStaffProfile: {
          select: {
            id: true,
            branchMemberId: true,
            branchMember: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
          },
        },
        service: { select: { id: true, name: true } },
      },
    }),
    prisma.doctorServiceFee.findMany({
      where: {
        serviceId: { in: serviceIds },
        clinicStaffProfile: { branchId },
      },
      include: {
        clinicStaffProfile: {
          select: {
            id: true,
            branchMemberId: true,
            branchMember: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
          },
        },
      },
    }),
    prisma.clinicStaffProfile.findMany({
      where: { branchId, staffType: "DOCTOR" },
      select: {
        id: true,
        branchMemberId: true,
        branchMember: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
      },
    }),
  ]);

  const rows = services.map((s: any) => {
    const listPrice = resolveServiceListPriceFromRows(s);
    const variantCount = (s.pricingVariants || []).length;
    const svcFees = feeRows.filter((f: any) => f.serviceId === s.id);
    const amounts = svcFees
      .map((f: any) => computeDoctorFeeAmountFromRow(f, listPrice))
      .filter((n: number) => n > 0);
    const feeMin = amounts.length ? Math.min(...amounts) : null;
    const feeMax = amounts.length ? Math.max(...amounts) : null;
    const pendingAckCount = svcFees.filter((f: any) => f.pendingManagerChangeAt && !f.doctorAcknowledgedAt).length;

    return {
      id: s.id,
      name: s.name,
      category: s.category,
      serviceCode: s.serviceCode,
      status: s.status,
      duration: s.duration,
      price: Number(s.price),
      baseCost: s.baseCost != null ? Number(s.baseCost) : null,
      minSafePrice: s.minSafePrice != null ? Number(s.minSafePrice) : null,
      staffInstructions: s.staffInstructions ?? null,
      pricingExplanation: s.pricingExplanation ?? null,
      preparationNotes: s.preparationNotes ?? null,
      aftercareNotes: s.aftercareNotes ?? null,
      listPrice,
      variantCount,
      visibleToPublic: s.visibleToPublic,
      feeMin,
      feeMax,
      pendingAckCount,
      assignedDoctorCount: new Set(mappings.filter((m: any) => m.serviceId === s.id && m.isAllowed).map((m: any) => m.clinicStaffProfileId))
        .size,
    };
  });

  return {
    services: rows,
    doctors: doctors.map((d: any) => ({
      profileId: d.id,
      memberId: d.branchMemberId,
      displayName: d.branchMember?.user?.profile?.displayName ?? `Doctor #${d.branchMemberId}`,
    })),
    feeRows: feeRows.map((f: any) => ({
      id: f.id,
      serviceId: f.serviceId,
      profileId: f.clinicStaffProfileId,
      memberId: f.clinicStaffProfile?.branchMemberId,
      doctorName: f.clinicStaffProfile?.branchMember?.user?.profile?.displayName,
      ...pickDoctorFeeSnapshot(f),
      pendingAck: !!(f.pendingManagerChangeAt && !f.doctorAcknowledgedAt),
      resolvedAmount: computeDoctorFeeAmountFromRow(
        f,
        resolveServiceListPriceFromRows(
          services.find((x: any) => x.id === f.serviceId) || { price: 0, pricingVariants: [] }
        )
      ),
    })),
    mappings: mappings.map((m: any) => ({
      id: m.id,
      serviceId: m.serviceId,
      profileId: m.clinicStaffProfileId,
      memberId: m.clinicStaffProfile?.branchMemberId,
      isAllowed: m.isAllowed,
      role: m.role,
      status: m.status,
    })),
  };
}

export async function listServicePricingHistory(branchId: number, serviceId: number, opts?: { limit?: number }) {
  const svc = await prisma.service.findFirst({ where: { id: serviceId, branchId }, select: { id: true } });
  if (!svc) throw new Error("Service not found");

  const items = await prisma.servicePricingChangeLog.findMany({
    where: { branchId, serviceId },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
  });
  return items;
}

export async function listDoctorFeeHistory(branchId: number, memberId: number, opts?: { limit?: number }) {
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId: memberId },
    select: { id: true },
  });
  if (!profile) throw new Error("Doctor not found in branch");

  const fees = await prisma.doctorServiceFee.findMany({
    where: { clinicStaffProfileId: profile.id },
    select: { id: true },
  });
  const ids = fees.map((f: { id: number }) => f.id);
  if (ids.length === 0) return [];

  return prisma.doctorServiceFeeChangeLog.findMany({
    where: { doctorServiceFeeId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
  });
}

export async function patchBranchServicePricing(
  branchId: number,
  serviceId: number,
  actorUserId: number,
  body: Record<string, unknown>,
  reason?: string | null
) {
  const existing = await prisma.service.findFirst({
    where: { id: serviceId, branchId },
    include: { pricingVariants: true },
  });
  if (!existing) throw new Error("Service not found");

  const before = pickServicePricingSnapshot(existing as any);

  const data: Record<string, unknown> = {};
  const allowed = [
    "price",
    "baseCost",
    "minSafePrice",
    "staffInstructions",
    "pricingExplanation",
    "visibleToPublic",
    "preparationNotes",
    "aftercareNotes",
    "faqJson",
    "duration",
    "name",
    "category",
    "description",
    "status",
  ] as const;

  for (const key of allowed) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  if (data.price !== undefined) data.price = Number(data.price);
  if (data.baseCost !== undefined) data.baseCost = data.baseCost == null ? null : Number(data.baseCost);
  if (data.minSafePrice !== undefined) data.minSafePrice = data.minSafePrice == null ? null : Number(data.minSafePrice);
  if (data.duration !== undefined) data.duration = data.duration == null ? null : Number(data.duration);
  if (data.visibleToPublic !== undefined) data.visibleToPublic = Boolean(data.visibleToPublic);

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: data as any,
    include: { pricingVariants: true },
  });

  const after = pickServicePricingSnapshot(updated as any);

  await prisma.servicePricingChangeLog.create({
    data: {
      branchId,
      serviceId,
      actorUserId,
      beforeJson: before as object,
      afterJson: after as object,
      reason: reason?.slice(0, 512) ?? null,
    },
  });

  return updated;
}

export async function listServiceMedia(serviceId: number, branchId: number) {
  const svc = await prisma.service.findFirst({ where: { id: serviceId, branchId }, select: { id: true } });
  if (!svc) throw new Error("Service not found");

  return prisma.serviceMedia.findMany({
    where: { serviceId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { media: { select: { id: true, url: true, type: true, mimeType: true, altText: true } } },
  });
}

export async function putServiceMediaOrder(
  serviceId: number,
  branchId: number,
  items: Array<{ mediaId: number; kind?: string; sortOrder?: number }>
) {
  const svc = await prisma.service.findFirst({ where: { id: serviceId, branchId }, select: { id: true } });
  if (!svc) throw new Error("Service not found");

  await prisma.serviceMedia.deleteMany({ where: { serviceId } });

  if (!items?.length) return [];

  const allowedKinds = new Set(["HERO", "GALLERY", "VIDEO"]);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const kind = allowedKinds.has(String(it.kind)) ? String(it.kind) : "GALLERY";
    await prisma.serviceMedia.create({
      data: {
        serviceId,
        mediaId: it.mediaId,
        kind: kind as any,
        sortOrder: it.sortOrder ?? i,
      },
    });
  }

  return listServiceMedia(serviceId, branchId);
}
