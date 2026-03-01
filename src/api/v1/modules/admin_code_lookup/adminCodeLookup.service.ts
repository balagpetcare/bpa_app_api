/**
 * Admin Code Lookup: enrich traceByCode with verification history and code identity.
 * Block/unblock code (permission-gated).
 */

const prisma = require("../../../../infrastructure/db/prismaClient");
const { traceByCode } = require("../admin_enforcement/admin_enforcement.service");
const { hmacHash } = require("../../utils/authCodeHasher");

const DEFAULT_VERIFICATION_LIMIT = 20;
const MAX_VERIFICATION_LIMIT = 100;

export interface CodeLookupResult {
  found: boolean;
  code?: {
    id: number;
    codeHashMasked: string;
    status: string;
    verifyCount: number;
    firstVerifiedAt: string | null;
    issuedAt: string | null;
    printedAt: string | null;
  };
  batch?: {
    id: number;
    batchNo: string;
    status: string;
    mfgDate: string | null;
    expDate: string | null;
    frozenAt: string | null;
    quarantinedAt: string | null;
  };
  product?: {
    id: number;
    productName: string;
    sku: string;
    brandName: string;
    status: string;
  };
  producerOrg?: {
    id: number;
    name: string;
    status: string;
    countryCode: string | null;
  };
  verificationHistory?: Array<{
    id: number;
    result: string;
    country: string | null;
    createdAt: string;
  }>;
}

export async function lookupCode(publicCode: string, verificationLimit: number = DEFAULT_VERIFICATION_LIMIT): Promise<CodeLookupResult> {
  const codeStr = String(publicCode || "").trim();
  if (!codeStr) {
    return { found: false };
  }

  const trace = await traceByCode(prisma, codeStr);
  if (!trace?.code) {
    return { found: false };
  }

  const codeId = trace.code.id;
  const limit = Math.min(Math.max(1, verificationLimit), MAX_VERIFICATION_LIMIT);

  const [codeRow, logs] = await Promise.all([
    prisma.authCode.findUnique({
      where: { id: codeId },
      select: {
        id: true,
        codeHash: true,
        status: true,
        verifyCount: true,
        firstVerifiedAt: true,
        issuedAt: true,
        printedAt: true,
        batch: {
          select: {
            id: true,
            batchNo: true,
            status: true,
            mfgDate: true,
            expDate: true,
            frozenAt: true,
            quarantinedAt: true,
            authProduct: {
              select: {
                id: true,
                productName: true,
                sku: true,
                brandName: true,
                status: true,
                producerOrg: {
                  select: { id: true, name: true, status: true, countryCode: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.authVerificationLog.findMany({
      where: { codeId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, result: true, country: true, createdAt: true },
    }),
  ]);

  if (!codeRow) {
    return { found: false };
  }

  const batch = codeRow.batch as any;
  const product = batch?.authProduct;
  const producerOrg = product?.producerOrg;

  const toIso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

  return {
    found: true,
    code: {
      id: codeRow.id,
      codeHashMasked: (codeRow.codeHash as string).slice(0, 12) + "...",
      status: codeRow.status,
      verifyCount: codeRow.verifyCount ?? 0,
      firstVerifiedAt: toIso(codeRow.firstVerifiedAt),
      issuedAt: toIso(codeRow.issuedAt),
      printedAt: toIso(codeRow.printedAt),
    },
    batch: batch
      ? {
          id: batch.id,
          batchNo: batch.batchNo,
          status: batch.status,
          mfgDate: toIso(batch.mfgDate),
          expDate: toIso(batch.expDate),
          frozenAt: toIso(batch.frozenAt),
          quarantinedAt: toIso(batch.quarantinedAt),
        }
      : undefined,
    product: product
      ? {
          id: product.id,
          productName: product.productName,
          sku: product.sku,
          brandName: product.brandName ?? "",
          status: product.status,
        }
      : undefined,
    producerOrg: producerOrg
      ? {
          id: producerOrg.id,
          name: producerOrg.name,
          status: producerOrg.status,
          countryCode: producerOrg.countryCode ?? null,
        }
      : undefined,
    verificationHistory: logs.map((l: any) => ({
      id: l.id,
      result: l.result,
      country: l.country ?? null,
      createdAt: new Date(l.createdAt).toISOString(),
    })),
  };
}

export async function getVerificationHistory(
  publicCode: string,
  page: number = 1,
  limit: number = 20
): Promise<{ items: any[]; total: number; page: number; limit: number }> {
  const codeStr = String(publicCode || "").trim();
  if (!codeStr) {
    return { items: [], total: 0, page: 1, limit: Math.min(limit, MAX_VERIFICATION_LIMIT) };
  }

  const codeHash = hmacHash(codeStr);
  const code = await prisma.authCode.findUnique({
    where: { codeHash },
    select: { id: true },
  });
  if (!code) {
    return { items: [], total: 0, page, limit };
  }

  const take = Math.min(Math.max(1, limit), MAX_VERIFICATION_LIMIT);
  const skip = (Math.max(1, page) - 1) * take;

  const [items, total] = await Promise.all([
    prisma.authVerificationLog.findMany({
      where: { codeId: code.id },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true, result: true, country: true, userId: true, createdAt: true, publicCodeMasked: true },
    }),
    prisma.authVerificationLog.count({ where: { codeId: code.id } }),
  ]);

  return {
    items: items.map((l: any) => ({
      id: l.id,
      result: l.result,
      country: l.country,
      userId: l.userId,
      createdAt: new Date(l.createdAt).toISOString(),
      publicCodeMasked: l.publicCodeMasked,
    })),
    total,
    page,
    limit: take,
  };
}

export async function blockOrUnblockCode(
  publicCode: string,
  action: "BLOCK" | "UNBLOCK",
  reason: string,
  userId: number
): Promise<{ updated: boolean; message: string }> {
  const codeStr = String(publicCode || "").trim();
  if (!codeStr) {
    const err = new Error("Code required") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "MISSING_CODE";
    throw err;
  }
  if (action !== "BLOCK" && action !== "UNBLOCK") {
    const err = new Error("action must be BLOCK or UNBLOCK") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "INVALID_ACTION";
    throw err;
  }
  if (reason && reason.trim().length < 5) {
    const err = new Error("reason required (min 5 characters)") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "REASON_REQUIRED";
    throw err;
  }

  const codeHash = hmacHash(codeStr);
  const code = await prisma.authCode.findUnique({
    where: { codeHash },
    select: { id: true, status: true },
  });
  if (!code) {
    const err = new Error("Code not found") as Error & { statusCode?: number; code?: string };
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const newStatus = action === "BLOCK" ? "BLOCKED" : "UNUSED";
  await prisma.authCode.update({
    where: { id: code.id },
    data: { status: newStatus },
  });

  return {
    updated: true,
    message: action === "BLOCK" ? "Code blocked" : "Code unblocked",
  };
}
