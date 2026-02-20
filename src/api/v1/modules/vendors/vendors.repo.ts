/**
 * Vendor repository – org-scoped Prisma queries.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { VendorStatus } from "@prisma/client";

export async function getNextVendorCode(orgId: number): Promise<string> {
  const last = await prisma.vendor.findFirst({
    where: { orgId, code: { not: null } },
    orderBy: { id: "desc" },
    select: { code: true },
  });
  if (!last?.code) {
    const count = await prisma.vendor.count({ where: { orgId } });
    return `VEN-${String(count + 1).padStart(4, "0")}`;
  }
  const match = last.code.match(/^VEN-(\d+)$/);
  const num = match ? parseInt(match[1], 10) + 1 : 1;
  return `VEN-${String(num).padStart(4, "0")}`;
}

export async function listVendors(filter: {
  orgId: number;
  search?: string;
  status?: VendorStatus;
  page?: number;
  limit?: number;
}) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    orgId: filter.orgId,
  };
  if (filter.status) where.status = filter.status;
  if (filter.search?.trim()) {
    const q = filter.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { grns: true } },
      },
    }),
    prisma.vendor.count({ where }),
  ]);

  return {
    items: items.map((v) => ({
      ...v,
      orderCount: v._count.grns,
      _count: undefined,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getVendorById(id: number, orgId: number) {
  return prisma.vendor.findFirst({
    where: { id, orgId },
    include: {
      contacts: true,
      attachments: { orderBy: { createdAt: "desc" }, take: 50 },
      _count: { select: { grns: true } },
    },
  });
}

export async function getVendorLedger(vendorId: number, orgId: number, limit = 50) {
  return prisma.vendorLedgerEntry.findMany({
    where: { vendorId, orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function lookupVendors(orgId: number, q: string, limit = 20) {
  const search = (q || "").trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    orgId,
    status: VendorStatus.ACTIVE,
  };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }
  return prisma.vendor.findMany({
    where,
    take: limit,
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, phone: true },
  });
}

export async function countVendorReferences(vendorId: number): Promise<{ grns: number; listings: number; payoutAccounts: number }> {
  const [grns, listings, payoutAccounts] = await Promise.all([
    prisma.grn.count({ where: { vendorId } }),
    prisma.vendorProductListing.count({ where: { vendorId } }),
    prisma.payoutAccount.count({ where: { vendorId } }),
  ]);
  return { grns, listings, payoutAccounts };
}
