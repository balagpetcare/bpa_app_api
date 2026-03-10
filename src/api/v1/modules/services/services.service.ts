const prisma = require("../../../../infrastructure/db/prismaClient");
const serviceCatalog = require("../clinic/serviceCatalog.service");

/**
 * Get services with pagination and filters
 */
async function getServices(options: {
  orgId?: number;
  branchId?: number;
  category?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (options.orgId) {
    where.orgId = options.orgId;
  }

  if (options.branchId) {
    where.branchId = options.branchId;
  }

  if (options.category) {
    where.category = options.category;
  }

  if (options.status) {
    where.status = options.status;
  }

  if (options.search) {
    where.OR = [
      { name: { contains: options.search, mode: "insensitive" } },
      { description: { contains: options.search, mode: "insensitive" } },
    ];
  }

  const [services, total] = await Promise.all([
    prisma.service.findMany({
      where,
      skip,
      take: limit,
      include: {
        org: {
          select: {
            id: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        pricingVariants: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.service.count({ where }),
  ]);

  return {
    items: services,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get single service by ID
 */
async function getServiceById(serviceId: number, branchId?: number) {
  const where: any = { id: serviceId };
  if (branchId) {
    where.branchId = branchId;
  }

  const service = await prisma.service.findFirst({
    where,
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      pricingVariants: true,
    },
  });

  if (!service) {
    throw new Error("Service not found");
  }

  return service;
}

/**
 * Create new service. Auto-generates serviceCode if not provided.
 */
async function createService(data: {
  orgId: number;
  branchId: number;
  name: string;
  description?: string;
  category: string;
  price: number;
  duration?: number;
  isRecurring?: boolean;
  status?: string;
  createdByUserId: number;
  department?: string;
  paymentGateRule?: string;
  serviceCode?: string | null;
  prerequisiteRule?: object | null;
  allowDiscount?: boolean;
  maxDiscountPct?: number | null;
  discountNeedsApproval?: boolean;
  taxRuleJson?: object | null;
  applicableSpecies?: string[] | null;
  isCustom?: boolean;
  proposedByUserId?: number | null;
  approvalStatus?: string | null;
}) {
  const serviceCode =
    data.serviceCode != null && data.serviceCode !== ""
      ? data.serviceCode
      : await serviceCatalog.generateServiceCode(data.branchId, data.category);

  const service = await prisma.service.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      category: data.category,
      price: data.price,
      duration: data.duration || null,
      isRecurring: data.isRecurring || false,
      status: data.status || "ACTIVE",
      createdByUserId: data.createdByUserId,
      department: data.department || "DOCTOR_DESK",
      paymentGateRule: data.paymentGateRule || "PAY_BEFORE_SERVICE",
      serviceCode,
      prerequisiteRule: data.prerequisiteRule ?? undefined,
      allowDiscount: data.allowDiscount !== false,
      maxDiscountPct: data.maxDiscountPct ?? undefined,
      discountNeedsApproval: data.discountNeedsApproval || false,
      taxRuleJson: data.taxRuleJson ?? undefined,
      applicableSpecies: data.applicableSpecies ?? undefined,
      isCustom: data.isCustom || false,
      proposedByUserId: data.proposedByUserId ?? undefined,
      approvalStatus: data.approvalStatus ?? undefined,
    },
    include: {
      org: true,
      branch: true,
    },
  });

  return service;
}

/**
 * Update service
 */
async function updateService(
  serviceId: number,
  data: {
    name?: string;
    description?: string;
    category?: string;
    price?: number;
    duration?: number;
    isRecurring?: boolean;
    status?: string;
    department?: string;
    paymentGateRule?: string;
    serviceCode?: string | null;
    prerequisiteRule?: object | null;
    allowDiscount?: boolean;
    maxDiscountPct?: number | null;
    discountNeedsApproval?: boolean;
    taxRuleJson?: object | null;
    applicableSpecies?: string[] | null;
    approvalStatus?: string | null;
  },
  branchId?: number
) {
  const where: any = { id: serviceId };
  if (branchId) {
    where.branchId = branchId;
  }

  const existing = await prisma.service.findFirst({ where });
  if (!existing) {
    throw new Error("Service not found");
  }

  const updateData: any = {};

  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.price !== undefined) updateData.price = data.price;
  if (data.duration !== undefined) updateData.duration = data.duration || null;
  if (data.isRecurring !== undefined) updateData.isRecurring = data.isRecurring;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.department !== undefined) updateData.department = data.department;
  if (data.paymentGateRule !== undefined) updateData.paymentGateRule = data.paymentGateRule;
  if (data.serviceCode !== undefined) updateData.serviceCode = data.serviceCode || null;
  if (data.prerequisiteRule !== undefined) updateData.prerequisiteRule = data.prerequisiteRule;
  if (data.allowDiscount !== undefined) updateData.allowDiscount = data.allowDiscount;
  if (data.maxDiscountPct !== undefined) updateData.maxDiscountPct = data.maxDiscountPct;
  if (data.discountNeedsApproval !== undefined) updateData.discountNeedsApproval = data.discountNeedsApproval;
  if (data.taxRuleJson !== undefined) updateData.taxRuleJson = data.taxRuleJson;
  if (data.applicableSpecies !== undefined) updateData.applicableSpecies = data.applicableSpecies;
  if (data.approvalStatus !== undefined) updateData.approvalStatus = data.approvalStatus;

  const service = await prisma.service.update({
    where: { id: serviceId },
    data: updateData,
    include: {
      org: true,
      branch: true,
    },
  });

  return service;
}

/**
 * Delete service (soft delete by setting status to INACTIVE)
 */
async function deleteService(serviceId: number, branchId?: number) {
  const where: any = { id: serviceId };
  if (branchId) {
    where.branchId = branchId;
  }

  const existing = await prisma.service.findFirst({ where });
  if (!existing) {
    throw new Error("Service not found");
  }

  // Soft delete: set status to INACTIVE
  const service = await prisma.service.update({
    where: { id: serviceId },
    data: { status: "INACTIVE" },
  });

  return service;
}

/**
 * Get services by category
 */
async function getServicesByCategory(branchId: number, category?: string) {
  const where: any = {
    branchId: branchId,
    status: "ACTIVE",
  };

  if (category) {
    where.category = category;
  }

  const services = await prisma.service.findMany({
    where,
    include: {
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return services;
}

module.exports = {
  getServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
  getServicesByCategory,
};

export {};
