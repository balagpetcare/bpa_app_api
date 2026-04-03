import prisma from "../../../../infrastructure/db/prismaClient";

/**
 * Aggregate vendor metrics for admin dashboard (no per-SKU PII; org-scoped counts).
 */
export async function getVendorAnalyticsSummary() {
  const [vendorCount, grnCount, returnCount, listingCount] = await Promise.all([
    prisma.vendor.count(),
    prisma.grn.count({ where: { vendorId: { not: null } } }),
    prisma.vendorReturn.count(),
    prisma.vendorProductListing.count({ where: { status: "APPROVED" } }),
  ]);

  const topVendors = await prisma.vendor.findMany({
    select: {
      id: true,
      name: true,
      orgId: true,
      status: true,
      _count: { select: { grns: true, vendorReturns: true } },
    },
    orderBy: { id: "desc" },
    take: 25,
  });

  return {
    totals: { vendorCount, grnCount, returnCount, activeListings: listingCount },
    topVendors: topVendors.map((v) => ({
      id: v.id,
      name: v.name,
      orgId: v.orgId,
      status: v.status,
      grnCount: v._count.grns,
      returnCount: v._count.vendorReturns,
    })),
    explain: {
      method: "ADMIN_AGGREGATE",
      note: "Cross-org vendor listing; restrict via admin permission.",
    },
  };
}
