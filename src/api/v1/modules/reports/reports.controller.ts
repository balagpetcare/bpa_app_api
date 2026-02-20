const service = require("./reports.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * GET /api/v1/reports/sales
 * Get sales report
 */
exports.getSalesReport = async (req, res) => {
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

    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const groupBy = req.query.groupBy as "day" | "week" | "month" | undefined;

    const report = await service.getSalesReport({
      orgId: orgId,
      branchId: branchId,
      startDate: startDate,
      endDate: endDate,
      groupBy: groupBy,
    });

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error("getSalesReport error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get sales report",
    });
  }
};

/**
 * GET /api/v1/reports/top-products
 * Get top selling products
 */
exports.getTopSellingProducts = async (req, res) => {
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

    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const limit = parseInt(req.query.limit) || 10;

    const products = await service.getTopSellingProducts({
      orgId: orgId,
      branchId: branchId,
      startDate: startDate,
      endDate: endDate,
      limit: limit,
    });

    return res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("getTopSellingProducts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get top products",
    });
  }
};

/**
 * GET /api/v1/reports/zero-sales
 * Get zero sales products
 */
exports.getZeroSalesProducts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Get user's organization
    const orgMember = await prisma.orgMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { orgId: true },
    });

    const orgId = orgMember?.orgId || parseInt(req.query.orgId) || undefined;
    const branchId = parseInt(req.query.branchId) || undefined;
    const months = parseInt(req.query.months) || 3;

    const products = await service.getZeroSalesProducts({
      orgId: orgId,
      branchId: branchId,
      months: months,
    });

    return res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("getZeroSalesProducts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get zero sales products",
    });
  }
};

/**
 * GET /api/v1/reports/stock
 * Get stock report
 */
exports.getStockReport = async (req, res) => {
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
    const lowStockOnly = req.query.lowStockOnly === "true";

    const report = await service.getStockReport({
      orgId: orgId,
      branchId: branchId,
      lowStockOnly: lowStockOnly,
    });

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error("getStockReport error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get stock report",
    });
  }
};

/**
 * GET /api/v1/reports/revenue
 * Get revenue analytics
 */
exports.getRevenueAnalytics = async (req, res) => {
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

    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const analytics = await service.getRevenueAnalytics({
      orgId: orgId,
      branchId: branchId,
      startDate: startDate,
      endDate: endDate,
    });

    return res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error("getRevenueAnalytics error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get revenue analytics",
    });
  }
};

export {};
