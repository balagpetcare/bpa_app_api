/**
 * Catalog Enable Request: branch asks to enable product/variant for selling (no stock movement).
 * Approve → create/update LocationVariantConfig (+ optional LocationPrice).
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export type CreateCatalogRequestInput = {
  orgId: number;
  branchId: number;
  productId: number;
  variantId: number;
  locationId?: number;
  requestedPrice?: number;
  requestedByUserId: number;
};

export type ListCatalogRequestFilter = {
  orgId?: number;
  branchId?: number;
  status?: string;
  page?: number;
  limit?: number;
};

export async function createCatalogRequest(data: CreateCatalogRequestInput) {
  const branch = await prisma.branch.findFirst({
    where: { id: data.branchId, orgId: data.orgId },
  });
  if (!branch) throw new Error("Branch not found or does not belong to organization");
  const product = await prisma.product.findFirst({
    where: { id: data.productId, orgId: data.orgId },
  });
  if (!product) throw new Error("Product not found or does not belong to organization");
  const variant = await prisma.productVariant.findFirst({
    where: { id: data.variantId, productId: data.productId },
  });
  if (!variant) throw new Error("Variant not found or does not belong to product");

  const existing = await prisma.catalogEnableRequest.findFirst({
    where: {
      orgId: data.orgId,
      branchId: data.branchId,
      variantId: data.variantId,
      status: "PENDING",
    },
  });
  if (existing) throw new Error("A pending catalog enable request already exists for this variant at this branch");

  const request = await prisma.catalogEnableRequest.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      productId: data.productId,
      variantId: data.variantId,
      locationId: data.locationId ?? null,
      requestedPrice: data.requestedPrice != null ? data.requestedPrice : null,
      status: "PENDING",
      requestedByUserId: data.requestedByUserId,
    },
    include: {
      branch: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true } },
    },
  });
  return request;
}

export async function listCatalogRequests(filter: ListCatalogRequestFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = {};
  if (filter.orgId) where.orgId = filter.orgId;
  if (filter.branchId) where.branchId = filter.branchId;
  if (filter.status) where.status = filter.status;

  const [items, total] = await Promise.all([
    prisma.catalogEnableRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true, title: true } },
      },
    }),
    prisma.catalogEnableRequest.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getCatalogRequestById(id: number, orgId: number) {
  const request = await prisma.catalogEnableRequest.findFirst({
    where: { id, orgId },
    include: {
      branch: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true } },
      location: { select: { id: true, name: true } },
    },
  });
  return request;
}

export async function approveCatalogRequest(id: number, orgId: number, reviewedByUserId: number, price?: number) {
  const request = await prisma.catalogEnableRequest.findFirst({
    where: { id, orgId },
    include: { branch: true },
  });
  if (!request) throw new Error("Catalog enable request not found");
  if (request.status !== "PENDING") throw new Error("Only PENDING requests can be approved");

  const locationId = request.locationId ?? (await prisma.inventoryLocation.findFirst({
    where: { branchId: request.branchId, isActive: true },
    select: { id: true },
  }))?.id;
  if (!locationId) throw new Error("No active location found for branch");

  await prisma.$transaction(async (tx: any) => {
    await tx.locationVariantConfig.upsert({
      where: {
        locationId_variantId: { locationId, variantId: request.variantId },
      },
      create: {
        locationId,
        variantId: request.variantId,
        channel: "BOTH",
        isEnabled: true,
      },
      update: { isEnabled: true },
    });
    const finalPrice = price ?? request.requestedPrice;
    if (finalPrice != null && Number(finalPrice) > 0) {
      await tx.locationPrice.upsert({
        where: {
          locationId_variantId: { locationId, variantId: request.variantId },
        },
        create: {
          locationId,
          variantId: request.variantId,
          price: Number(finalPrice),
        },
        update: { price: Number(finalPrice) },
      });
    }
    await tx.catalogEnableRequest.update({
      where: { id },
      data: { status: "APPROVED", reviewedByUserId, reviewedAt: new Date() },
    });
  });

  return getCatalogRequestById(id, orgId);
}

export async function declineCatalogRequest(id: number, orgId: number, reviewedByUserId: number, reviewNote?: string) {
  const request = await prisma.catalogEnableRequest.findFirst({
    where: { id, orgId },
  });
  if (!request) throw new Error("Catalog enable request not found");
  if (request.status !== "PENDING") throw new Error("Only PENDING requests can be declined");

  await prisma.catalogEnableRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedByUserId,
      reviewedAt: new Date(),
      reviewNote: reviewNote ?? null,
    },
  });
  return getCatalogRequestById(id, orgId);
}
