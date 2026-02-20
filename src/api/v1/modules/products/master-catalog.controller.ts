const fs = require("fs");
const path = require("path");
const service = require("./master-catalog.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Resolve orgId for user: OrgMember (ACTIVE), Organization.ownerUserId (owner), or OwnerTeamMember (team member of owner's orgs).
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
  if (owned?.id) return owned.id;
  // Owner Team member: user is in a team whose owner owns org(s) -> use first such org
  const teamMember = await prisma.ownerTeamMember.findFirst({
    where: { userId },
    select: { team: { select: { ownerUserId: true } } },
  });
  if (teamMember?.team?.ownerUserId) {
    const org = await prisma.organization.findFirst({
      where: { ownerUserId: teamMember.team.ownerUserId },
      select: { id: true },
    });
    if (org?.id) return org.id;
  }
  return null;
}

/**
 * GET /api/v1/products/master-catalog
 * Browse/search master product catalog
 */
exports.getMasterCatalog = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await service.getMasterProducts({
      search: req.query.search,
      brandId: req.query.brandId ? parseInt(req.query.brandId) : undefined,
      categoryId: req.query.categoryId ? parseInt(req.query.categoryId) : undefined,
      isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : true,
      isVerified: req.query.isVerified !== undefined ? req.query.isVerified === "true" : undefined,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getMasterCatalog error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get master catalog",
    });
  }
};

/**
 * GET /api/v1/products/master-catalog/:id
 * Get single master product details
 */
exports.getMasterProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const masterId = parseInt(req.params.id);
    if (!masterId) {
      return res.status(400).json({ success: false, message: "Invalid master product ID" });
    }

    const product = await service.getMasterProductById(masterId);

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("getMasterProduct error:", error);
    const status = error.message === "Master product not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get master product",
    });
  }
};

/**
 * PATCH /api/v1/products/master-catalog/:id
 * Update a master product (admin/content edits)
 */
exports.updateMasterProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const masterId = parseInt(req.params.id);
    if (!masterId) {
      return res.status(400).json({ success: false, message: "Invalid master product ID" });
    }

    const updated = await service.updateMasterProduct(masterId, req.body || {});

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Master product updated successfully",
    });
  } catch (error) {
    console.error("updateMasterProduct error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update master product",
    });
  }
};

/**
 * GET /api/v1/products/master-catalog/csv-template
 * Download CSV template for master catalog import
 */
exports.getMasterCatalogCsvTemplate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const csv = service.generateMasterCatalogCsvTemplate();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="master_product_catalog_template.csv"',
    );
    return res.status(200).send(csv);
  } catch (error) {
    console.error("getMasterCatalogCsvTemplate error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate CSV template",
    });
  }
};

/**
 * GET /api/v1/products/master-catalog/bd-sample
 * Download Bangladesh pet products sample CSV (Mew Mew, Pet Zone, Daraz, etc.)
 */
exports.getBdPetSampleCsv = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const dataDir = path.join(__dirname, "../../../../../prisma/seeders/data");
    const filePath = path.join(dataDir, "bd_pet_products_master_catalog.csv");
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "BD pet products sample CSV not found. Run: npx ts-node scripts/generate-bd-pet-master-csv.ts",
      });
    }

    const csv = fs.readFileSync(filePath, "utf-8");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bd_pet_products_master_catalog.csv"',
    );
    return res.status(200).send(csv);
  } catch (error) {
    console.error("getBdPetSampleCsv error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to serve BD pet sample CSV",
    });
  }
};

/**
 * POST /api/v1/products/master-catalog/import-csv
 * Import master catalog from CSV file
 * Body: multipart/form-data with field "file", optional query ?dryRun=true
 */
exports.importMasterCatalogCsv = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const file = Array.isArray(req.files) ? req.files[0] : req.file;
    if (!file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "CSV file is required (field name: 'file')",
      });
    }

    const dryRun =
      String(req.query.dryRun || req.body?.dryRun || "")
        .toLowerCase()
        .trim() === "true";

    const summary = await service.importMasterCatalogFromCsv({
      buffer: file.buffer,
      dryRun,
      createdByUserId: userId,
    });

    return res.status(200).json({
      success: true,
      data: summary,
      message: dryRun
        ? "CSV validated successfully (dry run)"
        : "CSV imported successfully",
    });
  } catch (error) {
    console.error("importMasterCatalogCsv error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to import master catalog CSV",
    });
  }
};

/** Check if user has access to org: OrgMember (ACTIVE), owner, or OwnerTeamMember of owner. */
async function userHasAccessToOrg(userId, orgId) {
  const org = await prisma.organization.findFirst({
    where: { id: orgId },
    select: { ownerUserId: true },
  });
  if (!org) return false;
  if (org.ownerUserId === userId) return true;
  const member = await prisma.orgMember.findFirst({
    where: { userId, orgId, status: "ACTIVE" },
    select: { id: true },
  });
  if (member) return true;
  const teamMember = await prisma.ownerTeamMember.findFirst({
    where: { userId, team: { ownerUserId: org.ownerUserId } },
    select: { id: true },
  });
  return !!teamMember;
}

/**
 * POST /api/v1/products/master-catalog/:id/clone
 * Clone master product to organization.
 * Auth order: requireAuth → org context (header/body or getOrgIdForUser) → requireOrgMemberOrOwner → permission (route).
 */
exports.cloneMasterProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const masterId = parseInt(req.params.id);
    if (!masterId) {
      return res.status(400).json({ success: false, message: "Invalid master product ID" });
    }

    const orgIdFromHeader = req.headers["x-org-id"];
    const parsedHeaderOrgId =
      orgIdFromHeader != null && orgIdFromHeader !== ""
        ? parseInt(String(orgIdFromHeader), 10)
        : NaN;
    const { orgId: bodyOrgId, branchId, customVariants, customPrices, customName, customDescription } =
      req.body || {};
    const orgIdFromBody = bodyOrgId != null ? parseInt(String(bodyOrgId), 10) : NaN;

    const requestedOrgId = Number.isFinite(parsedHeaderOrgId)
      ? parsedHeaderOrgId
      : Number.isFinite(orgIdFromBody)
        ? orgIdFromBody
        : null;

    const userOrgId = await getOrgIdForUser(userId);
    const resolvedOrgId = requestedOrgId ?? userOrgId;

    if (!resolvedOrgId) {
      return res.status(400).json({
        success: false,
        message: "Organization context missing",
      });
    }

    const hasAccess = await userHasAccessToOrg(userId, resolvedOrgId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this organization",
      });
    }

    const targetOrgId = resolvedOrgId;

    const product = await service.cloneMasterProduct(masterId, targetOrgId, userId, {
      branchId: branchId ? parseInt(branchId) : undefined,
      customVariants: customVariants,
      customPrices: customPrices,
      customName: customName,
      customDescription: customDescription,
    });

    return res.status(201).json({
      success: true,
      data: product,
      message: "Product cloned successfully from master catalog",
    });
  } catch (error: any) {
    if (error?.alreadyAdded === true && error?.existingProduct) {
      return res.status(409).json({
        success: false,
        alreadyAdded: true,
        data: error.existingProduct,
        message: "Already added to catalog",
      });
    }
    console.error("cloneMasterProduct error:", error);
    return res.status(400).json({
      success: false,
      message: error?.message || "Failed to clone master product",
    });
  }
};

export {};
