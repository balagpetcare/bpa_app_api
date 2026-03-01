/**
 * Product revision snapshots for governance: capture product state at submission, diff, history.
 */

import type { PrismaClient } from "@prisma/client";

const SNAPSHOT_FIELDS = [
  "id",
  "producerOrgId",
  "factoryId",
  "brandName",
  "productName",
  "productType",
  "sku",
  "packSize",
  "description",
  "specJson",
  "status",
  "submittedAt",
  "reviewedAt",
  "reviewNotes",
  "createdAt",
  "updatedAt",
] as const;

export type RevisionSnapshot = Record<string, unknown>;

export async function createRevisionSnapshot(
  prisma: PrismaClient,
  params: { productId: number; submittedByUserId: number; approvalId?: number | null }
): Promise<{ revision: { id: number; revisionNumber: number }; snapshot: RevisionSnapshot }> {
  const product = await prisma.authProduct.findUnique({
    where: { id: params.productId },
    include: {
      proofs: { include: { media: { select: { id: true, url: true } } } },
    },
  });
  if (!product) {
    const err = new Error("Product not found") as Error & { code?: string; statusCode?: number };
    err.code = "PRODUCT_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  const snapshot: RevisionSnapshot = {};
  for (const k of SNAPSHOT_FIELDS) {
    const v = (product as Record<string, unknown>)[k];
    if (v !== undefined) snapshot[k] = v;
  }
  snapshot.proofs = (product as any).proofs ?? [];

  const last = await prisma.productRevision.findFirst({
    where: { authProductId: params.productId },
    orderBy: { revisionNumber: "desc" },
    select: { revisionNumber: true },
  });
  const revisionNumber = (last?.revisionNumber ?? 0) + 1;

  const revision = await prisma.productRevision.create({
    data: {
      authProductId: params.productId,
      revisionNumber,
      snapshotJson: snapshot as any,
      submittedByUserId: params.submittedByUserId,
      approvalId: params.approvalId ?? undefined,
    },
  });

  return { revision: { id: revision.id, revisionNumber }, snapshot };
}

export async function getRevisionHistory(
  prisma: PrismaClient,
  productId: number
): Promise<{ revisionNumber: number; id: number; submittedByUserId: number; approvalId: number | null; createdAt: Date }[]> {
  const rows = await prisma.productRevision.findMany({
    where: { authProductId: productId },
    orderBy: { revisionNumber: "asc" },
    select: { id: true, revisionNumber: true, submittedByUserId: true, approvalId: true, createdAt: true },
  });
  return rows;
}

export async function getRevisionSnapshot(
  prisma: PrismaClient,
  productId: number,
  revisionNumber: number
): Promise<RevisionSnapshot | null> {
  const row = await prisma.productRevision.findUnique({
    where: { authProductId_revisionNumber: { authProductId: productId, revisionNumber } },
    select: { snapshotJson: true },
  });
  return row?.snapshotJson ? (row.snapshotJson as RevisionSnapshot) : null;
}

/** Field-level diff between two revisions. Returns { field: { from, to } } for changed fields. */
export async function getRevisionDiff(
  prisma: PrismaClient,
  productId: number,
  revA: number,
  revB: number
): Promise<Record<string, { from: unknown; to: unknown }>> {
  const [snapA, snapB] = await Promise.all([
    getRevisionSnapshot(prisma, productId, revA),
    getRevisionSnapshot(prisma, productId, revB),
  ]);
  if (!snapA || !snapB) return {};

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const allKeys = new Set([...Object.keys(snapA), ...Object.keys(snapB)]);
  for (const key of allKeys) {
    if (key === "proofs") continue; // optional: deep compare proofs later
    const a = (snapA as Record<string, unknown>)[key];
    const b = (snapB as Record<string, unknown>)[key];
    const aStr = JSON.stringify(a);
    const bStr = JSON.stringify(b);
    if (aStr !== bStr) diff[key] = { from: a, to: b };
  }
  return diff;
}
