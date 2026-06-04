const service = require("./producer.service");
const inviteService = require("./producerStaffInvite.service");
const approvalService = require("./producerApproval.service");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");
const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeProducerAudit } = require("./producerAudit");
const { resolvePermissionsForUser } = require("../../utils/permissions");
const { performUnifiedLogin } = require("../../services/authUnified.service");

exports.register = async (req, res) => {
  try {
    const data = await service.registerProducer(req.body);
    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.cookie("access_token", data.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });
    return res.status(201).json({ success: true, data: { user: data.user } });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Registration failed" });
  }
};

/**
 * Producer login – uses shared authUnified.service with producerOnly gate.
 * Returns canonical contexts + default_redirect.
 */
exports.login = async (req, res) => {
  try {
    let result;
    try {
      result = await performUnifiedLogin({
        email: req.body?.email || null,
        phone: req.body?.phone || null,
        password: req.body?.password || "",
        options: { producerOnly: true },
      });
    } catch (authErr) {
      const status = authErr.statusCode || 401;
      return res.status(status).json({ success: false, message: authErr?.message || "Login failed" });
    }

    const { user, contexts, default_redirect } = result;
    const ownerOrg = await prisma.producerOrg.findFirst({
      where: { ownerUserId: user.id },
      select: { id: true },
    });
    if (!ownerOrg) {
      const activeMembership = await prisma.producerOrgStaff.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (!activeMembership) {
        return res.status(403).json({ success: false, message: "Producer staff access is not active" });
      }
    }
    const perms = await resolvePermissionsForUser(user.id);
    const token = jwt.sign({ id: user.id, perms, tv: user.tokenVersion || 0 }, appConfig.jwt.secret, { expiresIn: "7d" });

    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.cookie("access_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.auth?.email ?? null,
          phone: user.auth?.phone ?? null,
          displayName: user.profile?.displayName || null,
          username: user.profile?.username || null,
        },
      },
      contexts,
      default_redirect,
    });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Login failed" });
  }
};

exports.me = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getMe(userId, req.producerOrgId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to load" });
  }
};

/** Trust & Safety: active enforcement holds for current org (and optional productId/batchId). */
exports.getEnforcementHolds = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    if (!producerOrgId) return res.status(200).json({ success: true, data: { orgHold: null, productHold: null, batchHold: null } });
    const prisma = require("../../../../infrastructure/db/prismaClient");
    const productId = req.query?.productId != null ? Number(req.query.productId) : undefined;
    const batchId = req.query?.batchId != null ? Number(req.query.batchId) : undefined;
    const data = await service.getEnforcementHolds(prisma, producerOrgId, { productId, batchId });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to load holds" });
  }
};

/** Legacy KYC submit (docsJson only). @deprecated Use VerificationCase flow: POST /kyc/documents + POST /kyc/submit */
exports.submitKyc = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.submitKyc({
      userId,
      name: req.body.name,
      countryCode: req.body.countryCode,
      docsJson: req.body.docsJson,
      divisionId: req.body.divisionId,
      districtId: req.body.districtId,
      upazilaId: req.body.upazilaId,
      unionId: req.body.unionId,
      areaId: req.body.areaId ?? req.body.bdAreaId,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "KYC submit failed" });
  }
};

/** POST /kyc/submit: legacy (body with docsJson) → legacy submit + deprecation; else → new VerificationCase submit */
exports.submitKycLegacyOrNew = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const hasLegacyBody = req.body?.docsJson !== undefined || req.body?.name !== undefined || req.body?.countryCode !== undefined;
    if (hasLegacyBody) {
      const data = await service.submitKyc({
        userId,
        name: req.body.name,
        countryCode: req.body.countryCode,
        docsJson: req.body.docsJson,
        divisionId: req.body.divisionId,
        districtId: req.body.districtId,
        upazilaId: req.body.upazilaId,
        unionId: req.body.unionId,
        areaId: req.body.areaId ?? req.body.bdAreaId,
      });
      return res.status(200).json({
        success: true,
        data,
        deprecated: true,
        message: "docsJson-based KYC is deprecated. Please use /kyc/documents to upload files and submit for verification.",
      });
    }
    const kycService = require("./producerKyc.service");
    const { verificationCase } = await kycService.submitProducerKyc(userId);
    return res.json({ success: true, data: verificationCase, message: "KYC submitted for review" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "KYC submit failed" });
  }
};

exports.kycStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getKycStatus(userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to load status" });
  }
};

exports.listProducts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listProducts(req.producerOrgId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list products" });
  }
};

/** GET /products/pick — search + pagination for product picker (batch creation). Query: q, page, limit, onlyApproved, onlyActive. */
exports.listProductsPick = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const q = req.query.q != null ? String(req.query.q) : "";
    const page = req.query.page != null ? Math.max(1, parseInt(String(req.query.page), 10) || 1) : 1;
    const limit = req.query.limit != null ? Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20)) : 20;
    const onlyApproved = req.query.onlyApproved !== "false";
    const onlyActive = req.query.onlyActive === "true";
    const data = await service.listProductsPick(req.producerOrgId, { q, page, limit, onlyApproved, onlyActive });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list products" });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const producerOrgId =
      req.producerOrgId ??
      (req.body?.producerOrgId != null ? Number(req.body.producerOrgId) : null) ??
      (req.user?.defaultProducerOrgId != null ? Number(req.user.defaultProducerOrgId) : null);
    if (!producerOrgId) {
      return res.status(400).json({
        success: false,
        message: "Producer organization is required",
        code: "PRODUCER_ORG_REQUIRED",
      });
    }
    const data = await service.createProduct(userId, producerOrgId, req.body);
    req.producerOrgId = producerOrgId;
    void writeProducerAudit({
      producerOrgId: req.producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: userId,
      action: "PRODUCT_CREATED",
      entityType: "AUTH_PRODUCT",
      entityId: String(data.id),
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create product" });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getProduct(req.producerOrgId, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Product not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to get product" });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.updateProduct(userId, req.producerOrgId, req.params.id, req.body);
    void writeProducerAudit({
      producerOrgId: req.producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: userId,
      action: "PRODUCT_UPDATED",
      entityType: "AUTH_PRODUCT",
      entityId: String(data.id),
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to update product" });
  }
};

exports.submitProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const producerOrgId = req.producerOrgId;
    const productId = req.params.id;

    if (req.isProducerOwner) {
      const { product, approval, previousStatus } = await approvalService.autoApproveProductAsOwner(producerOrgId, productId, userId);
      const entityIdEnrich = `${product.id}|oldStatus:${previousStatus || "DRAFT"}|newStatus:UNDER_REVIEW`;
      void writeProducerAudit({
        producerOrgId,
        actorType: "OWNER",
        actorId: userId,
        action: "PRODUCT_AUTO_APPROVED",
        entityType: "AUTH_PRODUCT",
        entityId: entityIdEnrich,
      });
      return res.status(200).json({
        success: true,
        data: { product, approval, autoApproved: true },
        message: "Approved (owner). Sent for platform review.",
      });
    }

    const data = await service.submitProduct(userId, producerOrgId, productId);
    const approval = await approvalService.submitProductForApproval(producerOrgId, data.id, userId);
    void writeProducerAudit({
      producerOrgId,
      actorType: "STAFF",
      actorId: userId,
      action: "PRODUCT_SUBMITTED",
      entityType: "AUTH_PRODUCT",
      entityId: String(data.id),
    });
    return res.status(200).json({ success: true, data: { product: data, approval }, message: "Product submitted for approval" });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    const payload: { success: false; message: string; code?: string } = { success: false, message: e?.message || "Submit failed" };
    if (e?.code) payload.code = e.code;
    return res.status(status).json(payload);
  }
};

exports.resubmitProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const producerOrgId = req.producerOrgId;
    const productId = req.params.id;
    const result = await service.resubmitProduct(userId, producerOrgId, productId);
    void writeProducerAudit({
      producerOrgId,
      actorType: "STAFF",
      actorId: userId,
      action: "PRODUCT_RESUBMITTED",
      entityType: "AUTH_PRODUCT",
      entityId: String(result.product.id),
    });
    return res.status(200).json({
      success: true,
      data: { product: result.product, approval: result.approval, revision: result.revision },
      message: "Product resubmitted for approval",
    });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    const payload: { success: false; message: string; code?: string } = { success: false, message: e?.message || "Resubmit failed" };
    if (e?.code) payload.code = e.code;
    return res.status(status).json(payload);
  }
};

exports.getProductStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getProductStatus(req.producerOrgId, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Product not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to get status" });
  }
};

exports.listFactories = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listFactories(req.producerOrgId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list factories" });
  }
};

exports.createFactory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.createFactory(req.producerOrgId, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create factory" });
  }
};

exports.addProductProof = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const productId = req.params.id;
    const file = req.file;
    const proofType = req.body?.proofType || req.body?.proof_type;
    if (!file?.buffer) return res.status(400).json({ success: false, message: "File is required" });
    if (!proofType) return res.status(400).json({ success: false, message: "proofType is required" });
    const mediaService = require("../media/media.service");
    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId: userId,
      file,
      folder: "producer-product-proofs",
      type: file.mimetype?.startsWith("image/") ? "IMAGE" : file.mimetype === "application/pdf" ? "FILE" : "FILE",
    });
    let metadataJson;
    if (req.body?.metadataJson != null && req.body.metadataJson !== "") {
      try {
        metadataJson = typeof req.body.metadataJson === "string" ? JSON.parse(req.body.metadataJson) : req.body.metadataJson;
      } catch {
        metadataJson = undefined;
      }
    }
    const data = await service.addProductProof(req.producerOrgId, userId, productId, {
      proofType,
      mediaId: media.id,
      metadataJson,
    });
    void writeProducerAudit({
      producerOrgId: req.producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: userId,
      action: "PRODUCT_PROOF_ADDED",
      entityType: "AUTH_PRODUCT",
      entityId: String(productId),
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to add proof" });
  }
};

exports.createBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.createBatch(userId, req.producerOrgId, req.params.id, req.body);
    void writeProducerAudit({
      producerOrgId: req.producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: userId,
      action: "BATCH_CREATED",
      entityType: "AUTH_BATCH",
      entityId: String(data.id),
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create batch" });
  }
};

exports.submitBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const producerOrgId = req.producerOrgId;
    const batchId = req.params.id;

    if (req.isProducerOwner) {
      const { approval } = await approvalService.autoApproveBatchAsOwner(producerOrgId, batchId, userId);
      void writeProducerAudit({
        producerOrgId,
        actorType: "OWNER",
        actorId: userId,
        action: "BATCH_AUTO_APPROVED",
        entityType: "AUTH_BATCH",
        entityId: String(batchId),
      });
      return res.status(200).json({
        success: true,
        data: { approval, autoApproved: true },
        message: "Approved (owner).",
      });
    }

    const approval = await approvalService.submitBatchForApproval(producerOrgId, batchId, userId);
    void writeProducerAudit({
      producerOrgId,
      actorType: "STAFF",
      actorId: userId,
      action: "BATCH_SUBMITTED",
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
    });
    return res.status(200).json({ success: true, data: { approval }, message: "Batch submitted for approval" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to submit batch" });
  }
};

exports.listBatches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listBatches(req.producerOrgId, req.query);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list batches" });
  }
};

exports.listPrintEmailRecipients = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listPrintEmailRecipients(req.producerOrgId);
    return res.status(200).json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to list email recipients",
      code: e?.code,
    });
  }
};

exports.createPrintEmailRecipient = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.createPrintEmailRecipient(req.producerOrgId, userId, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to create email recipient",
      code: e?.code,
    });
  }
};

exports.listPrintBatches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.listPrintBatches(req.producerOrgId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list print batches" });
  }
};

exports.getPrintBatchDetail = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getPrintBatchDetail(req.producerOrgId, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Batch not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to get print batch detail" });
  }
};

exports.allocatePrintBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await service.allocatePrintBatch(req.producerOrgId, req.params.id, userId, req.body);
    if (result.download) {
      res.setHeader("Content-Type", result.download.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.download.filename}"`);
      return res.send(result.download.buffer);
    }
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    const status = e?.statusCode || 500;
    const body: { success: false; message: string; code?: string } = {
      success: false,
      message: e?.message || "Allocation failed",
    };
    if (e?.code) body.code = e.code;
    return res.status(status).json(body);
  }
};

exports.revokePrintAllocation = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.revokePrintAllocation(
      req.producerOrgId,
      req.params.batchId,
      req.params.allocationId,
      userId,
      req.body
    );
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    const body: { success: boolean; message: any; code?: string } = { success: false, message: e?.message || "Revoke failed" };
    if (e?.code) body.code = e.code;
    return res.status(status).json(body);
  }
};

exports.downloadPrintIssuance = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const actorType = req.isProducerOwner ? "OWNER" : "STAFF";
    const result = await service.downloadIssuanceSerials(
      req.producerOrgId,
      req.params.issuanceId,
      userId,
      actorType
    );
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Download failed",
      code: e?.code,
    });
  }
};

exports.getBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.getBatchWithCodes(req.producerOrgId, req.params.id, {
      page: req.query?.codesPage,
      limit: req.query?.codesLimit,
    });
    if (!data) return res.status(404).json({ success: false, message: "Batch not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to get batch" });
  }
};

exports.markBatchPrinted = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const batchId = req.params.id;
    const actorType = req.isProducerOwner ? "OWNER" : "STAFF";
    const data = await service.recordBatchPrint(req.producerOrgId, batchId, userId, actorType);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    const body: { success: boolean; message: any; code?: string } = { success: false, message: e?.message || "Failed to mark batch as printed" };
    if (e?.code) body.code = e.code;
    return res.status(status).json(body);
  }
};

exports.generateCodes = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.generateCodes(userId, req.producerOrgId, req.params.batchId, req.body.quantity, {
      length: req.body.length,
      prefix: req.body.prefix,
      suffix: req.body.suffix,
    });
    void writeProducerAudit({
      producerOrgId: req.producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: userId,
      action: "CODES_GENERATED",
      entityType: "AUTH_BATCH",
      entityId: String(req.params.batchId),
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to generate codes" });
  }
};

exports.exportCodes = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.exportCodes(req.producerOrgId, req.params.batchId);
    void writeProducerAudit({
      producerOrgId: req.producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: userId,
      action: "CODES_EXPORTED",
      entityType: "AUTH_BATCH",
      entityId: String(req.params.batchId),
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to export codes" });
  }
};

exports.exportSummaryCsv = async (req, res) => {
  try {
    const filters = service.parseSummaryExportFilters(req.query || {});
    const { csv, filename } = await service.getBatchesSummaryForCsv(req.producerOrgId, filters);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (e) {
    const status = e?.statusCode || 500;
    const code = e?.code || null;
    const body: { success: boolean; message: any; code?: string } = { success: false, message: e?.message || "Failed to export summary CSV" };
    if (code) body.code = code;
    return res.status(status).json(body);
  }
};

exports.exportBatchCodesCsv = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    await service.streamBatchCodesCsvToResponse(req.producerOrgId, req.params.batchId, res);
    void writeProducerAudit({
      producerOrgId: req.producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: userId,
      action: "CODES_EXPORTED",
      entityType: "AUTH_BATCH",
      entityId: String(req.params.batchId),
    });
  } catch (e) {
    if (!res.headersSent) {
      const status = e?.statusCode || 500;
      return res.status(status).json({ success: false, message: e?.message || "Failed to export codes CSV" });
    }
  }
};

exports.exportBatchEventsCsv = async (req, res) => {
  try {
    const { csv, filename } = await service.getBatchEventsForCsv(req.producerOrgId, req.params.batchId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to export timeline CSV" });
  }
};

exports.verify = async (req, res) => {
  try {
    const data = await service.verifyCode({
      publicCode: req.body.code,
      ip: req.ip,
      country: req.countryContext?.countryCode,
      deviceId: req.body.deviceId,
      userId: req.user?.id,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Verify failed" });
  }
};

exports.searchCode = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await service.searchCode(req.producerOrgId, req.query?.code);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Search failed" });
  }
};

// Staff Management
exports.inviteStaff = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const invitedBy = req.user?.id;
    const data = await service.inviteStaff({ producerOrgId, invitedBy, ...req.body });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to invite staff" });
  }
};

exports.listStaff = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const includeRemoved = req.query?.includeRemoved === "true" || req.query?.includeRemoved === true;
    const data = await service.listStaff(producerOrgId, { includeRemoved });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to list staff" });
  }
};

exports.updateStaffRole = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const staffId = Number(req.params.staffId);
    const roleKey = req.body?.roleKey;
    const prev = await service.getStaffMember(producerOrgId, staffId);
    const data = await service.updateStaffRole(producerOrgId, staffId, roleKey);
    const entityId = prev ? `${staffId}|oldRole:${prev.role?.key ?? ""}|newRole:${roleKey ?? ""}` : String(staffId);
    void writeProducerAudit({
      producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: req.user?.id,
      action: "STAFF_ROLE_UPDATED",
      entityType: "PRODUCER_ORG_STAFF",
      entityId,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to update staff role" });
  }
};

exports.updateStaffStatus = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const staffId = Number(req.params.staffId);
    const status = req.body?.status;
    const prev = await service.getStaffMember(producerOrgId, staffId);
    const data = await service.updateStaffStatus(producerOrgId, staffId, status);
    const entityId = prev ? `${staffId}|oldStatus:${prev.status ?? ""}|newStatus:${status ?? ""}` : String(staffId);
    void writeProducerAudit({
      producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: req.user?.id,
      action: "STAFF_STATUS_UPDATED",
      entityType: "PRODUCER_ORG_STAFF",
      entityId,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to update staff status" });
  }
};

exports.removeStaff = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const { staffId } = req.params;
    const auditContext = { actorId: req.user?.id, isProducerOwner: req.isProducerOwner };
    await service.removeStaff(producerOrgId, Number(staffId), auditContext);
    void writeProducerAudit({
      producerOrgId,
      actorType: req.isProducerOwner ? "OWNER" : "STAFF",
      actorId: req.user?.id,
      action: "STAFF_REMOVED",
      entityType: "PRODUCER_ORG_STAFF",
      entityId: String(staffId),
    });
    return res.status(200).json({ success: true, message: "Staff removed successfully" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to remove staff" });
  }
};

// ==================== STAFF INVITES (new workflow: registered + unregistered) ====================

exports.createStaffInvite = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const invitedByUserId = req.user?.id;
    if (!invitedByUserId) {
      return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const body = req.body || {};
    const email = body.email != null ? String(body.email).trim() : "";
    const phone = body.phone != null ? String(body.phone).trim() : "";
    const roleKey = body.roleKey != null ? body.roleKey : body.role;
    const message = body.message != null ? String(body.message).trim() : null;
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "At least one of email or phone is required",
        fields: { email: "Provide an email address", phone: "Or provide a phone number" },
      });
    }
    const data = await inviteService.createStaffInvite({
      producerOrgId,
      invitedByUserId,
      email: email || undefined,
      phone: phone || undefined,
      roleKey: roleKey != null ? String(roleKey) : undefined,
      message: message || undefined,
    });
    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    let status = e?.statusCode || 500;
    const payload: { success: false; message: string; code?: string; fields?: Record<string, string> } = {
      success: false,
      message: e?.message || "Failed to create invite",
    };
    if (e?.code) payload.code = e.code;
    if (e?.fields) payload.fields = e.fields;
    if (e?.code === "P2002") {
      status = 409;
      payload.code = "INVITE_ALREADY_PENDING";
      payload.message = "An invitation for this email or phone is already pending.";
    }
    return res.status(status).json(payload);
  }
};

exports.listStaffInvites = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const data = await inviteService.listStaffInvites(producerOrgId, { status, search });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list invites" });
  }
};

exports.cancelStaffInvite = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const inviteId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    await inviteService.cancelStaffInvite(producerOrgId, inviteId, userId);
    return res.status(200).json({ success: true, message: "Invite cancelled" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to cancel invite" });
  }
};

exports.resendStaffInvite = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const inviteId = Number(req.params.id);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await inviteService.resendStaffInvite(producerOrgId, inviteId, userId);
    return res.status(200).json({ success: true, data: { inviteLink: data.inviteLink, invite: data.invite }, message: "Invite resent" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to resend invite" });
  }
};

exports.acceptStaffInvite = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { inviteId, token } = req.body || {};
    const data = await inviteService.acceptStaffInvite({ userId, inviteId, token });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to accept invite" });
  }
};

exports.acceptStaffInvitePublic = async (req, res) => {
  try {
    const { token, password, name } = req.body || {};
    const data = await inviteService.acceptStaffInvitePublic({
      token,
      password,
      name: name != null ? String(name) : null,
    });

    const perms = await resolvePermissionsForUser(data.user.id);
    const jwtToken = jwt.sign(
      { id: data.user.id, perms, tv: data.user.tokenVersion || 0 },
      appConfig.jwt.secret,
      { expiresIn: "7d" }
    );

    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.cookie("access_token", jwtToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });

    return res.status(200).json({
      success: true,
      data: {
        token: jwtToken,
        producerOrgId: data.producerOrgId,
        producerName: data.producerName,
        user: {
          id: data.user.id,
          email: data.user.auth?.email ?? null,
          phone: data.user.auth?.phone ?? null,
          displayName: data.user.profile?.displayName || null,
          username: data.user.profile?.username || null,
        },
        default_redirect: "/producer/dashboard",
      },
    });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to accept invite" });
  }
};

exports.declineStaffInvite = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { inviteId, token } = req.body || {};
    await inviteService.declineStaffInvite({ userId, inviteId, token });
    return res.status(200).json({ success: true, message: "Invite declined" });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to decline invite" });
  }
};

exports.getStaffInvitePreview = async (req, res) => {
  try {
    const token = (req.query.token as string) || "";
    const data = await inviteService.getStaffInvitePreviewByToken(token);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Invalid or expired invite" });
  }
};

exports.getPendingInvites = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await inviteService.getPendingInvitesForUser(userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to get pending invites" });
  }
};

exports.listAuditLogs = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const actorId = req.query?.actorId ? Number(req.query.actorId) : null;
    const action = req.query?.action ? String(req.query.action) : null;
    const from = req.query?.from ? new Date(String(req.query.from)) : null;
    const to = req.query?.to ? new Date(String(req.query.to)) : null;
    const take = Math.min(Number(req.query?.limit) || 50, 200);
    const skip = (Number(req.query?.page || 1) - 1) * take;

    const where = {
      producerOrgId,
      ...(actorId ? { actorId } : {}),
      ...(action ? { action } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const logs = await prisma.producerAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });

    const actorIds = Array.from(new Set(logs.map((l) => l.actorId).filter(Boolean)));
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            profile: { select: { displayName: true } },
            auth: { select: { email: true, phone: true } },
          },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    const data = logs.map((l) => {
      const actor = actorById.get(l.actorId);
      const a = actor != null ? (actor as { id?: number; profile?: { displayName?: string }; auth?: { email?: string; phone?: string } }) : null;
      return {
        id: l.id,
        actorType: l.actorType,
        actorId: l.actorId,
        actor: a
          ? {
              id: a.id,
              displayName: a.profile?.displayName || null,
              email: a.auth?.email || null,
              phone: a.auth?.phone || null,
            }
          : null,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        createdAt: l.createdAt,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list audit logs" });
  }
};

exports.listApprovals = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const items = await approvalService.listApprovals(producerOrgId, req.query || {});

    const productIds = items.filter((a) => a.entityType === "PRODUCT").map((a) => a.entityId);
    const batchIds = items.filter((a) => a.entityType === "BATCH").map((a) => a.entityId);

    const [products, batches] = await Promise.all([
      productIds.length
        ? prisma.authProduct.findMany({
            where: { id: { in: productIds }, producerOrgId },
            select: { id: true, productName: true, sku: true, status: true },
          })
        : [],
      batchIds.length
        ? prisma.authBatch.findMany({
            where: { id: { in: batchIds }, authProduct: { producerOrgId } },
            select: { id: true, batchNo: true, status: true, authProductId: true },
          })
        : [],
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const batchById = new Map(batches.map((b) => [b.id, b]));

    const data = items.map((a) => {
      const entity =
        a.entityType === "PRODUCT"
          ? productById.get(a.entityId) || null
          : a.entityType === "BATCH"
            ? batchById.get(a.entityId) || null
            : null;
      return { ...a, entity };
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to list approvals" });
  }
};

exports.approveApproval = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const reviewedByUserId = req.user?.id;
    if (!reviewedByUserId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const note = req.body?.note || null;

    const data = await approvalService.approveApproval(producerOrgId, req.params.id, reviewedByUserId, note);
    void writeProducerAudit({
      producerOrgId,
      actorType: "OWNER",
      actorId: reviewedByUserId,
      action: "APPROVAL_APPROVED",
      entityType: "PRODUCER_APPROVAL",
      entityId: String(data.id),
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to approve" });
  }
};

exports.rejectApproval = async (req, res) => {
  try {
    const producerOrgId = req.producerOrgId;
    const reviewedByUserId = req.user?.id;
    if (!reviewedByUserId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const note = req.body?.note || null;

    const data = await approvalService.rejectApproval(producerOrgId, req.params.id, reviewedByUserId, note);
    void writeProducerAudit({
      producerOrgId,
      actorType: "OWNER",
      actorId: reviewedByUserId,
      action: "APPROVAL_REJECTED",
      entityType: "PRODUCER_APPROVAL",
      entityId: String(data.id),
    });

    return res.status(200).json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to reject" });
  }
};

module.exports = {
  register: exports.register,
  login: exports.login,
  me: exports.me,
  submitKyc: exports.submitKyc,
  submitKycLegacyOrNew: exports.submitKycLegacyOrNew,
  kycStatus: exports.kycStatus,
  listProducts: exports.listProducts,
  listProductsPick: exports.listProductsPick,
  createProduct: exports.createProduct,
  getProduct: exports.getProduct,
  updateProduct: exports.updateProduct,
  submitProduct: exports.submitProduct,
  resubmitProduct: exports.resubmitProduct,
  getProductStatus: exports.getProductStatus,
  addProductProof: exports.addProductProof,
  listFactories: exports.listFactories,
  createFactory: exports.createFactory,
  createBatch: exports.createBatch,
  submitBatch: exports.submitBatch,
  listBatches: exports.listBatches,
  getBatch: exports.getBatch,
  listPrintEmailRecipients: exports.listPrintEmailRecipients,
  createPrintEmailRecipient: exports.createPrintEmailRecipient,
  listPrintBatches: exports.listPrintBatches,
  getPrintBatchDetail: exports.getPrintBatchDetail,
  allocatePrintBatch: exports.allocatePrintBatch,
  revokePrintAllocation: exports.revokePrintAllocation,
  downloadPrintIssuance: exports.downloadPrintIssuance,
  markBatchPrinted: exports.markBatchPrinted,
  generateCodes: exports.generateCodes,
  exportCodes: exports.exportCodes,
  exportSummaryCsv: exports.exportSummaryCsv,
  exportBatchCodesCsv: exports.exportBatchCodesCsv,
  exportBatchEventsCsv: exports.exportBatchEventsCsv,
  verify: exports.verify,
  searchCode: exports.searchCode,
  inviteStaff: exports.inviteStaff,
  listStaff: exports.listStaff,
  updateStaffRole: exports.updateStaffRole,
  updateStaffStatus: exports.updateStaffStatus,
  removeStaff: exports.removeStaff,
  createStaffInvite: exports.createStaffInvite,
  listStaffInvites: exports.listStaffInvites,
  getStaffInvitePreview: exports.getStaffInvitePreview,
  cancelStaffInvite: exports.cancelStaffInvite,
  resendStaffInvite: exports.resendStaffInvite,
  acceptStaffInvite: exports.acceptStaffInvite,
  acceptStaffInvitePublic: exports.acceptStaffInvitePublic,
  declineStaffInvite: exports.declineStaffInvite,
  getPendingInvites: exports.getPendingInvites,
  getEnforcementHolds: exports.getEnforcementHolds,
  listAuditLogs: exports.listAuditLogs,
  listApprovals: exports.listApprovals,
  approveApproval: exports.approveApproval,
  rejectApproval: exports.rejectApproval,
};

export {};
