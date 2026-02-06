const service = require("./services.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * GET /api/v1/services
 * List services with pagination and filters
 */
exports.getServices = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Get user's organization/branch
    const [orgMember, branchMember] = await Promise.all([
      prisma.orgMember.findFirst({
        where: { userId: userId, status: "ACTIVE" },
        select: { orgId: true },
      }),
      prisma.branchMember.findFirst({
        where: { userId: userId, status: "ACTIVE" },
        select: { branchId: true },
      }),
    ]);

    const orgId = orgMember?.orgId || parseInt(req.query.orgId) || undefined;
    const branchId = branchMember?.branchId || parseInt(req.query.branchId) || undefined;

    const result = await service.getServices({
      orgId: orgId,
      branchId: branchId,
      category: req.query.category,
      status: req.query.status,
      search: req.query.search,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getServices error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get services",
    });
  }
};

/**
 * GET /api/v1/services/:id
 * Get single service
 */
exports.getService = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const serviceId = parseInt(req.params.id);
    if (!serviceId) {
      return res.status(400).json({ success: false, message: "Invalid service ID" });
    }

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

    const serviceData = await service.getServiceById(serviceId, branchId);

    return res.status(200).json({
      success: true,
      data: serviceData,
    });
  } catch (error) {
    console.error("getService error:", error);
    const status = error.message === "Service not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get service",
    });
  }
};

/**
 * POST /api/v1/services
 * Create new service
 */
exports.createService = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { orgId, branchId, name, description, category, price, duration, isRecurring, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Service name is required" });
    }

    if (!category) {
      return res.status(400).json({ success: false, message: "Service category is required" });
    }

    if (price === undefined || price < 0) {
      return res.status(400).json({ success: false, message: "Valid price is required" });
    }

    // Get user's organization/branch
    const [orgMember, branchMember] = await Promise.all([
      prisma.orgMember.findFirst({
        where: { userId: userId, status: "ACTIVE" },
        select: { orgId: true },
      }),
      prisma.branchMember.findFirst({
        where: { userId: userId, branchId: branchId, status: "ACTIVE" },
        select: { branchId: true },
      }),
    ]);

    const finalOrgId = orgId || orgMember?.orgId;
    const finalBranchId = branchId || branchMember?.branchId;

    if (!finalOrgId) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of an organization to create services",
      });
    }

    if (!finalBranchId) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of a branch to create services",
      });
    }

    const serviceData = await service.createService({
      orgId: finalOrgId,
      branchId: finalBranchId,
      name: name.trim(),
      description: description,
      category: category,
      price: parseFloat(price),
      duration: duration ? parseInt(duration) : undefined,
      isRecurring: isRecurring || false,
      status: status || "ACTIVE",
      createdByUserId: userId,
    });

    return res.status(201).json({
      success: true,
      data: serviceData,
      message: "Service created successfully",
    });
  } catch (error) {
    console.error("createService error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create service",
    });
  }
};

/**
 * PATCH /api/v1/services/:id
 * Update service
 */
exports.updateService = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const serviceId = parseInt(req.params.id);
    if (!serviceId) {
      return res.status(400).json({ success: false, message: "Invalid service ID" });
    }

    const { name, description, category, price, duration, isRecurring, status } = req.body;

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

    const serviceData = await service.updateService(
      serviceId,
      {
        name: name?.trim(),
        description: description,
        category: category,
        price: price !== undefined ? parseFloat(price) : undefined,
        duration: duration !== undefined ? parseInt(duration) : undefined,
        isRecurring: isRecurring,
        status: status,
      },
      branchId
    );

    return res.status(200).json({
      success: true,
      data: serviceData,
      message: "Service updated successfully",
    });
  } catch (error) {
    console.error("updateService error:", error);
    const status = error.message === "Service not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to update service",
    });
  }
};

/**
 * DELETE /api/v1/services/:id
 * Delete service (soft delete)
 */
exports.deleteService = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const serviceId = parseInt(req.params.id);
    if (!serviceId) {
      return res.status(400).json({ success: false, message: "Invalid service ID" });
    }

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

    await service.deleteService(serviceId, branchId);

    return res.status(200).json({
      success: true,
      message: "Service deleted successfully",
    });
  } catch (error) {
    console.error("deleteService error:", error);
    const status = error.message === "Service not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to delete service",
    });
  }
};

/**
 * GET /api/v1/services/category/:category
 * Get services by category
 */
exports.getServicesByCategory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const category = req.params.category;
    const branchId = parseInt(req.query.branchId);

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "branchId is required",
      });
    }

    const services = await service.getServicesByCategory(branchId, category);

    return res.status(200).json({
      success: true,
      data: services,
    });
  } catch (error) {
    console.error("getServicesByCategory error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get services",
    });
  }
};

export {};
