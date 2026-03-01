/**
 * Admin Governance Products: list/detail/actions for producer products.
 * Status mapping: UNAPPROVED (no approval / draft), SUBMITTED, APPROVED, DECLINED (CHANGES_REQUESTED), REJECTED.
 */

import type { PrismaClient } from "@prisma/client";

export type GovernanceProductStatus =
  | "ALL"
  | "UNAPPROVED"
  | "SUBMITTED"
  | "APPROVED"
  | "DECLINED"
  | "REJECTED";

export type GovernanceProductAction =
  | "APPROVE"
  | "DECLINE"
  | "REJECT"
  | "RESET_TO_UNAPPROVED"
  | "PUBLISH"
  | "UNPUBLISH";

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Derive governance status for a product from product row and optional approval row.
 */
export function deriveCurrentStatus(
  product: { status: string },
  approval: { status: string } | null
): Exclude<GovernanceProductStatus, "ALL"> {
  if (product.status === "CHANGES_REQUESTED") return "DECLINED";
  if (!approval) return "UNAPPROVED";
  if (approval.status === "SUBMITTED") return "SUBMITTED";
  if (approval.status === "APPROVED") return "APPROVED";
  if (approval.status === "REJECTED") return "REJECTED";
  if (product.status === "REJECTED") return "REJECTED";
  return "UNAPPROVED";
}

export type ListGovernanceProductsParams = {
  status?: GovernanceProductStatus;
  producerOrgId?: number | null;
  q?: string | null;
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "updatedAt" | "name";
  sortDir?: "asc" | "desc";
};

export type GovernanceProductItem = {
  productId: number;
  name: string;
  sku: string;
  producerOrgId: number;
  producerOrgName: string;
  currentStatus: Exclude<GovernanceProductStatus, "ALL">;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ListGovernanceProductsResult = {
  items: GovernanceProductItem[];
  page: number;
  limit: number;
  total: number;
  facets: { statusCounts: Record<Exclude<GovernanceProductStatus, "ALL">, number> };
};

export async function listGovernanceProducts(
  prisma: PrismaClient,
  params: ListGovernanceProductsParams
): Promise<ListGovernanceProductsResult> {
  const status = params.status ?? "ALL";
  const producerOrgId = params.producerOrgId ?? null;
  const q = (params.q ?? "").trim().slice(0, 200) || null;
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const sortBy = params.sortBy ?? "createdAt";
  const sortDir = params.sortDir ?? "desc";

  const productWhere: Record<string, unknown> = {};
  if (producerOrgId != null) productWhere.producerOrgId = producerOrgId;
  if (q) {
    productWhere.OR = [
      { productName: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { producerOrg: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [products, approvals] = await Promise.all([
    prisma.authProduct.findMany({
      where: productWhere,
      select: {
        id: true,
        productName: true,
        sku: true,
        producerOrgId: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        reviewedByAdminId: true,
        createdAt: true,
        updatedAt: true,
        producerOrg: { select: { id: true, name: true } },
      },
    }),
    prisma.producerApproval.findMany({
      where: { entityType: "PRODUCT" },
      select: { entityId: true, producerOrgId: true, status: true },
    }),
  ]);

  const approvalByProductKey = new Map<string, { status: string }>();
  for (const a of approvals) {
    approvalByProductKey.set(`${a.producerOrgId}_${a.entityId}`, { status: a.status });
  }

  type Row = GovernanceProductItem & { _sortCreated: Date; _sortUpdated: Date; _sortName: string };
  const rows: Row[] = products.map((p) => {
    const approval = approvalByProductKey.get(`${p.producerOrgId}_${p.id}`) ?? null;
    const currentStatus = deriveCurrentStatus(p, approval);
    return {
      productId: p.id,
      name: p.productName,
      sku: p.sku,
      producerOrgId: p.producerOrgId,
      producerOrgName: p.producerOrg?.name ?? "",
      currentStatus,
      status: p.status,
      submittedAt: p.submittedAt?.toISOString() ?? null,
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      reviewedBy: p.reviewedByAdminId ?? null,
      isActive: p.status === "ACTIVE",
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      _sortCreated: p.createdAt,
      _sortUpdated: p.updatedAt,
      _sortName: (p.productName ?? "").toLowerCase(),
    };
  });

  const statusCounts: Record<Exclude<GovernanceProductStatus, "ALL">, number> = {
    UNAPPROVED: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    DECLINED: 0,
    REJECTED: 0,
  };
  for (const r of rows) statusCounts[r.currentStatus] += 1;

  let filtered = rows;
  if (status !== "ALL") {
    filtered = rows.filter((r) => r.currentStatus === status);
  }

  const sortKey = sortBy === "name" ? "_sortName" : sortBy === "updatedAt" ? "_sortUpdated" : "_sortCreated";
  filtered.sort((a, b) => {
    const va = a[sortKey as keyof Row];
    const vb = b[sortKey as keyof Row];
    if (typeof va === "string" && typeof vb === "string")
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    const tA = (va as Date)?.getTime?.() ?? 0;
    const tB = (vb as Date)?.getTime?.() ?? 0;
    return sortDir === "asc" ? tA - tB : tB - tA;
  });

  const total = filtered.length;
  const skip = (page - 1) * limit;
  const items = filtered.slice(skip, skip + limit).map(({ _sortCreated, _sortUpdated, _sortName, ...rest }) => rest);

  return {
    items,
    page,
    limit,
    total,
    facets: { statusCounts },
  };
}

export async function getGovernanceProductDetail(
  prisma: PrismaClient,
  productId: number
): Promise<Record<string, unknown> | null> {
  const product = await prisma.authProduct.findUnique({
    where: { id: productId },
    include: {
      producerOrg: { select: { id: true, name: true } },
      proofs: { include: { media: { select: { id: true, url: true } } } },
    },
  });
  if (!product) return null;

  const approval = await prisma.producerApproval.findUnique({
    where: {
      producerOrgId_entityType_entityId: {
        producerOrgId: product.producerOrgId,
        entityType: "PRODUCT",
        entityId: product.id,
      },
    },
    select: { id: true, status: true, submittedByUserId: true, reviewedByUserId: true, reviewedAt: true, note: true },
  });

  const currentStatus = deriveCurrentStatus(product, approval);

  return {
    productId: product.id,
    name: product.productName,
    sku: product.sku,
    brandName: product.brandName,
    productType: product.productType,
    packSize: product.packSize,
    description: product.description,
    specJson: product.specJson,
    status: product.status,
    currentStatus,
    producerOrgId: product.producerOrgId,
    producerOrgName: product.producerOrg?.name ?? null,
    producerOrg: product.producerOrg,
    submittedAt: product.submittedAt?.toISOString() ?? null,
    reviewedAt: product.reviewedAt?.toISOString() ?? null,
    reviewedByAdminId: product.reviewedByAdminId,
    reviewNotes: product.reviewNotes,
    proofs: product.proofs,
    approvalId: approval?.id ?? null,
    approvalStatus: approval?.status ?? null,
    approvalNote: approval?.note ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

/** Trust & Safety: block approve/publish if an enforcement hold exists on this product or org. */
export async function checkNoEnforcementHold(
  prisma: PrismaClient,
  productId: number,
  producerOrgId: number
): Promise<void> {
  const hold = await prisma.enforcementAction.findFirst({
    where: {
      status: "APPLIED",
      OR: [
        { targetType: "PRODUCT", targetId: String(productId) },
        { targetType: "ORG", targetId: String(producerOrgId) },
      ],
    },
    include: { case: { select: { caseNo: true } } },
  });
  if (hold) {
    const err = new Error(`Blocked by enforcement case ${hold.case?.caseNo ?? ""}. Resolve or revert the enforcement action first.`) as Error & { code?: string; statusCode?: number };
    err.code = "ENFORCEMENT_HOLD";
    err.statusCode = 403;
    throw err;
  }
}

export async function actOnGovernanceProduct(
  prisma: PrismaClient,
  productId: number,
  action: GovernanceProductAction,
  options: { note?: string | null; reviewedByUserId: number }
): Promise<{ success: boolean; message: string }> {
  const product = await prisma.authProduct.findFirst({
    where: { id: productId },
    select: { id: true, producerOrgId: true, status: true, productName: true },
  });
  if (!product) throw new Error("NOT_FOUND");

  if (action === "APPROVE" || action === "PUBLISH") {
    await checkNoEnforcementHold(prisma, productId, product.producerOrgId);
  }

  const approval = await prisma.producerApproval.findUnique({
    where: {
      producerOrgId_entityType_entityId: {
        producerOrgId: product.producerOrgId,
        entityType: "PRODUCT",
        entityId: product.id,
      },
    },
  });

  const producerApproval = require("../../modules/producer/producerApproval.service");
  const now = new Date();
  const reviewedByUserId = options.reviewedByUserId;
  const note = options.note ?? null;

  // Ensure approval row exists for admin-driven flows (so any status can be transitioned without "no approval" errors)
  let approvalRow = approval;
  if (!approvalRow) {
    approvalRow = await prisma.producerApproval.upsert({
      where: {
        producerOrgId_entityType_entityId: {
          producerOrgId: product.producerOrgId,
          entityType: "PRODUCT",
          entityId: product.id,
        },
      },
      create: {
        producerOrgId: product.producerOrgId,
        entityType: "PRODUCT",
        entityId: product.id,
        status: "APPROVED",
        submittedByUserId: reviewedByUserId,
        reviewedByUserId,
        reviewedAt: now,
      },
      update: {},
    });
  }

  if (action === "APPROVE") {
    if (approvalRow.status === "SUBMITTED") {
      const compliance = require("./compliance.service");
      const result = await compliance.runProductComplianceChecks(prisma, productId);
      if (!result.passed) {
        const err = new Error("COMPLIANCE_FAILED") as Error & { details?: unknown };
        err.details = result;
        throw err;
      }
      await producerApproval.approveApproval(product.producerOrgId, approvalRow.id, reviewedByUserId, note ?? undefined, undefined);
      return { success: true, message: "Approved" };
    }
    if (approvalRow.status === "APPROVED" && (product.status === "UNDER_REVIEW" || product.status === "REJECTED" || product.status === "CHANGES_REQUESTED" || product.status === "DRAFT")) {
      if (product.status === "UNDER_REVIEW") {
        await producerApproval.activateProductForPlatform(product.producerOrgId, approvalRow.id, reviewedByUserId, note ?? undefined);
      } else {
        await prisma.authProduct.update({
          where: { id: productId },
          data: { status: "ACTIVE", reviewedAt: now, reviewedByAdminId: reviewedByUserId, reviewNotes: note ? String(note).slice(0, 2000) : null },
        });
      }
      return { success: true, message: "Published" };
    }
    if (approvalRow.status === "APPROVED" && product.status === "ACTIVE") {
      return { success: true, message: "Already published" };
    }
    if (approvalRow.status === "APPROVED" && product.status === "INACTIVE") {
      await prisma.authProduct.update({
        where: { id: productId },
        data: { status: "ACTIVE", reviewedAt: now, reviewedByAdminId: reviewedByUserId, reviewNotes: note ? String(note).slice(0, 2000) : null },
      });
      return { success: true, message: "Reactivated" };
    }
    if (approvalRow.status === "REJECTED") {
      await prisma.$transaction([
        prisma.producerApproval.update({
          where: { id: approvalRow.id },
          data: { status: "APPROVED", reviewedByUserId, reviewedAt: now, note: note ? String(note).slice(0, 2000) : null },
        }),
        prisma.authProduct.update({
          where: { id: productId },
          data: { status: "UNDER_REVIEW", submittedAt: product.submittedAt ?? now, reviewedAt: now, reviewedByAdminId: reviewedByUserId, reviewNotes: note ? String(note).slice(0, 2000) : null },
        }),
      ]);
      return { success: true, message: "Approved (admin override)" };
    }
    return { success: true, message: "Approved" };
  }

  if (action === "DECLINE") {
    const ops: Promise<unknown>[] = [
      prisma.authProduct.update({
        where: { id: productId },
        data: { status: "CHANGES_REQUESTED", reviewedAt: now, reviewedByAdminId: reviewedByUserId, reviewNotes: note ? String(note).slice(0, 2000) : null },
      }),
    ];
    if (approvalRow) {
      ops.unshift(
        prisma.producerApproval.update({
          where: { id: approvalRow.id },
          data: { status: "REJECTED", reviewedByUserId, reviewedAt: now, note: note ? String(note).slice(0, 2000) : null },
        })
      );
    }
    await prisma.$transaction(ops);
    return { success: true, message: "Changes requested" };
  }

  if (action === "REJECT") {
    const reason = (note ?? "").trim().length >= 5 ? (note ?? "").trim() : "Rejected by admin";
    const ops: Promise<unknown>[] = [
      prisma.authProduct.update({
        where: { id: productId },
        data: { status: "REJECTED", reviewedAt: now, reviewedByAdminId: reviewedByUserId, reviewNotes: reason },
      }),
    ];
    if (approvalRow) {
      ops.unshift(
        prisma.producerApproval.update({
          where: { id: approvalRow.id },
          data: { status: "REJECTED", reviewedByUserId, reviewedAt: now, note: reason },
        })
      );
    }
    await prisma.$transaction(ops);
    return { success: true, message: "Rejected" };
  }

  if (action === "RESET_TO_UNAPPROVED") {
    await prisma.authProduct.update({
      where: { id: productId },
      data: {
        status: "DRAFT",
        submittedAt: null,
        reviewedAt: null,
        reviewedByAdminId: null,
        reviewNotes: note ? String(note).slice(0, 2000) : null,
      },
    });
    return { success: true, message: "Reset to unapproved" };
  }

  if (action === "PUBLISH") {
    if (product.status === "ACTIVE") return { success: true, message: "Already published" };
    if (approvalRow) {
      await prisma.producerApproval.update({
        where: { id: approvalRow.id },
        data: { status: "APPROVED", reviewedByUserId, reviewedAt: now, note: note ? String(note).slice(0, 2000) : null },
      });
    }
    await prisma.authProduct.update({
      where: { id: productId },
      data: { status: "ACTIVE", reviewedAt: now, reviewedByAdminId: reviewedByUserId, reviewNotes: note ? String(note).slice(0, 2000) : null },
    });
    return { success: true, message: "Published" };
  }

  if (action === "UNPUBLISH") {
    await prisma.authProduct.update({
      where: { id: productId },
      data: { status: "INACTIVE", reviewedAt: now, reviewedByAdminId: reviewedByUserId, reviewNotes: note ? String(note).slice(0, 2000) : null },
    });
    return { success: true, message: "Unpublished" };
  }

  throw new Error("UNKNOWN_ACTION");
}
