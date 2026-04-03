import prisma from "../../../../infrastructure/db/prismaClient";
import * as repo from "./vendors.repo";
import type { CreateVendorInput, UpdateVendorInput, ListVendorsFilter } from "./vendors.types";
import { VendorStatus } from "@prisma/client";

const MAX_CODE_RETRIES = 3;

/**
 * Create vendor (org-scoped, enterprise fields).
 * Vendor code generation is concurrency-safe: retries on unique constraint (P2002) up to MAX_CODE_RETRIES.
 */
async function createVendor(data: CreateVendorInput) {
  const payload = {
    orgId: data.orgId,
    name: data.name.trim(),
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    addressLine1: data.addressLine1?.trim() || null,
    addressLine2: data.addressLine2?.trim() || null,
    district: data.district?.trim() || null,
    city: data.city?.trim() || null,
    country: data.country?.trim() || null,
    vendorType: data.vendorType || "OTHER",
    status: VendorStatus.ACTIVE,
    defaultPaymentTermsDays: data.defaultPaymentTermsDays ?? null,
    creditLimit: data.creditLimit != null ? data.creditLimit : null,
    openingBalance: data.openingBalance ?? 0,
    notes: data.notes?.trim() || null,
    contactJson: (data.contactJson ?? undefined) as any,
    defaultLeadTimeDays: data.defaultLeadTimeDays ?? undefined,
    minOrderValue: data.minOrderValue != null ? data.minOrderValue : undefined,
    currencyPreference: data.currencyPreference?.trim() || undefined,
    asnSupported: data.asnSupported ?? undefined,
    deliveryWindowsJson: (data.deliveryWindowsJson ?? undefined) as any,
    preferredWarehouseId: data.preferredWarehouseId ?? undefined,
  };

  let code = data.code?.trim() || null;
  for (let attempt = 1; attempt <= MAX_CODE_RETRIES; attempt++) {
    if (!code) code = await repo.getNextVendorCode(data.orgId);
    try {
      const vendor = await prisma.vendor.create({
        data: { ...payload, code },
        include: {
          org: { select: { id: true, name: true } },
        },
      });
      return vendor;
    } catch (e: any) {
      const isUniqueViolation = String(e?.code) === "P2002";
      if (isUniqueViolation && attempt < MAX_CODE_RETRIES) {
        code = null;
        continue;
      }
      throw e;
    }
  }
  throw new Error("Failed to create vendor after retries");
}

/**
 * List vendors with search and pagination (org-scoped).
 */
async function listVendors(filter: ListVendorsFilter) {
  return repo.listVendors({
    orgId: filter.orgId,
    search: filter.search,
    status: filter.status,
    page: filter.page,
    limit: filter.limit,
  });
}

/**
 * Get vendor by id (org-scoped).
 */
async function getVendorById(id: number, orgId: number) {
  const v = await repo.getVendorById(id, orgId);
  if (!v) return null;
  const { _count, ...rest } = v;
  return { ...rest, orderCount: _count.grns };
}

/**
 * Update vendor (org-scoped).
 */
async function updateVendor(id: number, orgId: number, data: UpdateVendorInput) {
  const existing = await prisma.vendor.findFirst({ where: { id, orgId } });
  if (!existing) return null;

  const payload: Record<string, unknown> = {};
  if (data.code !== undefined) payload.code = data.code?.trim() || null;
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.phone !== undefined) payload.phone = data.phone?.trim() || null;
  if (data.email !== undefined) payload.email = data.email?.trim() || null;
  if (data.addressLine1 !== undefined) payload.addressLine1 = data.addressLine1?.trim() || null;
  if (data.addressLine2 !== undefined) payload.addressLine2 = data.addressLine2?.trim() || null;
  if (data.district !== undefined) payload.district = data.district?.trim() || null;
  if (data.city !== undefined) payload.city = data.city?.trim() || null;
  if (data.country !== undefined) payload.country = data.country?.trim() || null;
  if (data.vendorType !== undefined) payload.vendorType = data.vendorType;
  if (data.defaultPaymentTermsDays !== undefined) payload.defaultPaymentTermsDays = data.defaultPaymentTermsDays;
  if (data.creditLimit !== undefined) payload.creditLimit = data.creditLimit;
  if (data.openingBalance !== undefined) payload.openingBalance = data.openingBalance;
  if (data.notes !== undefined) payload.notes = data.notes?.trim() || null;
  if (data.contactJson !== undefined) payload.contactJson = data.contactJson;
  if (data.defaultLeadTimeDays !== undefined) payload.defaultLeadTimeDays = data.defaultLeadTimeDays;
  if (data.minOrderValue !== undefined) payload.minOrderValue = data.minOrderValue;
  if (data.currencyPreference !== undefined) payload.currencyPreference = data.currencyPreference?.trim() || null;
  if (data.asnSupported !== undefined) payload.asnSupported = data.asnSupported;
  if (data.deliveryWindowsJson !== undefined) payload.deliveryWindowsJson = data.deliveryWindowsJson as any;
  if (data.preferredWarehouseId !== undefined) payload.preferredWarehouseId = data.preferredWarehouseId;

  await prisma.vendor.update({
    where: { id },
    data: payload as any,
  });
  return repo.getVendorById(id, orgId);
}

/**
 * Set vendor status (ACTIVE | INACTIVE | BLACKLISTED).
 */
async function setVendorStatus(id: number, orgId: number, status: VendorStatus) {
  const existing = await prisma.vendor.findFirst({ where: { id, orgId } });
  if (!existing) return null;
  return prisma.vendor.update({
    where: { id },
    data: { status },
    include: { org: { select: { id: true, name: true } } },
  });
}

/**
 * Delete vendor only if not referenced by GRN/listings/payouts; otherwise throw.
 */
async function deleteVendor(id: number, orgId: number) {
  const existing = await prisma.vendor.findFirst({ where: { id, orgId } });
  if (!existing) return null;
  const refs = await repo.countVendorReferences(id);
  if (refs.grns > 0 || refs.listings > 0 || refs.payoutAccounts > 0) {
    throw new Error(
      "Vendor cannot be deleted: referenced by GRNs, listings, or payout accounts. Deactivate instead."
    );
  }
  await prisma.vendor.delete({ where: { id } });
  return { deleted: true, id };
}

/**
 * Get vendor ledger entries (org-scoped).
 */
async function getVendorLedger(vendorId: number, orgId: number, limit?: number) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, orgId } });
  if (!vendor) return null;
  return repo.getVendorLedger(vendorId, orgId, limit);
}

/**
 * Add attachment metadata (fileKey from MinIO upload flow).
 */
async function addVendorAttachment(
  vendorId: number,
  orgId: number,
  data: { fileKey: string; type?: "TRADE_LICENSE" | "INVOICE" | "CHALLAN" | "OTHER"; note?: string }
) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, orgId } });
  if (!vendor) return null;
  return prisma.vendorAttachment.create({
    data: {
      vendorId,
      orgId,
      fileKey: data.fileKey,
      type: data.type || "OTHER",
      note: data.note?.trim() || null,
    },
  });
}

/**
 * Lookup vendors for dropdown (active only, org-scoped).
 */
async function lookupVendors(orgId: number, q: string, limit?: number) {
  return repo.lookupVendors(orgId, q, limit);
}

/**
 * Create vendor product listing (draft)
 */
async function createVendorListing(data: {
  vendorId: number;
  productId: number;
  variantId?: number;
  commissionRuleId?: number;
}) {
  const listing = await prisma.vendorProductListing.create({
    data: {
      vendorId: data.vendorId,
      productId: data.productId,
      variantId: data.variantId || null,
      status: "DRAFT",
      commissionRuleId: data.commissionRuleId || null,
    },
    include: {
      vendor: true,
      product: {
        select: {
          id: true,
          name: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
        },
      },
      commissionRule: {
        select: {
          id: true,
          name: true,
          type: true,
          value: true,
        },
      },
    },
  });

  return listing;
}

/**
 * Approve vendor listing
 */
async function approveVendorListing(listingId: number) {
  const listing = await prisma.vendorProductListing.update({
    where: { id: listingId },
    data: {
      status: "APPROVED",
    },
    include: {
      vendor: true,
      product: true,
      variant: true,
      commissionRule: true,
    },
  });

  return listing;
}

/**
 * Get vendor listings with filters
 */
async function getVendorListings(options: {
  vendorId?: number;
  productId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.vendorId) where.vendorId = options.vendorId;
  if (options.productId) where.productId = options.productId;
  if (options.status) where.status = options.status;

  const [listings, total] = await Promise.all([
    prisma.vendorProductListing.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: true,
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
          },
        },
        commissionRule: {
          select: {
            id: true,
            name: true,
            type: true,
            value: true,
          },
        },
      },
    }),
    prisma.vendorProductListing.count({ where }),
  ]);

  return {
    items: listings,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Create commission rule
 */
async function createCommissionRule(data: {
  name: string;
  type: string; // PERCENT or FIXED
  value: number;
  orgId?: number;
  isDefault?: boolean;
}) {
  const rule = await prisma.commissionRule.create({
    data: {
      name: data.name,
      type: data.type as any,
      value: data.value,
      orgId: data.orgId || null,
      isDefault: data.isDefault || false,
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return rule;
}

module.exports = {
  createVendor,
  listVendors,
  getVendorById,
  updateVendor,
  setVendorStatus,
  deleteVendor,
  getVendorLedger,
  addVendorAttachment,
  lookupVendors,
  createVendorListing,
  approveVendorListing,
  getVendorListings,
  createCommissionRule,
};
