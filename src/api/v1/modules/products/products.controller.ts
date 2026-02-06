const service = require("./products.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Resolve orgId for user: OrgMember (ACTIVE) or Organization.ownerUserId (owner).
 */
async function getOrgIdForUser(userId) {
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  if (member?.orgId) return member.orgId;
  const owned = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  return owned?.id ?? null;
}

/**
 * GET /api/v1/products
 * List products with pagination and filters
 */
exports.getProducts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const orgId = (await getOrgIdForUser(userId)) || parseInt(req.query.orgId) || undefined;

    const result = await service.getProducts({
      orgId: orgId,
      branchId: req.query.branchId ? parseInt(req.query.branchId) : undefined,
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
    console.error("getProducts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get products",
    });
  }
};

/**
 * GET /api/v1/products/:id
 * Get single product
 */
exports.getProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const orgId = await getOrgIdForUser(userId);
    const product = await service.getProductById(productId, orgId);

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("getProduct error:", error);
    const status = error.message === "Product not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get product",
    });
  }
};

/**
 * POST /api/v1/products
 * Create new product
 */
exports.createProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { name, slug, status, categoryId, brandId, description, variants } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }

    const orgId = await getOrgIdForUser(userId);
    if (!orgId) {
      return res.status(403).json({
        success: false,
        message: "You must be a member or owner of an organization to create products",
      });
    }

    const product = await service.createProduct({
      orgId,
      name: name.trim(),
      slug: slug && String(slug).trim() ? String(slug).trim() : undefined,
      status: status || "ACTIVE",
      categoryId: categoryId != null ? parseInt(categoryId) : undefined,
      brandId: brandId != null ? parseInt(brandId) : undefined,
      description: description != null ? String(description).trim() || undefined : undefined,
      createdByUserId: userId,
      variants: variants,
    });

    return res.status(201).json({
      success: true,
      data: product,
      message: "Product created successfully",
    });
  } catch (error) {
    console.error("createProduct error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create product",
    });
  }
};

/**
 * PATCH /api/v1/products/:id
 * Update product
 */
exports.updateProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const { name, slug, status, categoryId, brandId, description } = req.body;

    const orgId = await getOrgIdForUser(userId);
    const product = await service.updateProduct(
      productId,
      {
        name: name != null ? String(name).trim() : undefined,
        slug: slug != null ? String(slug).trim() : undefined,
        status: status,
        categoryId: categoryId !== undefined ? (categoryId == null || categoryId === "" ? null : parseInt(categoryId)) : undefined,
        brandId: brandId !== undefined ? (brandId == null || brandId === "" ? null : parseInt(brandId)) : undefined,
        description: description !== undefined ? (description == null ? null : String(description).trim() || null) : undefined,
      },
      orgId
    );

    return res.status(200).json({
      success: true,
      data: product,
      message: "Product updated successfully",
    });
  } catch (error) {
    console.error("updateProduct error:", error);
    const status = error.message === "Product not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to update product",
    });
  }
};

/**
 * DELETE /api/v1/products/:id
 * Delete product (soft delete)
 */
exports.deleteProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const orgId = await getOrgIdForUser(userId);
    await service.deleteProduct(productId, orgId);

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("deleteProduct error:", error);
    const status = error.message === "Product not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to delete product",
    });
  }
};

/**
 * POST /api/v1/products/:id/variants
 * Add variant to product
 */
exports.addVariant = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const { sku, title, attributes } = req.body;

    if (!sku || !title) {
      return res.status(400).json({
        success: false,
        message: "SKU and title are required",
      });
    }

    const orgId = await getOrgIdForUser(userId);
    const variant = await service.addVariant(
      productId,
      {
        sku: sku.trim(),
        title: title.trim(),
        attributes: attributes,
      },
      orgId
    );

    return res.status(201).json({
      success: true,
      data: variant,
      message: "Variant added successfully",
    });
  } catch (error) {
    console.error("addVariant error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to add variant",
    });
  }
};

/**
 * PATCH /api/v1/products/variants/:id
 * Update variant
 */
exports.updateVariant = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const variantId = parseInt(req.params.id);
    if (!variantId) {
      return res.status(400).json({ success: false, message: "Invalid variant ID" });
    }

    const { sku, title, attributes, isActive } = req.body;

    const orgId = await getOrgIdForUser(userId);
    const variant = await service.updateVariant(
      variantId,
      {
        sku: sku?.trim(),
        title: title?.trim(),
        attributes: attributes,
        isActive: isActive,
      },
      orgId
    );

    return res.status(200).json({
      success: true,
      data: variant,
      message: "Variant updated successfully",
    });
  } catch (error) {
    console.error("updateVariant error:", error);
    const status = error.message === "Variant not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to update variant",
    });
  }
};

/**
 * DELETE /api/v1/products/variants/:id
 * Delete variant
 */
exports.deleteVariant = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const variantId = parseInt(req.params.id);
    if (!variantId) {
      return res.status(400).json({ success: false, message: "Invalid variant ID" });
    }

    const orgId = await getOrgIdForUser(userId);
    await service.deleteVariant(variantId, orgId);

    return res.status(200).json({
      success: true,
      message: "Variant deleted successfully",
    });
  } catch (error) {
    console.error("deleteVariant error:", error);
    const status = error.message === "Variant not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to delete variant",
    });
  }
};

/**
 * POST /api/v1/products/:id/media
 * Attach media to product
 */
exports.addMedia = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    const { mediaId, sortOrder } = req.body;

    if (!mediaId) {
      return res.status(400).json({
        success: false,
        message: "mediaId is required",
      });
    }

    const productMedia = await prisma.productMedia.create({
      data: {
        productId,
        mediaId: parseInt(mediaId),
        sortOrder: sortOrder || 0,
      },
      include: {
        media: {
          select: {
            id: true,
            url: true,
            type: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      data: productMedia,
      message: "Media attached successfully",
    });
  } catch (error) {
    console.error("addMedia error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to attach media",
    });
  }
};

/**
 * DELETE /api/v1/products/:id/media
 * Remove product media link. Body: { mediaId } or { productMediaId }.
 */
exports.deleteMedia = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    const { mediaId, productMediaId } = req.body;

    if (productMediaId) {
      const pm = await prisma.productMedia.findFirst({
        where: { id: parseInt(productMediaId), productId },
      });
      if (!pm) {
        return res.status(404).json({ success: false, message: "Product media not found" });
      }
      await prisma.productMedia.delete({ where: { id: pm.id } });
    } else if (mediaId) {
      const pm = await prisma.productMedia.findFirst({
        where: { productId, mediaId: parseInt(mediaId) },
      });
      if (!pm) {
        return res.status(404).json({ success: false, message: "Product media not found" });
      }
      await prisma.productMedia.delete({ where: { id: pm.id } });
    } else {
      return res.status(400).json({
        success: false,
        message: "mediaId or productMediaId is required",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Media removed successfully",
    });
  } catch (error) {
    console.error("deleteMedia error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to remove media",
    });
  }
};

/**
 * POST /api/v1/products/:id/submit-for-approval
 * Submit product for approval (DRAFT -> PENDING_APPROVAL)
 */
exports.submitForApproval = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: true,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (product.approvalStatus !== "DRAFT") {
      return res.status(400).json({
        success: false,
        message: `Product is already ${product.approvalStatus}. Only DRAFT products can be submitted.`,
      });
    }

    // Validation: at least one variant required
    if (!product.variants || product.variants.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Product must have at least one variant before submission",
      });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        approvalStatus: "PENDING_APPROVAL",
      },
      include: {
        category: true,
        brand: true,
        variants: true,
        media: {
          include: {
            media: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Product submitted for approval successfully",
    });
  } catch (error) {
    console.error("submitForApproval error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to submit product for approval",
    });
  }
};

/**
 * POST /api/v1/products/:id/approve
 * Approve product (PENDING_APPROVAL -> APPROVED) - Admin only
 */
exports.approveProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // TODO: Add admin check

    const productId = parseInt(req.params.id);

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (product.approvalStatus !== "PENDING_APPROVAL") {
      return res.status(400).json({
        success: false,
        message: `Product is ${product.approvalStatus}. Only PENDING_APPROVAL products can be approved.`,
      });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        approvalStatus: "APPROVED",
      },
      include: {
        category: true,
        brand: true,
        variants: true,
        media: {
          include: {
            media: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Product approved successfully",
    });
  } catch (error) {
    console.error("approveProduct error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to approve product",
    });
  }
};

/**
 * POST /api/v1/products/:id/reject
 * Reject product (PENDING_APPROVAL -> REJECTED) - Admin only
 */
exports.rejectProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    const reason = req.body?.reason ? String(req.body.reason).trim() : null;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (product.approvalStatus !== "PENDING_APPROVAL") {
      return res.status(400).json({
        success: false,
        message: `Product is ${product.approvalStatus}. Only PENDING_APPROVAL products can be rejected.`,
      });
    }

    const meta = reason ? { ...((product.metaJson as Record<string, unknown>) || {}), rejectionReason: reason } : undefined;
    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        approvalStatus: "REJECTED",
        ...(meta ? { metaJson: meta } : {}),
      },
      include: {
        category: true,
        brand: true,
        variants: true,
        media: { include: { media: true } },
      },
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Product rejected",
    });
  } catch (error) {
    console.error("rejectProduct error:", error);
    return res.status(400).json({
      success: false,
      message: error?.message || "Failed to reject product",
    });
  }
};

/**
 * POST /api/v1/products/:id/publish
 * Publish product (APPROVED -> PUBLISHED)
 */
exports.publishProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { org: { select: { ownerUserId: true } } },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Owner KYC gate: org owner must be VERIFIED to publish product
    if (product.org?.ownerUserId === userId) {
      const kyc = await prisma.ownerKyc.findUnique({ where: { userId: product.org.ownerUserId }, select: { verificationStatus: true, deletedAt: true } }).catch(() => null);
      if (kyc && !kyc.deletedAt && String(kyc.verificationStatus || "").toUpperCase() !== "VERIFIED") {
        return res.status(403).json({
          success: false,
          code: "KYC_VERIFIED_REQUIRED",
          message: "Owner KYC must be approved (verified) before publishing products. You can continue setting up while pending.",
        });
      }
    }

    if (product.approvalStatus !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: `Product is ${product.approvalStatus}. Only APPROVED products can be published.`,
      });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        approvalStatus: "PUBLISHED",
      },
      include: {
        category: true,
        brand: true,
        variants: true,
        media: {
          include: {
            media: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Product published successfully",
    });
  } catch (error) {
    console.error("publishProduct error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to publish product",
    });
  }
};

/**
 * GET /api/v1/products/:id/public
 * Public verify display (authenticity MVP)
 */
exports.getPublicProduct = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const data = await service.getPublicProduct(productId);
    if (!data) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getPublicProduct error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to get product" });
  }
};

/**
 * POST /api/v1/products/:id/versions
 * Create product version (authenticity MVP)
 */
exports.createProductVersion = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const productId = parseInt(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const { description, specJson } = req.body;
    const data = await service.createProductVersion({
      productId,
      orgUserId: userId,
      description,
      specJson,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    const status = error?.statusCode || 500;
    console.error("createProductVersion error:", error);
    return res.status(status).json({ success: false, message: error.message || "Failed to create version" });
  }
};

/**
 * POST /api/v1/products/versions/:id/approve
 * Approve product version (admin only)
 */
exports.approveProductVersion = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const versionId = parseInt(req.params.id);
    if (!versionId) {
      return res.status(400).json({ success: false, message: "Invalid version ID" });
    }

    const data = await service.approveProductVersion(versionId, userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    const status = error?.statusCode || 500;
    console.error("approveProductVersion error:", error);
    return res.status(status).json({ success: false, message: error.message || "Failed to approve version" });
  }
};

/**
 * GET /api/v1/products/versions
 * List product versions (filters: productId, status)
 */
exports.listProductVersions = async (req, res) => {
  try {
    const data = await service.listProductVersions({
      productId: req.query.productId,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    const status = error?.statusCode || 500;
    console.error("listProductVersions error:", error);
    return res.status(status).json({ success: false, message: error.message || "Failed to list versions" });
  }
};

export {};
